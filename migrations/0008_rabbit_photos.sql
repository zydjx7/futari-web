ALTER TABLE rabbit_home ADD COLUMN atmosphere TEXT NOT NULL DEFAULT 'auto'
    CHECK (atmosphere IN ('auto','day','dusk','night'));

CREATE TABLE rabbit_photos (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('writing','ready','deleting','deleted')),
    digest TEXT NOT NULL,
    captured INTEGER NOT NULL,
    offset_minutes INTEGER NOT NULL,
    scene TEXT NOT NULL CHECK (scene IN ('paper','snow')),
    light TEXT NOT NULL CHECK (light IN ('day','dusk','night')),
    pose TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    touched INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX rabbit_photos_calendar ON rabbit_photos(captured DESC,id DESC) WHERE status='ready';
CREATE INDEX rabbit_photos_moments ON rabbit_photos(pose,captured DESC,id DESC) WHERE status='ready';
CREATE INDEX rabbit_photos_cleanup ON rabbit_photos(status,touched) WHERE status IN ('writing','deleting');
