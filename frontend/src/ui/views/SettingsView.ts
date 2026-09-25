import { ILobbyView, ViewDeps } from './types';
import { SettingsUI } from '../SettingsUI';
import { t } from '../../i18n';

export class SettingsView implements ILobbyView {
  readonly viewId = 'settings';
  get title() {
    return t('ui:settings.title');
  }

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
