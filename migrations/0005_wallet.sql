CREATE TABLE wallets (
    owner TEXT PRIMARY KEY NOT NULL CHECK (owner = 'her'),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
) STRICT;
INSERT INTO wallets (owner) VALUES ('her');

CREATE TABLE wallet_entries (
    id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL DEFAULT 'her' REFERENCES wallets(owner),
    kind TEXT NOT NULL CHECK (kind IN ('reading', 'puzzle', 'allowance', 'adjustment')),
    idempotency_key TEXT NOT NULL UNIQUE,
    delta INTEGER NOT NULL CHECK (delta <> 0 AND (kind = 'adjustment' OR delta > 0)),
    detail TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    day_start INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    CHECK ((kind = 'allowance') = (day_start IS NOT NULL))
) STRICT;
CREATE INDEX wallet_allowance_days ON wallet_entries(day_start) WHERE kind = 'allowance';
CREATE TRIGGER wallet_apply_entry AFTER INSERT ON wallet_entries
BEGIN
    UPDATE wallets SET balance = balance + NEW.delta WHERE owner = NEW.owner;
END;

CREATE TABLE chapter_read_starts (
    book_id TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (book_id, chapter),
    FOREIGN KEY (book_id, chapter) REFERENCES chapters(book_id, number)
) STRICT;

CREATE TABLE companion_days (
    day_start INTEGER PRIMARY KEY,
    seconds_per_coin INTEGER NOT NULL CHECK (seconds_per_coin > 0),
    daily_cap INTEGER NOT NULL CHECK (daily_cap >= 0)
) STRICT;
CREATE TABLE companion_runs (
    stream TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL CHECK (last_seen >= started_at),
    PRIMARY KEY (stream, started_at)
) STRICT;
CREATE INDEX companion_runs_end ON companion_runs(last_seen);
CREATE TABLE allowance_claims (
    request_id TEXT PRIMARY KEY NOT NULL
) STRICT;

-- Clip each confirmed interval to its day, then count only time not already
-- covered by another tab or device. The daily rate is fixed on that day's first pulse.
CREATE VIEW companion_earnings AS
WITH spans AS (
    SELECT d.day_start, r.stream, r.started_at,
           max(r.started_at, d.day_start) AS lo, min(r.last_seen, d.day_start + 86400) AS hi
    FROM companion_days d JOIN companion_runs r
      ON r.last_seen > d.day_start AND r.started_at < d.day_start + 86400
    WHERE r.last_seen > r.started_at
), edges AS (
    SELECT *, max(hi) OVER (PARTITION BY day_start ORDER BY lo, hi, stream, started_at
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
    FROM spans
), covered AS (
    SELECT day_start, sum(max(0, hi - max(lo, coalesce(previous_end, lo)))) AS seconds
    FROM edges GROUP BY day_start
), claimed AS (
    SELECT day_start, sum(delta) AS amount FROM wallet_entries WHERE kind = 'allowance' GROUP BY day_start
)
SELECT d.day_start, coalesce(covered.seconds, 0) AS seconds,
       min(d.daily_cap, coalesce(covered.seconds, 0) / d.seconds_per_coin) AS earned,
       coalesce(claimed.amount, 0) AS claimed
FROM companion_days d LEFT JOIN covered USING (day_start) LEFT JOIN claimed USING (day_start);
