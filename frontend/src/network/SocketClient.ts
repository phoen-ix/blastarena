import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, API_URL } from '../config';
import { ClientToServerEvents, ServerToClientEvents } from '@blast-arena/shared';
import { AuthManager } from './AuthManager';

export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private authManager: AuthManager;
  private overlay: HTMLElement | null = null;
  private knownBuildId: string | null = null;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  connect(): void {
    if (this.socket?.connected) return;

    const token = this.authManager.getAccessToken();
    if (!token) return;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.hideOverlay();
      this.checkBuild();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      // Don't show overlay for intentional disconnects
      if (reason !== 'io client disconnect') {
        this.showOverlay();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      this.showOverlay();
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.hideOverlay();
  }

  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // Socket.io's overloaded method signatures don't work with generic wrappers,
  // so we cast to a minimal interface. Event names and payloads are still typed at call sites.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
  emit(event: string, ...args: any[]): void {
    if (!this.socket) return;
    (this.socket.emit as Function).call(this.socket, event, ...args);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.socket) return;
    (this.socket.on as Function).call(this.socket, event, handler);
  }

  off(event: string, handler?: (...args: any[]) => void): void {
    if (!this.socket) return;
    (this.socket.off as Function).call(this.socket, event, handler);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */

  /** Check if the server has been rebuilt since we last connected */
  private async checkBuild(): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (!res.ok) return;
      const data = await res.json();
      const buildId = data.buildId;
      if (!buildId) return;

      if (this.knownBuildId === null) {
        // First connection — just store the ID
        this.knownBuildId = buildId;
      } else if (this.knownBuildId !== buildId) {
        // Server was rebuilt — force refresh
        console.log('New server build detected, reloading page...');
        window.location.reload();
      }
    } catch {
      // Health check failed, ignore — socket reconnection handles it
    }
  }

  private showOverlay(): void {
    if (this.overlay) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'connection-overlay';
    this.overlay.innerHTML = `
      <div class="connection-message">
        <div class="connection-spinner"></div>
        <div>Reconnecting to server...</div>
      </div>
    `;
    document.body.appendChild(this.overlay);
  }

  private hideOverlay(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
