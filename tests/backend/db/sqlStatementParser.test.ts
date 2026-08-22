import { describe, it, expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

jest.mock('../../../backend/src/db/connection', () => ({
  getPool: () => ({ execute: jest.fn<AnyFn>() }),
}));

import { parseSqlStatements } from '../../../backend/src/db/migrations/runner';

/**
 * Statements end at a top-level `;`. Semicolons inside comments, strings or quoted identifiers are
 * content, not separators.
 *
 * The parser was `sql.split(';')`. Migration 039 carried a semicolon inside a `--` comment, the
 * comment was cut in half, and the fragment reached the server as SQL — ER_PARSE_ERROR, a failed
 * migration and a crash-looping backend on deploy. (audit MIGRATION-PARSER-1)
 */
describe('parseSqlStatements', () => {
  describe('the regression that broke deploy', () => {
    // Verbatim shape of the migration that failed.
    const brokenShape = `
-- season_elo already has idx_season_elo_ranking for this; the no-active-season path did
-- not. (audit LEADERBOARD-INDEX-1)
ALTER TABLE user_stats ADD INDEX idx_user_stats_elo (elo_rating);
ALTER TABLE matches ADD INDEX idx_matches_finished_at (finished_at);
`;

    it('keeps a semicolon inside a line comment out of the split', () => {
      const statements = parseSqlStatements(brokenShape);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('ALTER TABLE user_stats ADD INDEX idx_user_stats_elo');
      expect(statements[1]).toContain('ALTER TABLE matches ADD INDEX idx_matches_finished_at');
    });

    it('never emits a fragment that starts mid-sentence', () => {
      for (const s of parseSqlStatements(brokenShape)) {
        expect(s.startsWith('the no-active-season')).toBe(false);
      }
    });
  });

  describe('comments', () => {
    it('handles `--` line comments', () => {
      expect(parseSqlStatements('-- a; b\nSELECT 1;')).toEqual(['-- a; b\nSELECT 1']);
    });

    it('handles `#` line comments', () => {
      expect(parseSqlStatements('# a; b\nSELECT 1;')).toEqual(['# a; b\nSELECT 1']);
    });

    it('handles block comments', () => {
      expect(parseSqlStatements('/* a; b */ SELECT 1;')).toEqual(['/* a; b */ SELECT 1']);
    });

    it('treats `--` without following whitespace as arithmetic, not a comment', () => {
      // MySQL requires whitespace after `--`; `1--2` is 1 - (-2).
      expect(parseSqlStatements('SELECT 1--2;')).toEqual(['SELECT 1--2']);
    });

    it('drops comment-only fragments instead of sending them to the server', () => {
      expect(parseSqlStatements('SELECT 1;\n-- trailing note\n')).toEqual(['SELECT 1']);
      expect(parseSqlStatements('-- only a comment\n')).toEqual([]);
      expect(parseSqlStatements('/* only a block comment */')).toEqual([]);
    });

    it('keeps a version-gated executable comment, which the server does act on', () => {
      const sql = '/*!40101 SET NAMES utf8 */;';
      expect(parseSqlStatements(sql)).toEqual(['/*!40101 SET NAMES utf8 */']);
    });

    it('tolerates an unterminated block comment', () => {
      expect(parseSqlStatements('SELECT 1;\n/* never closed')).toEqual(['SELECT 1']);
    });
  });

  describe('quoting', () => {
    it('keeps a semicolon inside a single-quoted string', () => {
      const sql = "INSERT INTO t (v) VALUES ('a; b');";
      expect(parseSqlStatements(sql)).toEqual(["INSERT INTO t (v) VALUES ('a; b')"]);
    });

    it('keeps a semicolon inside a double-quoted string', () => {
      const sql = 'INSERT INTO t (v) VALUES ("a; b");';
      expect(parseSqlStatements(sql)).toEqual(['INSERT INTO t (v) VALUES ("a; b")']);
    });

    it('keeps a semicolon inside a backtick identifier', () => {
      const sql = 'SELECT `weird;col` FROM t;';
      expect(parseSqlStatements(sql)).toEqual(['SELECT `weird;col` FROM t']);
    });

    it('handles a doubled quote escape', () => {
      const sql = "INSERT INTO t (v) VALUES ('it''s; here');";
      expect(parseSqlStatements(sql)).toEqual(["INSERT INTO t (v) VALUES ('it''s; here')"]);
    });

    it('handles a backslash escape', () => {
      const sql = "INSERT INTO t (v) VALUES ('a\\'; b');";
      expect(parseSqlStatements(sql)).toHaveLength(1);
    });

    it('does not treat a backslash as an escape inside backticks', () => {
      expect(parseSqlStatements('SELECT `a\\` FROM t;')).toHaveLength(1);
    });

    it('keeps a comment marker that appears inside a string', () => {
      const sql = "INSERT INTO t (v) VALUES ('-- not a comment; really');";
      expect(parseSqlStatements(sql)).toEqual([
        "INSERT INTO t (v) VALUES ('-- not a comment; really')",
      ]);
    });
  });

  describe('general shape', () => {
    it('splits multiple statements', () => {
      expect(parseSqlStatements('SELECT 1; SELECT 2; SELECT 3;')).toEqual([
        'SELECT 1',
        'SELECT 2',
        'SELECT 3',
      ]);
    });

    it('accepts a final statement with no trailing semicolon', () => {
      expect(parseSqlStatements('SELECT 1;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('ignores empty fragments from blank lines and stray semicolons', () => {
      expect(parseSqlStatements(';;\nSELECT 1;\n\n;;')).toEqual(['SELECT 1']);
    });

    it('returns nothing for an empty file', () => {
      expect(parseSqlStatements('')).toEqual([]);
      expect(parseSqlStatements('\n\n  \n')).toEqual([]);
    });
  });

  // The parser runs against real migrations on every boot, so it is pinned against them here:
  // every file must yield at least one statement, and none may look like a severed comment.
  describe("the repository's own migrations", () => {
    const dirs = [
      path.join(__dirname, '../../../backend/src/db/migrations'),
      path.join(__dirname, '../../../backend/src/db/migrations/down'),
    ];

    const files = dirs.flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => path.join(dir, f)),
    );

    it('finds the migration files it is meant to be checking', () => {
      expect(files.length).toBeGreaterThan(40);
    });

    it.each(files.map((f) => [path.basename(path.dirname(f)) + '/' + path.basename(f), f]))(
      '%s parses into runnable statements',
      (_name, file) => {
        const statements = parseSqlStatements(fs.readFileSync(file, 'utf-8'));
        expect(statements.length).toBeGreaterThan(0);
        for (const s of statements) {
          // A severed comment is the failure mode we are guarding against: a fragment whose
          // every line is a comment would never have been emitted, and one that *starts* with
          // prose but contains no SQL keyword is the shape 039 produced.
          const withoutComments = s
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((l) => !l.trim().startsWith('--') && !l.trim().startsWith('#'))
            .join('\n')
            .trim();
          expect(withoutComments).not.toBe('');
          expect(withoutComments).toMatch(
            /^(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|SET|RENAME|TRUNCATE|REPLACE|SELECT)\b/i,
          );
        }
      },
    );
  });
});
