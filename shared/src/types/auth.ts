export type UserRole = 'user' | 'moderator' | 'admin';

export interface User {
  id: number;
  username: string;
  emailHint: string;
  emailVerified: boolean;
  role: UserRole;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: number;
  username: string;
  role: UserRole;
  language: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: UserRole;
  /**
   * Whether the account's email was verified when this token was issued.
   *
   * Optional because tokens signed before the claim existed do not carry it — consumers must treat
   * `undefined` as "unknown" and fall back to the database rather than as `false`, or every session
   * in flight is rejected at deploy. The flag is monotonic (nothing ever sets email_verified back
   * to FALSE) and the one false->true transition happens on an account holding no token, so a
   * stale `true` is impossible and a stale `false` self-heals on the next refresh.
   * (audit EMAILVERIFIED-CLAIM-1)
   */
  emailVerified?: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

/**
 * Registration response. No session is issued at registration — the account must verify its email
 * before signing in. The shape is identical whether or not the email was already registered, so it
 * cannot be used to enumerate registered emails. (audit EMAIL-005)
 */
export interface RegisterResponse {
  emailVerificationRequired: true;
}

export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
}

export interface TotpChallengeResponse {
  totpRequired: true;
  totpToken: string;
}

export interface TotpSetupResponse {
  qrDataUri: string;
  secret: string;
  backupCodes: string[];
}

export function isTotpChallengeResponse(
  response: AuthResponse | TotpChallengeResponse,
): response is TotpChallengeResponse {
  return 'totpRequired' in response && (response as TotpChallengeResponse).totpRequired === true;
}
