ALTER TABLE chapters ADD COLUMN creation_key TEXT;
CREATE UNIQUE INDEX chapter_creation ON chapters(book_id, creation_key);
ALTER TABLE reading_progress ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
