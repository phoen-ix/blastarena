import { Request, Response, NextFunction } from 'express';
import { query } from '../db/connection';
import { RowDataPacket } from 'mysql2';

interface EmailCheckRow extends RowDataPacket {
  email_verified: boolean;
}

export async function emailVerifiedMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

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
