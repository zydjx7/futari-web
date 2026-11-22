CREATE TABLE menu_chef_picks (
    id TEXT PRIMARY KEY NOT NULL,
    week TEXT NOT NULL REFERENCES menu_weeks(week) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 1),
    name TEXT NOT NULL,
    station TEXT NOT NULL,
    source_url TEXT NOT NULL CHECK (source_url GLOB 'https://*'),
    image_key TEXT,
    preview_key TEXT,
    UNIQUE (week, position)
) STRICT;
