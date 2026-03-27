import { API_URL } from '../config';
import { AuthManager } from './AuthManager';

class ApiClientClass {
  private authManager: AuthManager | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setAuthManager(manager: AuthManager): void {
    this.authManager = manager;
  }

  /**
   * Deduplicated token refresh — concurrent 401s share a single refresh call.
   */
  private async refreshToken(): Promise<boolean> {
    if (!this.authManager) return false;

    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.authManager.refresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Core fetch wrapper with auth retry. Used by all request methods.
   */
  private async fetchWithAuth<T>(
    path: string,
    init: RequestInit,
    headers: Record<string, string>,
    skipAuthRetry: boolean,
  ): Promise<T> {
    if (this.authManager?.getAccessToken()) {
      headers['Authorization'] = `Bearer ${this.authManager.getAccessToken()}`;
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (response.status === 401 && this.authManager && !skipAuthRetry) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${this.authManager.getAccessToken()}`;
        const retryResponse = await fetch(`${API_URL}${path}`, {
          ...init,
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
      let message = error.error || `HTTP ${response.status}`;
      if (error.details?.length) {
        const fieldErrors = error.details
          .map((d: { field: string; message: string }) => `${d.field}: ${d.message}`)
          .join(', ');
        message += ` (${fieldErrors})`;
      }
      throw new Error(message);
    }

    return response.json();
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    skipAuthRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    return this.fetchWithAuth<T>(path, options, headers, skipAuthRetry);
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

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    // Do NOT set Content-Type — browser auto-sets it with multipart boundary
    return this.fetchWithAuth<T>(path, { method: 'POST', body: formData }, {}, false);
  }

  async putForm<T>(path: string, formData: FormData): Promise<T> {
    return this.fetchWithAuth<T>(path, { method: 'PUT', body: formData }, {}, false);
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export const ApiClient = new ApiClientClass();
