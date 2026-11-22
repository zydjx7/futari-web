ALTER TABLE rabbit_home ADD COLUMN scene TEXT NOT NULL DEFAULT 'paper' CHECK (scene IN ('paper','snow'));
ALTER TABLE rabbit_inventory ADD COLUMN placed INTEGER NOT NULL DEFAULT 0 CHECK (placed IN (0,1));
-- Furnishings bought before the storybook were already on display.
UPDATE rabbit_inventory SET placed=1 WHERE item IN ('ball','bed') AND quantity>0;
CREATE TABLE rabbit_mail_reads (
    entry_id INTEGER PRIMARY KEY REFERENCES wallet_entries(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX rabbit_mail_entries ON wallet_entries(id DESC)
    WHERE kind='adjustment' AND (delta>0 OR note<>'');
