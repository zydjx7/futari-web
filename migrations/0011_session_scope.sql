ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'web'
  CHECK (scope IN ('web', 'desktop'));
