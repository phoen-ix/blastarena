import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Every forward migration must have a matching rollback, numbered identically, and the numbering
 * must be gap-free — rollbackMigration(steps) walks them by name. Added alongside 040/041
 * (audit E9 / G9) so a migration landing without its `down/` twin fails here rather than at the
 * first rollback in production.
 */
const MIGRATIONS_DIR = path.join(__dirname, '../../../backend/src/db/migrations');
const DOWN_DIR = path.join(MIGRATIONS_DIR, 'down');

const ups = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();
const downs = fs
  .readdirSync(DOWN_DIR)
  .filter((f) => /^\d{3}_.+\.down\.sql$/.test(f))
  .sort();

describe('migration files', () => {
  it('finds the migrations', () => {
    expect(ups.length).toBeGreaterThanOrEqual(41);
  });

  it('every up migration has a down file with the same stem', () => {
    const missing = ups.filter((up) => !downs.includes(up.replace(/\.sql$/, '.down.sql')));
    expect(missing).toEqual([]);
  });

  it('every down file has an up migration', () => {
    const orphans = downs.filter((down) => !ups.includes(down.replace(/\.down\.sql$/, '.sql')));
    expect(orphans).toEqual([]);
  });

  it('numbers are unique and gap-free from 001', () => {
    const numbers = ups.map((f) => parseInt(f.slice(0, 3), 10));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('no migration file is empty', () => {
    const all = [
      ...ups.map((u) => path.join(MIGRATIONS_DIR, u)),
      ...downs.map((d) => path.join(DOWN_DIR, d)),
    ];
    for (const f of all) {
      expect(fs.readFileSync(f, 'utf-8').trim().length).toBeGreaterThan(0);
    }
  });

  // (audit E9 / G9) — the two new migrations reverse each other exactly.
  it('040 creates every index its down file drops, and vice versa', () => {
    const up = fs.readFileSync(path.join(MIGRATIONS_DIR, '040_audit_indexes.sql'), 'utf-8');
    const down = fs.readFileSync(path.join(DOWN_DIR, '040_audit_indexes.down.sql'), 'utf-8');
    const created = [...up.matchAll(/CREATE INDEX (\w+) ON (\w+)/g)].map((m) => `${m[1]}@${m[2]}`);
    const droppedInDown = [...down.matchAll(/DROP INDEX (\w+) ON (\w+)/g)].map(
      (m) => `${m[1]}@${m[2]}`,
    );
    expect(droppedInDown.sort()).toEqual(created.sort());

    const droppedInUp = [...up.matchAll(/DROP INDEX (\w+) ON (\w+)/g)].map(
      (m) => `${m[1]}@${m[2]}`,
    );
    const recreatedInDown = [...down.matchAll(/CREATE INDEX (\w+) ON (\w+)/g)].map(
      (m) => `${m[1]}@${m[2]}`,
    );
    expect(recreatedInDown.sort()).toEqual(droppedInUp.sort());
    expect(droppedInUp).toEqual(['idx_progress_user_level@campaign_progress']);
  });

  it('030 down undoes the unique index and NOT NULL as well, so 030 can be applied again', () => {
    // It only re-added the dropped columns; re-applying 030 then failed with
    // "Duplicate key name 'idx_users_email_hash'" (checked on MariaDB 11).
    const down = fs.readFileSync(
      path.join(DOWN_DIR, '030_finalize_email_hashing.down.sql'),
      'utf-8',
    );
    expect(down).toMatch(/DROP INDEX IF EXISTS idx_users_email_hash/);
    expect(down).toMatch(/MODIFY COLUMN email_hash VARCHAR\(64\) DEFAULT NULL/);
    expect(down).toMatch(/ADD COLUMN IF NOT EXISTS email VARCHAR\(255\)/);
    expect(down).toMatch(/ADD COLUMN IF NOT EXISTS pending_email VARCHAR\(255\)/);
  });

  it("046 drops only the index 035 added, which 008's composite index covers", () => {
    const composite = fs.readFileSync(path.join(MIGRATIONS_DIR, '008_campaign.sql'), 'utf-8');
    expect(composite).toMatch(/INDEX idx_levels_world_order \(world_id, sort_order\)/);
    const added = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '035_campaign_world_index.sql'),
      'utf-8',
    );
    expect(added).toMatch(/CREATE INDEX idx_levels_world ON campaign_levels\(world_id\)/);

    const up = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '046_drop_redundant_levels_world_index.sql'),
      'utf-8',
    );
    const down = fs.readFileSync(
      path.join(DOWN_DIR, '046_drop_redundant_levels_world_index.down.sql'),
      'utf-8',
    );
    expect(up).toMatch(/DROP INDEX IF EXISTS idx_levels_world ON campaign_levels;/);
    expect(down).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_levels_world ON campaign_levels \(world_id\);/,
    );
  });

  // MariaDB commits DDL on its own, so the runner's per-migration transaction cannot cover an
  // ALTER: a run that stops after one leaves it applied while _migrations does not record the
  // migration, and every start after that fails on it ("Duplicate column name"). From 042 on
  // (001-041 predate the rule) schema changes are guarded, so the migration can just run again.
  it('from 042 on, every schema change can run again (IF [NOT] EXISTS), up and down', () => {
    const UNGUARDED = [
      /\bADD COLUMN (?!IF NOT EXISTS)/i,
      /\bADD (?:UNIQUE )?(?:INDEX|KEY) (?!IF NOT EXISTS)/i,
      /\bCREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i,
      /\bCREATE TABLE (?!IF NOT EXISTS)/i,
      /\bDROP (?:COLUMN|INDEX|KEY|TABLE) (?!IF EXISTS)/i,
    ];
    const files = [
      ...ups.filter((f) => parseInt(f, 10) >= 42).map((f) => path.join(MIGRATIONS_DIR, f)),
      ...downs.filter((f) => parseInt(f, 10) >= 42).map((f) => path.join(DOWN_DIR, f)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(10);

    const unguarded: string[] = [];
    for (const file of files) {
      // One space between tokens, so a lookahead cannot be dodged by extra whitespace
      const sql = fs.readFileSync(file, 'utf-8').replace(/--.*$/gm, '').replace(/\s+/g, ' ');
      for (const pattern of UNGUARDED) {
        const m = pattern.exec(sql);
        if (m) unguarded.push(`${path.basename(file)}: ${sql.slice(m.index, m.index + 60)}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('041 drops login_attempts and its down recreates the 001 definition verbatim', () => {
    const up = fs.readFileSync(path.join(MIGRATIONS_DIR, '041_drop_login_attempts.sql'), 'utf-8');
    expect(up).toMatch(/DROP TABLE IF EXISTS login_attempts;/);

    const down = fs.readFileSync(path.join(DOWN_DIR, '041_drop_login_attempts.down.sql'), 'utf-8');
    const initial = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
    const table = (sql: string) =>
      /CREATE TABLE IF NOT EXISTS login_attempts \([\s\S]*?\);/.exec(sql)?.[0].replace(/\s+/g, ' ');
    expect(table(down)).toBeDefined();
    expect(table(down)).toBe(table(initial));
  });
});
