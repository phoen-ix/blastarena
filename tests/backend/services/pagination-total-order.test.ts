import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for paginated queries whose sort key is not a total order.
 *
 * `ORDER BY` on a non-unique column places no constraint on the relative order of tied rows, so
 * MariaDB may sequence them differently for each LIMIT/OFFSET window. Pages then overlap and gap:
 * the leaderboard returned users [7, 3] for `?page=1&limit=2` and user 7 *again* for `?page=2`,
 * while user 2 appeared on no page at all — with `total` still counting it.
 *
 * This is not an edge case in this schema. No column in any of the 39 migrations declares
 * fractional-second precision, so every `created_at` sort ties at one-second granularity, and
 * `seasons.start_date` / `map_challenges.start_date` are `DATE` — day granularity. Ten more
 * queries shared the defect after the leaderboard was fixed, including the admin audit log, where
 * one bulk operation writes several rows inside the same second.
 *
 * Inspection does not catch this: every one of the defective queries looked perfectly ordinary,
 * and the unit tests missed it because they mock `db/connection` and assert on bind parameters
 * rather than SQL text. So: scan the source instead, and require every paginated query to end its
 * ORDER BY on a column that is unique. (audit PAGINATION-TOTAL-ORDER-1)
 */

const SERVICE_DIR = path.join(__dirname, '../../../backend/src/services');

/**
 * Sort terms that are unique, and therefore make an ORDER BY a total order.
 *
 * Every entry is a primary key. `user_stats` is keyed on `user_id` rather than an `id` column,
 * which is why it appears here in its own right.
 */
const UNIQUE_SORT_KEYS = new Set([
  'id',
  'user_id',
  'name', // _migrations.name is VARCHAR UNIQUE
]);

interface PaginatedQuery {
  /** Enough of the surrounding SQL to identify the query in a failure message. */
  label: string;
  orderBy: string;
}

/**
 * Pull every paginated query out of a service file.
 *
 * Two forms exist and both must be handled — the second is used by exactly the admin user list and
 * the admin audit log, which are two of the queries this guard exists to catch:
 *   1. a template literal containing `ORDER BY ... LIMIT ? OFFSET ?`
 *   2. `sql += ' ORDER BY ... LIMIT ? OFFSET ?'` appended to a query built up in pieces
 */
function paginatedQueriesIn(source: string): PaginatedQuery[] {
  const found: PaginatedQuery[] = [];

  // Normalise whitespace so a clause split across source lines matches as one string.
  const flat = source.replace(/\s+/g, ' ');

  const re = /ORDER BY ([^`';]*?) LIMIT \? OFFSET \?/g;
  for (const m of flat.matchAll(re)) {
    const orderBy = m[1].trim();
    const start = Math.max(0, m.index - 90);
    found.push({ label: flat.slice(start, m.index + 40).trim(), orderBy });
  }
  return found;
}

/** The final sort term's column, stripped of table alias and direction. */
function finalSortColumn(orderBy: string): string {
  const last = orderBy.split(',').pop()!.trim();
  const withoutDirection = last.replace(/\s+(ASC|DESC)$/i, '').trim();
  return withoutDirection.includes('.')
    ? withoutDirection.split('.').pop()!.trim()
    : withoutDirection;
}

const serviceFiles = fs
  .readdirSync(SERVICE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(SERVICE_DIR, f))
  .filter((p) => /LIMIT \? OFFSET \?/.test(fs.readFileSync(p, 'utf-8').replace(/\s+/g, ' ')));

describe('paginated queries have a total order', () => {
  it('finds the paginated queries it is meant to be guarding', () => {
    // Without this the whole file passes vacuously if the scan ever stops matching — a renamed
    // directory, a reformatted clause, or the `sql +=` form being missed by the extractor.
    expect(serviceFiles.length).toBeGreaterThan(0);
    const total = serviceFiles.reduce(
      (n, p) => n + paginatedQueriesIn(fs.readFileSync(p, 'utf-8')).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(12);
  });

  for (const file of serviceFiles) {
    const rel = path.relative(path.join(__dirname, '../../..'), file);
    const queries = paginatedQueriesIn(fs.readFileSync(file, 'utf-8'));

    queries.forEach((q, i) => {
      it(`${rel} → paginated query ${i + 1} ends on a unique sort key`, () => {
        const column = finalSortColumn(q.orderBy);
        expect({
          orderBy: q.orderBy,
          finalColumn: column,
          near: q.label,
        }).toEqual({
          orderBy: q.orderBy,
          finalColumn: expect.stringMatching(new RegExp(`^(${[...UNIQUE_SORT_KEYS].join('|')})$`)),
          near: q.label,
        });
      });
    });
  }
});
