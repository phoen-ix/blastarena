export type UserRole = 'user' | 'moderator' | 'admin';

export interface User {
  id: number;
  username: string;
  email: string;
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
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: UserRole;
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

export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
}
