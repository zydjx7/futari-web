-- One home for her rabbit. A visitor is optional data, never a second owner.
CREATE TABLE rabbit_home (
    owner TEXT PRIMARY KEY NOT NULL CHECK (owner = 'her'),
    visitor_slot TEXT DEFAULT NULL
        CHECK (visitor_slot IS NULL OR
               (json_valid(visitor_slot) AND json_type(visitor_slot) = 'object'))
) STRICT;

INSERT INTO rabbit_home (owner) VALUES ('her');
