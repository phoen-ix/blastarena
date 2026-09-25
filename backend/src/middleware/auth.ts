import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { AuthPayload } from '@blast-arena/shared';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthPayload;
  }
}

/** Access tokens carry this `typ`; see verifyAccessToken. */
export const ACCESS_TOKEN_TYPE = 'access';

/**
 * Verify a bearer token as an access token. The server signs other short-lived tokens with the
 * same secret (2FA challenge, local co-op); those carry a `purpose` and are refused here. Access
 * tokens carry `typ: 'access'`; tokens issued before that claim existed have neither claim.
 */
export function verifyAccessToken(token: string): AuthPayload {
  const claims = jwt.verify(token, getConfig().JWT_SECRET, {
    algorithms: ['HS256'],
  }) as AuthPayload & {
    typ?: unknown;
    purpose?: unknown;
  };
  if (
    claims.purpose !== undefined ||
    (claims.typ !== undefined && claims.typ !== ACCESS_TOKEN_TYPE)
  ) {
    throw new Error('Not an access token');
  }
  return claims;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}
