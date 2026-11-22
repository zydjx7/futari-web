-- Replace the positive-only check in one migration, preserving each dish and its saved quantity.
ALTER TABLE menu_dishes RENAME COLUMN servings TO previous_servings;
ALTER TABLE menu_dishes ADD COLUMN servings REAL NOT NULL DEFAULT 1 CHECK (servings >= 0 AND servings <= 20);
UPDATE menu_dishes SET servings = previous_servings WHERE previous_servings <> 1;
ALTER TABLE menu_dishes DROP COLUMN previous_servings;
