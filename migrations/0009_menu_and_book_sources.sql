CREATE TABLE IF NOT EXISTS menu_dish_details (
    dish_id TEXT PRIMARY KEY REFERENCES menu_dishes(id) ON DELETE CASCADE,
    station TEXT NOT NULL,
    category TEXT NOT NULL,
    portion TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE IF NOT EXISTS book_reading_links (
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    PRIMARY KEY (book_id, position)
) STRICT;
