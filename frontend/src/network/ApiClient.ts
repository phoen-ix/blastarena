import { API_URL } from '../config';
import { AuthManager } from './AuthManager';
import { i18n } from '../i18n';

/**
 * A failed API request. Carries the server's machine-readable `code` (e.g. INVALID_CREDENTIALS)
 * and the HTTP status, so callers can translate the error instead of showing the English text.
 * A plain Error dropped both, and AuthUI.translateError never matched anything.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Build an ApiError from a non-2xx response, keeping field-level validation details. */
async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => ({ error: 'Request failed' }));
  let message: string = body.error || `HTTP ${response.status}`;
  if (body.details?.length) {
    const fieldErrors = body.details
      .map((d: { field: string; message: string }) => `${d.field}: ${d.message}`)
      .join(', ');
    message += ` (${fieldErrors})`;
  }
  return new ApiError(
    message,
    response.status,
    typeof body.code === 'string' ? body.code : undefined,
  );
}

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
   * Send with the access token, and on a 401 refresh once and retry. Returns the final response,
   * successful or not; the callers decide how to read it.
   */
  private async send(
    path: string,
    init: RequestInit,
    headers: Record<string, string>,
    skipAuthRetry: boolean,
  ): Promise<Response> {
    const carriedToken = this.authManager?.getAccessToken() ?? null;
    if (carriedToken) {
      headers['Authorization'] = `Bearer ${carriedToken}`;
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
        return fetch(`${API_URL}${path}`, {
          ...init,
          headers,
          credentials: 'include',
        });
      }

      // Only a request that carried a token had a session that could expire. A guest (or anyone
      // before login) has none, and logging out here threw open-world guests out of the lobby
      // on the first auth-only request.
      if (carriedToken) {
        this.authManager.logout();
        throw new ApiError('Session expired', 401, 'TOKEN_EXPIRED');
      }
    }

    return response;
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
    const response = await this.send(path, init, headers, skipAuthRetry);
    if (!response.ok) throw await toApiError(response);
    return response.json();
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    skipAuthRetry = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Language': i18n.language || 'en',
      ...((options.headers as Record<string, string>) || {}),
    };
    return this.fetchWithAuth<T>(path, options, headers, skipAuthRetry);
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  /**
   * GET a non-JSON body (a file download) with the same auth and refresh handling as get().
   * A bare fetch() sent no Authorization header, so every admin download came back 401.
   */
  async download(path: string): Promise<Response> {
    const response = await this.send(path, {}, { 'X-Language': i18n.language || 'en' }, false);
    if (!response.ok) throw await toApiError(response);
    return response;
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
