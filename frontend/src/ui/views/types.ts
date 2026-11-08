import { SocketClient } from '../../network/SocketClient';
import { AuthManager } from '../../network/AuthManager';
import { NotificationUI } from '../NotificationUI';

export interface ILobbyView {
  readonly viewId: string;
  getHeaderActions?(): string;
  render(container: HTMLElement): Promise<void>;
  destroy(): void;
}

export interface ViewDeps {
  socketClient: SocketClient;
  authManager: AuthManager;
  notifications: NotificationUI;
}
