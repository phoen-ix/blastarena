import { API_URL } from '../config';
import { AuthManager } from './AuthManager';

class ApiClientClass {
  private authManager: AuthManager | null = null;

  setAuthManager(manager: AuthManager): void {
    this.authManager = manager;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    skipAuthRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.authManager?.getAccessToken()) {
      headers['Authorization'] = `Bearer ${this.authManager.getAccessToken()}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (response.status === 401 && this.authManager && !skipAuthRetry) {
      // Try to refresh
      const refreshed = await this.authManager.refresh();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.authManager.getAccessToken()}`;
        const retryResponse = await fetch(`${API_URL}${path}`, {
          ...options,
          headers,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(error.error || 'Request failed');
        }
        return retryResponse.json();
      }

      this.authManager.logout();
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body?: unknown, skipAuthRetry = false): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      skipAuthRetry,
    );
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const ApiClient = new ApiClientClass();
