ALTER TABLE rabbit_home ADD COLUMN name TEXT NOT NULL DEFAULT '焦糖兔'
    CHECK (length(name) BETWEEN 1 AND 12 AND instr(name, char(0)) = 0);
