import { Request, Response, NextFunction } from 'express';
import { query } from '../db/connection';
import { RowDataPacket } from 'mysql2';

interface EmailCheckRow extends RowDataPacket {
  email_verified: boolean;
}

/**
 * Require a verified email.
 *
 * The answer normally comes from the `emailVerified` claim on the access token, so this costs
 * nothing. It used to run `SELECT email_verified FROM users WHERE id = ?` on EVERY authenticated
 * request across 34 route registrations — a round-trip per request for a flag that changes at most
 * once in an account's life.
 *
 * Trusting the claim is safe because the flag is monotonic: nothing in the codebase ever sets
 * `email_verified` back to FALSE, and the one false->true transition (verifyEmail) happens on an
 * account that holds no access token, since registration issues no session. So a stale `true`
 * cannot occur, and a stale `false` is bounded by the 15-minute token lifetime — refreshAccessToken
 * re-reads the column from the database on every rotation, so it self-heals.
 *
 * `undefined` means a token signed before the claim existed. Those fall back to the query rather
 * than being treated as unverified, so deploying this does not sign out every session in flight.
 * The fallback is also what still catches a deleted user. (audit EMAILVERIFIED-CLAIM-1)
 */
export async function emailVerifiedMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  if (req.user.emailVerified === true) {
    next();
    return;
  }
  if (req.user.emailVerified === false) {
    res.status(403).json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
    return;
  }

  // Legacy token with no claim — ask the database.
  try {
    const rows = await query<EmailCheckRow[]>('SELECT email_verified FROM users WHERE id = ?', [
      req.user.userId,
    ]);
    if (rows.length === 0) {
      res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }
    if (!rows[0].email_verified) {
      res.status(403).json({ error: 'Email not verified', code: 'EMAIL_NOT_VERIFIED' });
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
}
