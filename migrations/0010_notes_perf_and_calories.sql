CREATE INDEX IF NOT EXISTS chapters_toc ON chapters(book_id, number, title);
CREATE INDEX IF NOT EXISTS reading_keys ON wallet_entries(idempotency_key) WHERE kind='reading';

CREATE TABLE book_notes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter INTEGER NOT NULL,
    paragraph INTEGER NOT NULL CHECK (paragraph >= 0),
    quote TEXT NOT NULL DEFAULT '' CHECK (length(quote) <= 300),
    parent_id TEXT REFERENCES book_notes(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('her','admin')),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (book_id,chapter) REFERENCES chapters(book_id,number) ON DELETE CASCADE
) STRICT;
CREATE INDEX book_notes_by_chapter ON book_notes(book_id,chapter,paragraph,created_at);
CREATE INDEX book_notes_by_author_time ON book_notes(author,created_at DESC,id);
CREATE INDEX book_note_replies ON book_notes(parent_id) WHERE parent_id IS NOT NULL;
CREATE TABLE book_note_reads (
    member TEXT NOT NULL CHECK (member IN ('her','admin')),
    note_id TEXT NOT NULL REFERENCES book_notes(id) ON DELETE CASCADE,
    read_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (member,note_id)
) STRICT;

ALTER TABLE menu_dishes ADD COLUMN servings REAL NOT NULL DEFAULT 1 CHECK (servings > 0 AND servings <= 20);
CREATE TABLE IF NOT EXISTS menu_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    daily_kcal_target INTEGER NOT NULL DEFAULT 1600 CHECK (daily_kcal_target BETWEEN 800 AND 4000)
) STRICT;
INSERT OR IGNORE INTO menu_settings(id,daily_kcal_target) VALUES(1,1600);

-- Keep per-turn reads constant, including the total, even with sparse chapter numbers.
CREATE TABLE book_chapter_counts (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    total INTEGER NOT NULL CHECK(total>=0)
) STRICT;
INSERT INTO book_chapter_counts SELECT book_id,count(*) FROM chapters INDEXED BY chapters_toc GROUP BY book_id;
CREATE TRIGGER chapters_count_insert AFTER INSERT ON chapters BEGIN
    INSERT INTO book_chapter_counts VALUES(NEW.book_id,1) ON CONFLICT(book_id) DO UPDATE SET total=total+1;
END;
CREATE TRIGGER chapters_count_delete AFTER DELETE ON chapters BEGIN
    UPDATE book_chapter_counts SET total=total-1 WHERE book_id=OLD.book_id;
END;
CREATE TRIGGER chapters_count_move AFTER UPDATE OF book_id ON chapters WHEN NEW.book_id<>OLD.book_id BEGIN
    UPDATE book_chapter_counts SET total=total-1 WHERE book_id=OLD.book_id;
    INSERT INTO book_chapter_counts VALUES(NEW.book_id,1) ON CONFLICT(book_id) DO UPDATE SET total=total+1;
END;
