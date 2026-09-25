import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, API_URL } from '../config';
import { ClientToServerEvents, ServerToClientEvents } from '@blast-arena/shared';
import { AuthManager } from './AuthManager';
import { i18n, t } from '../i18n';
import { setHtml } from '../utils/html';

/** Extract parameter types from an event handler function type */
type EventParams<T> = T extends (...args: infer P) => void ? P : never;

/** Union of all server-to-client event names */
type ServerEventName = keyof ServerToClientEvents;

/** Union of all client-to-server event names */
type ClientEventName = keyof ClientToServerEvents;

/** How long a healthy backend with no socket reconnect is tolerated before reloading the page. */
const RELOAD_AFTER_MS = 20_000;

export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private authManager: AuthManager;
  private overlay: HTMLElement | null = null;
  private knownBuildId: string | null = null;
  private healthPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Set after the first successful connect of the current socket. */
  private connectedOnce = false;
  private reconnectListeners = new Set<() => void>();

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  connect(): void {
    // `active` covers "connecting" as well as "connected". Guarding on `connected` alone let a
    // second call during the in-flight handshake (e.g. Play-as-Guest within the first ~100 ms of
    // the background arena) create a second socket and orphan the first, listeners and all.
    // (audit C8)
    if (this.socket?.active) return;

    const token = this.authManager.getAccessToken();
    if (!token) return;

    this.discardStaleSocket();
    this.connectedOnce = false;
    this.socket = io(SOCKET_URL, {
      // Evaluated on every (re)connect: the current access token and language, not the ones from
      // login time (a reconnect after the 15-minute token lifetime was always refused).
      auth: (cb) => cb({ token: this.authManager.getAccessToken(), locale: i18n.language }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.hideOverlay();
      this.checkBuild();
      this.notifyConnected();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      // Don't show overlay for intentional disconnects
      if (reason !== 'io client disconnect') {
        this.showOverlay();
      }
    });

    const socket = this.socket;
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      if (error.message === 'EMAIL_NOT_VERIFIED') {
        // Don't show reconnecting overlay — the VerificationUI handles this
        this.socket?.disconnect();
        return;
      }
      // Expired access token. socket.io does not retry a handshake the server refused, so refresh
      // the token and connect again by hand; `auth` above sends the new one.
      if (error.message === 'Invalid token') {
        void this.authManager.refresh().then((ok) => {
          if (ok && this.socket === socket && !socket.active) socket.connect();
        });
      }
      this.showOverlay();
    });
  }

  /**
   * Called after every reconnect (not the first connect). The server keeps no room memberships
   * across a reconnect, so scenes re-join whatever they were showing.
   */
  onReconnect(listener: () => void): void {
    this.reconnectListeners.add(listener);
  }

  offReconnect(listener: () => void): void {
    this.reconnectListeners.delete(listener);
  }

  private notifyConnected(): void {
    if (this.connectedOnce) {
      for (const listener of [...this.reconnectListeners]) listener();
    }
    this.connectedOnce = true;
  }

  /** Connect as guest (no auth token — for open world) */
  connectAsGuest(): void {
    if (this.socket?.active) return; // connecting or connected (audit C8)

    this.discardStaleSocket();
    this.connectedOnce = false;
    this.socket = io(SOCKET_URL, {
      auth: (cb) => cb({ guest: true, locale: i18n.language }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected (guest)');
      this.hideOverlay();
      this.notifyConnected();
    });

    this.socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        this.showOverlay();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error (guest):', error.message);
      this.showOverlay();
    });
  }

  /**
   * Drop a socket that is neither connecting nor connected (e.g. after a server-side disconnect,
   * which clears `active` without going through disconnect()). Its listeners belong to scenes
   * that registered on the old instance; they are removed so the dead socket can be collected
   * instead of lingering with a manager that still holds it. (audit C8)
   */
  private discardStaleSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
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
    const overlaySince = Date.now();
    this.healthPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        // socket.io reconnects on its own and the scenes re-join (onReconnect). Reload only for a
        // new deploy, or when the backend has been healthy for a while and the socket still has
        // not come back. Reloading on the first healthy poll turned every 3 s blip into a reload.
        const redeployed = !!this.knownBuildId && data.buildId !== this.knownBuildId;
        const stuck = Date.now() - overlaySince >= RELOAD_AFTER_MS;
        if (data.buildId && data.status === 'ok' && (redeployed || stuck)) {
          // Verify the page itself loads (not nginx 502.html) before reloading
          const pageRes = await fetch(window.location.href, { cache: 'no-store' });
          if (!pageRes.ok) return;
          const body = await pageRes.text();
          if (!body.includes('game-container')) return; // Still serving error page

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
    setHtml(
      this.overlay,
      `
      <div class="connection-message">
        <div class="connection-spinner"></div>
        <div>${t('ui:connection.reconnecting')}</div>
      </div>
    `,
    );
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
