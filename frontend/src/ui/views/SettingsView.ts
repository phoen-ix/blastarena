import { ILobbyView, ViewDeps } from './types';
import { SettingsUI } from '../SettingsUI';

export class SettingsView implements ILobbyView {
  readonly viewId = 'settings';

  private panel: SettingsUI;

  constructor(deps: ViewDeps) {
    this.panel = new SettingsUI(deps.authManager, deps.notifications);
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
