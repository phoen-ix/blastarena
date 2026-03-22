import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, API_URL } from '../config';
import { ClientToServerEvents, ServerToClientEvents } from '@blast-arena/shared';
import { AuthManager } from './AuthManager';

/** Extract parameter types from an event handler function type */
type EventParams<T> = T extends (...args: infer P) => void ? P : never;

/** Union of all server-to-client event names */
type ServerEventName = keyof ServerToClientEvents;

/** Union of all client-to-server event names */
type ClientEventName = keyof ClientToServerEvents;

export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private authManager: AuthManager;
  private overlay: HTMLElement | null = null;
  private knownBuildId: string | null = null;
  private healthPollTimer: ReturnType<typeof setInterval> | null = null;

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

  // Typed wrappers around Socket.io methods. We use Function casts internally because
  // Socket.io's heavily overloaded method signatures don't resolve through generic wrappers,
  // but the public API is fully typed via ClientToServerEvents / ServerToClientEvents.
  /* eslint-disable @typescript-eslint/no-unsafe-function-type */
  emit<E extends ClientEventName>(event: E, ...args: EventParams<ClientToServerEvents[E]>): void {
    if (!this.socket) return;
    (this.socket.emit as Function).call(this.socket, event, ...args);
  }

  on<E extends ServerEventName>(
    event: E,
    handler: (...args: EventParams<ServerToClientEvents[E]>) => void,
  ): void {
    if (!this.socket) return;
    (this.socket.on as Function).call(this.socket, event, handler);
  }

  off<E extends ServerEventName>(
    event: E,
    handler?: (...args: EventParams<ServerToClientEvents[E]>) => void,
  ): void {
    if (!this.socket) return;
    if (handler) {
      (this.socket.off as Function).call(this.socket, event, handler);
    } else {
      // Call with exactly 1 argument so component-emitter's
      // `arguments.length === 1` check triggers "remove all listeners for event"
      (this.socket.off as Function).call(this.socket, event);
    }
  }
  /* eslint-enable @typescript-eslint/no-unsafe-function-type */

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

  private startHealthPoll(): void {
    if (this.healthPollTimer) return;
    this.healthPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.buildId) {
          console.log('Backend is back, reloading page...');
          this.stopHealthPoll();
          window.location.reload();
        }
      } catch {
        // Still down, keep polling
      }
    }, 3000);
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
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
    this.startHealthPoll();
  }

  private hideOverlay(): void {
    this.stopHealthPoll();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
