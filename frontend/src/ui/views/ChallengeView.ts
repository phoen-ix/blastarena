import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { ActiveChallengeInfo, ChallengeScore, TileType, GameMode, Room } from '@blast-arena/shared';
import { renderMapPreview } from '../../utils/mapPreview';
import { escapeHtml, setHtml } from '../../utils/html';
import { t } from '../../i18n';

export class ChallengeView implements ILobbyView {
  readonly viewId = 'challenge';
  get title() {
    return t('ui:challenge.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;

  constructor(deps: ViewDeps) {
    this.deps = deps;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    setHtml(
      container,
      `<div class="panel-content" style="padding:1rem;"><p style="color:var(--text-muted);">${t('ui:challenge.loading')}</p></div>`,
    );

    try {
      const res = await ApiClient.get<ActiveChallengeInfo | { challenge: null }>(
        '/challenges/active',
      );
      if (!res.challenge) {
        setHtml(
          container,
          `
          <div class="panel-content" style="padding:2rem; text-align:center;">
            <p style="color:var(--text-muted); font-size:1.1rem;">${t('ui:challenge.noActive')}</p>
          </div>`,
        );
        return;
      }
      this.renderChallenge(container, res as ActiveChallengeInfo);
    } catch {
      setHtml(
        container,
        `<div class="panel-content" style="padding:1rem;"><p style="color:var(--danger);">${t('ui:challenge.loadError')}</p></div>`,
      );
    }
  }

  private renderChallenge(container: HTMLElement, info: ActiveChallengeInfo): void {
    const { challenge, mapTiles, topScores } = info;

    setHtml(
      container,
      `
      <div style="padding:1rem; max-width:700px; margin:0 auto;">
        <div class="panel-header" style="margin-bottom:1rem;">
          <h2>${escapeHtml(challenge.title)}</h2>
        </div>

        <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;">
          <div id="challenge-map-preview" style="flex-shrink:0;"></div>
          <div style="flex:1; min-width:200px;">
            ${challenge.description ? `<p style="margin-bottom:0.5rem;">${escapeHtml(challenge.description)}</p>` : ''}
            <div class="mini-stat" style="margin-bottom:0.25rem;">
              <span style="color:var(--text-muted);">${t('ui:challenge.map')}:</span>
              <span>${escapeHtml(challenge.mapName)}</span>
            </div>
            <div class="mini-stat" style="margin-bottom:0.25rem;">
              <span style="color:var(--text-muted);">${t('ui:challenge.creator')}:</span>
              <span style="color:var(--primary);">${escapeHtml(challenge.mapCreator)}</span>
            </div>
            <div class="mini-stat" style="margin-bottom:0.25rem;">
              <span style="color:var(--text-muted);">${t('ui:challenge.mode')}:</span>
              <span>${escapeHtml(challenge.gameMode.toUpperCase())}</span>
            </div>
            <div class="mini-stat" style="margin-bottom:0.5rem;">
              <span style="color:var(--text-muted);">${t('ui:challenge.dates')}:</span>
              <span>${challenge.startDate} — ${challenge.endDate}</span>
            </div>
            <button class="btn btn-primary" id="challenge-play-btn">${t('ui:challenge.play')}</button>
          </div>
        </div>

        <div class="panel-header" style="margin-bottom:0.5rem;">
          <h3>${t('ui:challenge.leaderboard')}</h3>
        </div>
        ${
          topScores.length > 0
            ? `<table class="data-table" style="width:100%;">
                <thead><tr>
                  <th>#</th>
                  <th>${t('ui:challenge.player')}</th>
                  <th>${t('ui:challenge.wins')}</th>
                  <th>${t('ui:challenge.kills')}</th>
                  <th>${t('ui:challenge.games')}</th>
                </tr></thead>
                <tbody>
                  ${topScores
                    .map(
                      (s: ChallengeScore, i: number) => `
                    <tr>
                      <td>${i + 1}</td>
                      <td>${escapeHtml(s.username)}</td>
                      <td>${s.wins}</td>
                      <td>${s.kills}</td>
                      <td>${s.gamesPlayed}</td>
                    </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>`
            : `<p style="color:var(--text-muted); text-align:center; padding:1rem;">${t('ui:challenge.noScores')}</p>`
        }
      </div>`,
    );

    // Render map preview
    if (mapTiles) {
      const previewEl = container.querySelector('#challenge-map-preview');
      if (previewEl) {
        const canvas = renderMapPreview(mapTiles as TileType[][], { maxCanvasSize: 180 });
        canvas.style.borderRadius = '4px';
        canvas.style.border = '1px solid var(--border)';
        previewEl.appendChild(canvas);
      }
    }

    // Play button — creates a room with the challenge map
    container.querySelector('#challenge-play-btn')?.addEventListener('click', () => {
      this.deps.socketClient.emit(
        'room:create',
        {
          name: challenge.title,
          config: {
            gameMode: challenge.gameMode as GameMode,
            maxPlayers: 8,
            mapWidth: 15,
            mapHeight: 13,
            roundTime: 180,
            customMapId: challenge.customMapId,
          },
        },
        (response: { success: boolean; room?: Room; error?: string }) => {
          if (response.success && response.room) {
            window.dispatchEvent(new CustomEvent('navigate-to-room', { detail: response.room }));
          } else {
            this.deps.notifications.error(response.error || 'Failed to create room');
          }
        },
      );
    });
  }

  destroy(): void {
    this.container = null;
  }
}
