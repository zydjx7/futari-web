ALTER TABLE rabbit_home ADD COLUMN last_visit INTEGER;
ALTER TABLE rabbit_home ADD COLUMN last_fed INTEGER;
ALTER TABLE rabbit_home ADD COLUMN satiety INTEGER NOT NULL DEFAULT 35 CHECK (satiety BETWEEN 0 AND 100);

CREATE TABLE rabbit_inventory (
    item TEXT PRIMARY KEY NOT NULL,
    owner TEXT NOT NULL DEFAULT 'her' REFERENCES rabbit_home(owner),
    quantity INTEGER NOT NULL CHECK (quantity >= 0)
) STRICT;

-- SQLite cannot widen a CHECK in place. Preserve every ID and receipt. The
-- balance trigger is reinstalled only after the original entries are copied.
CREATE TABLE wallet_history_copy AS SELECT * FROM wallet_entries;
DROP TABLE wallet_entries;
CREATE TABLE wallet_entries (
    id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL DEFAULT 'her' REFERENCES wallets(owner),
    kind TEXT NOT NULL CHECK (kind IN ('reading','puzzle','allowance','adjustment','purchase','care','gift')),
    idempotency_key TEXT NOT NULL UNIQUE,
    delta INTEGER NOT NULL CHECK (delta <> 0 AND
        (kind = 'adjustment' OR (kind = 'purchase' AND delta < 0) OR (kind <> 'purchase' AND delta > 0))),
    detail TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    day_start INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    item TEXT,
    CHECK ((kind = 'allowance') = (day_start IS NOT NULL)),
    CHECK ((kind = 'purchase') = (item IS NOT NULL))
) STRICT;
INSERT INTO wallet_entries(id,owner,kind,idempotency_key,delta,detail,note,day_start,created_at)
    SELECT id,owner,kind,idempotency_key,delta,detail,note,day_start,created_at FROM wallet_history_copy;
DROP TABLE wallet_history_copy;
CREATE INDEX wallet_allowance_days ON wallet_entries(day_start) WHERE kind = 'allowance';
CREATE TRIGGER wallet_apply_entry AFTER INSERT ON wallet_entries
BEGIN
    UPDATE wallets SET balance = balance + NEW.delta WHERE owner = NEW.owner;
END;
CREATE TRIGGER rabbit_stock_purchase AFTER INSERT ON wallet_entries WHEN NEW.kind = 'purchase'
BEGIN
    INSERT INTO rabbit_inventory(item,quantity) VALUES(NEW.item,1)
        ON CONFLICT(item) DO UPDATE SET quantity = quantity+1;
END;

CREATE TABLE rabbit_feeds (
    request_id TEXT PRIMARY KEY NOT NULL,
    item TEXT NOT NULL REFERENCES rabbit_inventory(item),
    fed_at INTEGER NOT NULL,
    satiety_after INTEGER NOT NULL CHECK (satiety_after BETWEEN 0 AND 100)
) STRICT;
CREATE TRIGGER rabbit_apply_feed AFTER INSERT ON rabbit_feeds
BEGIN
    UPDATE rabbit_inventory SET quantity = quantity-1 WHERE item = NEW.item;
    UPDATE rabbit_home SET last_fed = NEW.fed_at, satiety = NEW.satiety_after WHERE owner = 'her';
END;
