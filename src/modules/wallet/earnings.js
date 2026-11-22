import { InputError, isId, readForm } from "../../shared/content.js";
import { plain } from "../../shared/http.js";
import { rewards } from "./config.js";

const noContent = () => new Response(null, { status: 204 });

export function completePuzzle(ctx, puzzle) {
  const complete = ctx.db.prepare("INSERT INTO puzzle_completions(member,puzzle_id) VALUES(?,?) ON CONFLICT DO NOTHING")
    .bind(ctx.role, puzzle.id);
  if (ctx.role !== "her") return complete.run();
  // Check the old completion before inserting the new one, in the same transaction.
  return ctx.db.batch([
    ctx.db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,detail)
      SELECT 'puzzle',?1,?2,?3 WHERE NOT EXISTS
        (SELECT 1 FROM puzzle_completions WHERE member='her' AND puzzle_id=?4)
      ON CONFLICT(idempotency_key) DO NOTHING`)
      .bind("puzzle:her:" + puzzle.id, rewards.puzzleCoins, puzzle.title, puzzle.id),
    complete
  ]);
}

export async function chapterRead(ctx, book) {
  if (ctx.role !== "her") return plain("没有权限", 403);
  const form = await readForm(ctx.request);
  const number = form.get("chapter"), phase = form.get("phase");
  if (!/^[1-9]\d{0,8}$/.test(number ?? "") || !["start", "finish"].includes(phase)) {
    throw new InputError("阅读记录无效");
  }
  const chapter = Number(number);
  const row = await ctx.db.prepare(`SELECT b.title AS book_title,c.title FROM chapters c JOIN books b ON b.id=c.book_id
    WHERE c.book_id=? AND c.number=? AND length(trim(c.body, char(9,10,13,32)))>0`).bind(book, chapter).first();
  if (!row) return plain("找不到可读章节", 404);
  if (phase === "start") {
    await ctx.db.prepare("INSERT INTO chapter_read_starts(book_id,chapter) VALUES(?,?) ON CONFLICT DO NOTHING")
      .bind(book, chapter).run();
    return noContent();
  }
  const start = await ctx.db.prepare(`SELECT 1 AS ready FROM chapter_read_starts
    WHERE book_id=? AND chapter=? AND started_at <= unixepoch()-?`)
    .bind(book, chapter, rewards.chapterVisibleSeconds).first();
  if (!start) return plain("阅读时间不足", 409);
  await ctx.db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,detail)
    VALUES('reading',?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind("reading:her:" + book + ":" + chapter, rewards.chapterCoins, row.book_title + " · " + row.title).run();
  return noContent();
}

// The last earned threshold is the receipt, shared by visits, heartbeats and older clients.
export function settleAllowance(db, recentDay, stream) {
  // The first sample of a run also picks up historical uncollected allowances.
  // Following samples can only extend today or the previous day's interval.
  const range = recentDay === undefined ? "" : ` AND day_start >=
    (SELECT CASE WHEN started_at=last_seen THEN (SELECT min(day_start) FROM companion_days) ELSE ? END
     FROM companion_runs WHERE stream=? ORDER BY started_at DESC LIMIT 1)`;
  const statement = db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,day_start)
    SELECT 'allowance','allowance:her:' || day_start || ':' || earned, earned-claimed,day_start
    FROM companion_earnings WHERE earned>claimed${range}
    ON CONFLICT(idempotency_key) DO NOTHING`);
  return recentDay === undefined ? statement : statement.bind(recentDay-86400,stream);
}

export async function recordPresence(db, stream, now, credit = false) {
  const offset = rewards.dayOffsetSeconds;
  const day = Math.floor((now + offset) / 86400) * 86400 - offset;
  await db.batch([
    db.prepare(`INSERT INTO companion_days(day_start,seconds_per_coin,daily_cap)
      VALUES(?,?,?) ON CONFLICT DO NOTHING`).bind(day, rewards.companionSecondsPerCoin, rewards.companionDailyCap),
    db.prepare(`INSERT INTO companion_runs(stream,started_at,last_seen)
      VALUES(?1, coalesce((SELECT started_at FROM companion_runs WHERE stream=?1 AND started_at<=?2
        AND last_seen>=?3 ORDER BY started_at DESC LIMIT 1), ?2), ?2)
      ON CONFLICT(stream,started_at) DO UPDATE SET last_seen=max(last_seen,excluded.last_seen)`)
      .bind(stream, now, now - rewards.companionMaxGapSeconds),
    ...(credit ? [settleAllowance(db, day, stream)] : [])
  ]);
}

export async function pulse(ctx) {
  const stream = (await readForm(ctx.request)).get("stream");
  if (!isId(stream)) throw new InputError("页面标识无效");
  await recordPresence(ctx.db, stream, Math.floor(Date.now() / 1000), true);
  return noContent();
}

export async function claimAllowance(ctx) {
  const key = (await readForm(ctx.request)).get("request_id");
  if (!isId(key)) throw new InputError("领取凭据无效");
  // A retry of an empty or successful claim cannot collect later earnings.
  const [posted, , wallet] = await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,day_start)
      SELECT 'allowance','allowance:her:' || day_start || ':' || earned, earned-claimed,day_start
      FROM companion_earnings WHERE earned>claimed AND NOT EXISTS (SELECT 1 FROM allowance_claims WHERE request_id=?)
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING delta`).bind(key),
    ctx.db.prepare("INSERT INTO allowance_claims(request_id) VALUES(?) ON CONFLICT DO NOTHING").bind(key),
    ctx.db.prepare("SELECT balance FROM wallets WHERE owner='her'")
  ]);
  return Response.json({ credited: posted.results.reduce((sum, entry) => sum + entry.delta, 0), balance: wallet.results[0].balance });
}
