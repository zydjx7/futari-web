import katex from "katex";
import { adminPage, pageError, shell, turnLink } from "../../app/views.js";
import { empty, field, h, imageField, InputError, isId, newImage, photo, readForm, saveBar } from "../../shared/content.js";
import { saved } from "../../shared/http.js";
import { completePuzzle } from "../wallet/earnings.js";

const categories = ["数学", "脑筋急转弯", "推理", "趣题"];
const base = "/admin/puzzles";

function math(source, displayMode) {
  try {
    return katex.renderToString(source, { output: "mathml", displayMode, trust: false, throwOnError: true,
      strict: "ignore", maxExpand: 700, maxSize: 20 });
  } catch {
    throw new InputError("公式语法有误，请检查括号和 LaTeX 命令");
  }
}
function mathText(value) {
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\$([^$\n]+?)\$/g;
  let html = "", end = 0;
  for (const match of value.matchAll(pattern)) {
    html += h(value.slice(end, match.index)) + math(match[1] ?? match[2] ?? match[3] ?? match[4], Boolean(match[1] || match[2]));
    end = match.index + match[0].length;
  }
  return html + h(value.slice(end));
}

async function page(ctx, rest) {
  const category = ctx.url.searchParams.get("category") || "";
  if (category && !categories.includes(category)) throw new InputError("题目分类无效");
  const suffix = category ? "?category=" + encodeURIComponent(category) : "";
  const [id, action, extra] = rest.split("/");
  if (extra !== undefined || (id && !isId(id))) return pageError("找不到题目", 404);
  if (!ctx.read && action === "done" && id) {
    const found = await ctx.db.prepare("SELECT id,title FROM puzzles WHERE id=?").bind(id).first();
    if (!found) return pageError("找不到题目", 404);
    await completePuzzle(ctx, found);
    return saved(ctx, "/puzzles/" + id + suffix);
  }
  if (!ctx.read || action) return pageError("找不到此页", 404);
  const { results } = await ctx.db.prepare("SELECT id,title FROM puzzles WHERE ?1='' OR category=?1 ORDER BY created_at DESC,rowid DESC").bind(category).all();
  const at = id ? results.findIndex(item => item.id === id) : 0;
  if (at < 0) return pageError("找不到题目", 404);
  const filters = '<nav class="filters" aria-label="题目分类">' + ["", ...categories].map(c =>
    `<a href="/puzzles${c ? "?category=" + encodeURIComponent(c) : ""}" data-category="${c}"${c === category ? ' aria-current="true"' : ""}>${c || "全部"}</a>`).join("") + "</nav>";
  if (!results.length) {
    if (id) return pageError("找不到题目", 404);
    return shell("/puzzles", ctx, { title: "Puzzle", body: filters + empty("这个分类还没有题目") });
  }
  const puzzle = await ctx.db.prepare(`SELECT p.*,EXISTS(SELECT 1 FROM puzzle_completions WHERE puzzle_id=p.id AND member=?) AS done
    FROM puzzles p WHERE p.id=?`).bind(ctx.role, results[at].id).first();
  const path = "/puzzles/" + puzzle.id;
  const skip = (item, rel, label) => item ? turnLink(rel, "/puzzles/" + item.id + suffix, label, item.title) : "";
  const body = filters + `<article class="puzzle"><div class="puzzle-meta"><span class="category" data-category="${h(puzzle.category)}">${h(puzzle.category)}</span><span>第 ${at + 1} / ${results.length} 题</span></div>
    <h2>${h(puzzle.title)}</h2><div class="writing math-text">${mathText(puzzle.question)}</div>
    ${puzzle.formula ? `<div class="display-math">${math(puzzle.formula, true)}</div>` : ""}${photo(puzzle.image_key, "题目配图")}
    <details class="solution"><summary>翻开看解析</summary><div class="writing math-text">${mathText(puzzle.solution)}</div></details>
    <form method="post" action="${path}/done${suffix}"><button class="done"${puzzle.done ? " disabled" : ""}>${puzzle.done ? "已完成" : "做完了"}</button></form></article>
    <nav class="turns" aria-label="切换题目">${skip(results[at-1], "prev", "上一题")}${skip(results[at+1], "next", "下一题")}</nav>`;
  return shell("/puzzles", ctx, { title: "Puzzle", body });
}

async function manage(ctx, rest) {
  if (!rest && ctx.read) {
    const { results } = await ctx.db.prepare("SELECT id,title,category FROM puzzles ORDER BY created_at DESC,rowid DESC").all();
    const body = '<div class="entry-list">' + (results.map(p =>
      `<a href="${base}/${p.id}"><span>${h(p.title)}</span><small>${h(p.category)}</small></a>`).join("") || empty("还没有题目")) + "</div>";
    return adminPage(ctx, "Puzzle", body, { tools: `<a class="subtle" href="${base}/new">添加题目</a>` });
  }
  const fresh = rest === "new" && ctx.read, id = fresh ? crypto.randomUUID() : rest;
  if (!isId(id)) return pageError("找不到题目", 404);
  if (!ctx.read) {
    const form = await readForm(ctx.request);
    const category = form.get("category");
    if (!categories.includes(category)) throw new InputError("请选择题目分类");
    const title = field(form, "title", "题名", 200), question = field(form, "question", "题干", 20000);
    const formula = field(form, "formula", "公式", 4000, false), solution = field(form, "solution", "答案与解析", 20000);
    mathText(question); mathText(solution);
    if (formula) math(formula, true);
    const image = await newImage(ctx.bucket, form, "puzzles/" + id);
    await ctx.db.prepare(`INSERT INTO puzzles(id,category,title,question,formula,image_key,solution) VALUES(?1,?2,?3,?4,?5,?6,?7)
      ON CONFLICT(id) DO UPDATE SET category=excluded.category,title=excluded.title,question=excluded.question,formula=excluded.formula,
      solution=excluded.solution,image_key=CASE WHEN ?8 THEN NULL ELSE coalesce(excluded.image_key,puzzles.image_key) END`)
      .bind(id, category, title, question, formula, image, solution, Number(!image && form.has("remove_image"))).run();
    return saved(ctx, base);
  }
  const row = fresh ? {} : await ctx.db.prepare("SELECT * FROM puzzles WHERE id=?").bind(id).first();
  if (!row) return pageError("找不到题目", 404);
  const form = `<form class="editor" data-editor method="post" enctype="multipart/form-data" action="${base}/${id}">
    <label>题名<input name="title" required maxlength="200" value="${h(row.title)}"></label>
    <label>分类<select name="category">${categories.map(c => `<option${row.category===c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
    <label>题干<textarea name="question" required maxlength="20000" rows="5">${h(row.question)}</textarea></label>
    <label>公式（LaTeX）<textarea name="formula" maxlength="4000" rows="2" placeholder="\\frac{a}{b}">${h(row.formula)}</textarea></label>
    ${imageField(row.image_key)}
    <label>答案与解析<textarea name="solution" required maxlength="20000" rows="5">${h(row.solution)}</textarea></label>${saveBar("保存题目")}</form>`;
  return adminPage(ctx, fresh ? "添加题目" : "编辑题目", form, { back: [base, "Puzzle 管理"] });
}
export default { path: "/puzzles", title: "Puzzle", page, manage };
