import { execute } from '../db/connection';

/**
 * Append one row to the admin audit log.
 *
 * The literal `INSERT INTO admin_actions …` statement was repeated at ~59 call sites across
 * routes/admin.ts and four services, each with its own five-element parameter array. One helper
 * keeps the column list in a single place. Behaviour is identical: same columns, same values,
 * awaited at the same point in each caller. (audit G12)
 *
 * `targetId` is `INT NOT NULL` in the schema — pass 0 for bulk or system-wide actions.
 * `details` is a free-form string (often JSON), or null.
 */
export async function logAdminAction(
  adminId: number,
  action: string,
  targetType: string,
  targetId: number,
  details: string | null,
): Promise<void> {
  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, action, targetType, targetId, details],
  );
}
