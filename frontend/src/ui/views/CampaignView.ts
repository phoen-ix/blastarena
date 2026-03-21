import { ILobbyView, ViewDeps } from './types';
import { CampaignUI } from '../CampaignUI';
import { PartyBar } from '../PartyBar';

export class CampaignView implements ILobbyView {
  readonly viewId = 'campaign';
  readonly title = 'Campaign';

  private panel: CampaignUI;

  constructor(deps: ViewDeps, partyBar: PartyBar) {
    this.panel = new CampaignUI(deps.socketClient, deps.notifications, () => {}, partyBar);
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
