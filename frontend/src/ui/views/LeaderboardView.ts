import { ILobbyView, ViewDeps } from './types';
import { LeaderboardUI } from '../LeaderboardUI';

export class LeaderboardView implements ILobbyView {
  readonly viewId = 'leaderboard';

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
