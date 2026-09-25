import { ILobbyView, ViewDeps } from './types';
import { LeaderboardUI } from '../LeaderboardUI';
import { t } from '../../i18n';

export class LeaderboardView implements ILobbyView {
  readonly viewId = 'leaderboard';
  get title() {
    return t('ui:leaderboard.title');
  }

  private panel: LeaderboardUI;

  constructor(deps: ViewDeps, onViewProfile: (userId: number) => void) {
    this.panel = new LeaderboardUI(deps.notifications, onViewProfile);
  }

  async render(container: HTMLElement): Promise<void> {
    await this.panel.renderEmbedded(container);
  }

  destroy(): void {
    this.panel.destroy();
  }
}
