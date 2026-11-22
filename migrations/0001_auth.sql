CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('her', 'admin')),
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE login_attempts (
    ip_key TEXT PRIMARY KEY NOT NULL,
    failures INTEGER NOT NULL CHECK (failures BETWEEN 1 AND 5),
    expires_at INTEGER NOT NULL
) STRICT;
