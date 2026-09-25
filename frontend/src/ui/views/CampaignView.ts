import { ILobbyView, ViewDeps } from './types';
import { CampaignUI } from '../CampaignUI';
import { PartyBar } from '../PartyBar';
import { t } from '../../i18n';

export class CampaignView implements ILobbyView {
  readonly viewId = 'campaign';
  get title() {
    return t('campaign:title');
  }

  private panel: CampaignUI;

  constructor(deps: ViewDeps, partyBar: PartyBar) {
    this.panel = new CampaignUI(deps.socketClient, deps.notifications, partyBar, deps.authManager);
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
