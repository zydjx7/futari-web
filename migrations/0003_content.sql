CREATE TABLE menu_weeks (
    week TEXT PRIMARY KEY NOT NULL,
    image_key TEXT
) STRICT;
CREATE TABLE menu_dishes (
    id TEXT PRIMARY KEY NOT NULL,
    week TEXT NOT NULL REFERENCES menu_weeks(week),
    day TEXT NOT NULL,
    meal TEXT NOT NULL CHECK (meal IN ('早餐','午餐','晚餐','加餐')),
    name TEXT NOT NULL,
    kcal REAL CHECK (kcal >= 0),
    position INTEGER NOT NULL,
    wanted INTEGER NOT NULL DEFAULT 0 CHECK (wanted IN (0, 1))
) STRICT;
CREATE INDEX menu_by_week ON menu_dishes(week, day, position);

CREATE TABLE books (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    source_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE TABLE chapters (
    book_id TEXT NOT NULL REFERENCES books(id),
    number INTEGER NOT NULL CHECK (number > 0),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (book_id, number)
) STRICT;
CREATE TABLE reading_progress (
    member TEXT NOT NULL CHECK (member IN ('her','admin')),
    book_id TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    paragraph INTEGER NOT NULL CHECK (paragraph >= 0),
    char_offset INTEGER NOT NULL CHECK (char_offset >= 0),
    PRIMARY KEY (member, book_id),
    FOREIGN KEY (book_id, chapter) REFERENCES chapters(book_id, number)
) STRICT;

CREATE TABLE puzzles (
    id TEXT PRIMARY KEY NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('数学','脑筋急转弯','推理','趣题')),
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    formula TEXT NOT NULL,
    image_key TEXT,
    solution TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE TABLE puzzle_completions (
    member TEXT NOT NULL CHECK (member IN ('her','admin')),
    puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
    completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (member, puzzle_id)
) STRICT;

CREATE TABLE news_items (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX news_by_day ON news_items(day DESC, created_at DESC);
