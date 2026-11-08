import { ILobbyView, ViewDeps } from './types';
import { HelpUI } from '../HelpUI';

export class HelpView implements ILobbyView {
  readonly viewId = 'help';

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
