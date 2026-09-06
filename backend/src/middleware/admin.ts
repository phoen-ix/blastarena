import { Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2';
import { UserRole, getErrorMessage } from '@blast-arena/shared';
import { query } from '../db/connection';
import { logger } from '../utils/logger';

interface RoleRow extends RowDataPacket {
  role: string;
  is_deactivated: boolean | number;
}

/**
 * The account's current role, read from the database rather than the JWT claim.
 *
 * Socket connections already re-read the role on connect, but the REST admin surface trusted the
 * access token's claim — so a demoted or deactivated admin kept every `/api/admin/*` endpoint for
 * up to 15 minutes (the token lifetime). One primary-key lookup per admin request closes that
 * gap; it is admin-only traffic, so the cost is negligible. The result is cached on `res.locals`
 * so `staffMiddleware` + `adminOnlyMiddleware` on the same request cost one query, not two, and
 * `req.user.role` is refreshed so downstream handlers see the live value too. (audit B18)
 *
 * Returns the role, or null after having already sent the error response.
 */
async function resolveRole(
  req: Request,
  res: Response,
  forbiddenMessage: string,
): Promise<UserRole | null> {
  if (!req.user) {
    res.status(403).json({ error: forbiddenMessage, code: 'FORBIDDEN' });
    return null;
  }
  const cached = res.locals.dbRole as UserRole | undefined;
  if (cached) return cached;

  let rows: RoleRow[];
  try {
    rows = await query<RoleRow[]>('SELECT role, is_deactivated FROM users WHERE id = ?', [
      req.user.userId,
    ]);
  } catch (err) {
    logger.error(
      { err: getErrorMessage(err), userId: req.user.userId },
      'Role lookup failed for admin request',
    );
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    return null;
  }

  if (rows.length === 0) {
    res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    return null;
  }
  if (rows[0].is_deactivated) {
    res.status(403).json({ error: 'Account has been deactivated', code: 'DEACTIVATED' });
    return null;
  }

  const role = rows[0].role as UserRole;
  res.locals.dbRole = role;
  req.user.role = role;
  return role;
}

// Allows both admin and moderator roles
export async function staffMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const role = await resolveRole(req, res, 'Staff access required');
  if (role === null) return;
  if (role !== 'admin' && role !== 'moderator') {
    res.status(403).json({ error: 'Staff access required', code: 'FORBIDDEN' });
    return;
  }
  next();
}

// Only allows admin role
export async function adminOnlyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const role = await resolveRole(req, res, 'Admin access required');
  if (role === null) return;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admin access required', code: 'FORBIDDEN' });
    return;
  }
  next();
}
