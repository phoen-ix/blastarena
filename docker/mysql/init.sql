-- Runs once, when MariaDB initialises an empty data directory: a fresh ./data/db, or the e2e and
-- docs stacks' tmpfs. An existing database is never touched, so changing this file does not
-- change the grants of a running deployment. Schema is managed by the backend's migrations.
--
-- Least privilege for the application user. Before this file runs, the image's entrypoint has
-- created MYSQL_DATABASE and MYSQL_USER (docker-compose.yml: DB_NAME, DB_USER) and granted that
-- user ALL PRIVILEGES on the database; a GRANT alone only adds to that. So the blanket grant is
-- revoked and the backend's needs granted back: DML, plus the DDL its migrations run. Left out:
-- EVENT, TRIGGER, CREATE ROUTINE, ALTER ROUTINE, SHOW CREATE ROUTINE, LOCK TABLES, DELETE
-- HISTORY, GRANT OPTION; no migration or query uses them (the migration lock is GET_LOCK, which
-- needs no privilege; SELECT ... FOR UPDATE needs SELECT and UPDATE).
--
-- A .sql init file cannot read the environment, so no name is written here. The entrypoint runs
-- it with --database=MYSQL_DATABASE, which makes DATABASE() the app database, and the user comes
-- from the grant the entrypoint just wrote. That grant names the database with `_` escaped
-- (`blast\_arena`), and REVOKE must name it exactly as granted, so the stored Db is reused. With
-- no such grant (MYSQL_USER unset) every statement below is a no-op.

SELECT User, Host, Db INTO @app_user, @app_host, @app_db
  FROM mysql.db
  WHERE Db IN (DATABASE(), REPLACE(DATABASE(), '_', '\\_')) AND User <> ''
  LIMIT 1;

SET @app_on = CONCAT('`', REPLACE(@app_db, '`', '``'), '`.*');
SET @app_account = CONCAT(QUOTE(@app_user), '@', QUOTE(@app_host));

SET @revoke_sql = IFNULL(CONCAT('REVOKE ALL PRIVILEGES ON ', @app_on, ' FROM ', @app_account), 'DO 0');
PREPARE stmt FROM @revoke_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @grant_sql = IFNULL(
  CONCAT(
    'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, ',
    'CREATE TEMPORARY TABLES, CREATE VIEW, SHOW VIEW, EXECUTE ON ', @app_on, ' TO ', @app_account
  ),
  'DO 0'
);
PREPARE stmt FROM @grant_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT IFNULL(CONCAT('init.sql: least-privilege grant applied to ', @app_account, ' on ', @app_on),
              'init.sql: no application user grant found, nothing changed') AS init_sql;
