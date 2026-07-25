import { ILobbyView, ViewDeps } from './types';
import { AdminUI } from '../AdminUI';
import { t } from '../../i18n';

export class AdminView implements ILobbyView {
  readonly viewId = 'admin';
  get title() {
    return t('ui:sidebar.admin');
  }

  private panel: AdminUI;

  constructor(deps: ViewDeps, options?: Record<string, unknown>) {
    const initialTab = typeof options?.initialTab === 'string' ? options.initialTab : undefined;
    this.panel = new AdminUI(
      deps.socketClient,
      deps.authManager,
      deps.notifications,
      () => {},
      initialTab,
    );
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
