-- This file runs on first MariaDB start only
-- Actual schema is managed by backend migrations
-- Just ensure the database exists and grant permissions

-- Application user: DML + DDL for migrations, but no dangerous extras
-- Excludes: EVENT, TRIGGER, CREATE ROUTINE, ALTER ROUTINE, GRANT OPTION, LOCK TABLES
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES,
      CREATE TEMPORARY TABLES, CREATE VIEW, SHOW VIEW, EXECUTE
      ON `blast_arena`.* TO 'blast_user'@'%';
FLUSH PRIVILEGES;
