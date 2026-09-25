import { ILobbyView, ViewDeps } from './types';
import { HelpUI } from '../HelpUI';
import { t } from '../../i18n';

export class HelpView implements ILobbyView {
  readonly viewId = 'help';
  get title() {
    return t('help:title');
  }

  private panel: HelpUI;

  constructor(deps: ViewDeps) {
    this.panel = new HelpUI(deps.authManager);
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
