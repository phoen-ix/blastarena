import { ApiClient } from './ApiClient';
import { AuthResponse, PublicUser } from '@blast-arena/shared';

export type AuthChangeCallback = (user: PublicUser | null) => void;

export class AuthManager {
  private accessToken: string | null = null;
  private currentUser: PublicUser | null = null;
  private listeners: AuthChangeCallback[] = [];

  constructor() {
    ApiClient.setAuthManager(this);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getUser(): PublicUser | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  onChange(callback: AuthChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  private setAuth(response: AuthResponse): void {
    this.accessToken = response.accessToken;
    this.currentUser = response.user;
    this.notify();
  }

  async register(username: string, email: string, password: string): Promise<void> {
    const response = await ApiClient.post<AuthResponse>('/auth/register', {
      username,
      email,
      password,
    });
    this.setAuth(response);
  }

  async login(username: string, password: string): Promise<void> {
    const response = await ApiClient.post<AuthResponse>('/auth/login', {
      username,
      password,
    });
    this.setAuth(response);
  }

  async refresh(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) return false;

      const data: AuthResponse = await response.json();
      this.setAuth(data);
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await ApiClient.post('/auth/logout');
    } catch {
      // Ignore errors during logout
    }
    this.accessToken = null;
    this.currentUser = null;
    this.notify();
  }

  updateUser(updates: Partial<PublicUser>): void {
    if (this.currentUser) {
      this.currentUser = { ...this.currentUser, ...updates };
      this.notify();
    }
  }

  async tryAutoLogin(): Promise<boolean> {
    return this.refresh();
  }
}
