import { ApiClient } from '../../network/ApiClient';
import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import {
  SimulationBatchStatus,
  SimulationGameResult,
  SimulationConfig,
  SimulationDefaults,
  GameState,
  ReplayData,
  PowerUpType,
  POWERUP_DEFINITIONS,
  GAME_MODES,
  BotAIEntry,
} from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';
import game from '../../main';
import { t } from '../../i18n';

type ViewMode = 'list' | 'detail';

export class SimulationsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private viewMode: ViewMode = 'list';
  private detailBatchId: string | null = null;
  private detailResults: SimulationGameResult[] = [];
  private activeBatch: SimulationBatchStatus | null = null;

  // Pagination and sorting for detail view
  private detailPage: number = 1;
  private detailPageSize: number = 25;
  private detailSortKey: string = 'gameIndex';
  private detailSortAsc: boolean = true;

  constructor(notifications: NotificationUI, socketClient: SocketClient) {
    this.notifications = notifications;
    this.socketClient = socketClient;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);

    // Listen for simulation socket events
    this.socketClient.on('sim:progress', this.handleProgress);
    this.socketClient.on('sim:gameResult', this.handleGameResult);
    this.socketClient.on('sim:completed', this.handleCompleted);
    this.socketClient.on('sim:queueUpdate', this.handleQueueUpdate);

    await this.loadBatchList();
    this.refreshInterval = setInterval(() => {
      if (this.viewMode === 'list') this.loadBatchList();
    }, 5000);
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.socketClient.off('sim:progress', this.handleProgress);
    this.socketClient.off('sim:gameResult', this.handleGameResult);
    this.socketClient.off('sim:completed', this.handleCompleted);
    this.socketClient.off('sim:queueUpdate', this.handleQueueUpdate);
    this.container?.remove();
    this.container = null;
    this.viewMode = 'list';
    this.detailBatchId = null;
    this.detailResults = [];
    this.activeBatch = null;
  }

  private handleProgress = (data: SimulationBatchStatus) => {
    this.activeBatch = data;
    if (this.viewMode === 'list') {
      this.loadBatchList();
    } else if (this.viewMode === 'detail' && this.detailBatchId === data.batchId) {
      this.renderDetailView(data);
    }
  };

  private handleGameResult = (data: { batchId: string; result: SimulationGameResult }) => {
    if (this.detailBatchId === data.batchId) {
      this.detailResults.push(data.result);
      if (this.activeBatch) {
        this.renderDetailView(this.activeBatch);
      }
    }
  };

  private handleQueueUpdate = () => {
    if (this.viewMode === 'list') {
      this.loadBatchList();
    }
  };

  private handleCompleted = (data: { batchId: string; status: SimulationBatchStatus }) => {
    this.activeBatch = null;
    this.notifications.success(
      t('admin:simulations.batchCompleted', { count: data.status.gamesCompleted }),
    );
    if (this.viewMode === 'list') {
      this.loadBatchList();
    } else if (this.detailBatchId === data.batchId) {
      this.renderDetailView(data.status);
    }
  };

  private async loadBatchList(): Promise<void> {
    if (!this.container) return;
    this.viewMode = 'list';

    try {
      const resp = await ApiClient.get<{ batches: SimulationBatchStatus[]; total: number }>(
        '/admin/simulations',
      );
      if (!this.container) return;
      const batches = resp.batches ?? [];

      this.container.innerHTML = `
        <div class="sim-section-header">
          <h3>${t('admin:simulations.title')}</h3>
          <button class="btn btn-primary" id="sim-new-batch">${t('admin:simulations.newSimulation')}</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin:simulations.columns.mode')}</th>
              <th>${t('admin:simulations.columns.bots')}</th>
              <th>${t('admin:simulations.columns.difficulty')}</th>
              <th>${t('admin:simulations.columns.map')}</th>
              <th>${t('admin:simulations.columns.games')}</th>
              <th>${t('admin:simulations.columns.speed')}</th>
              <th>${t('admin:simulations.columns.status')}</th>
              <th>${t('admin:simulations.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${batches.map((b) => this.renderBatchRow(b)).join('')}
            ${batches.length === 0 ? `<tr><td colspan="8" class="sim-empty-row">${t('admin:simulations.noSimulations')}</td></tr>` : ''}
          </tbody>
        </table>
      `;

      this.container.querySelector('#sim-new-batch')?.addEventListener('click', () => {
        this.showConfigModal();
      });

      this.container.addEventListener('click', this.handleListClick);
    } catch {
      if (this.container) {
        this.container.innerHTML = `<div class="sim-error">${t('admin:simulations.errors.loadFailed')}</div>`;
      }
    }
  }

  private renderBatchRow(b: SimulationBatchStatus): string {
    const pct = b.totalGames > 0 ? Math.round((b.gamesCompleted / b.totalGames) * 100) : 0;
    const statusClass =
      b.status === 'queued'
        ? 'text-info'
        : b.status === 'running'
          ? 'text-accent'
          : b.status === 'completed'
            ? 'text-success'
            : b.status === 'cancelled'
              ? 'text-warning'
              : 'text-danger';
    const modeLabel = GAME_MODES[b.config.gameMode]?.name || b.config.gameMode;

    return `
      <tr>
        <td>${escapeHtml(modeLabel)}</td>
        <td>${b.config.botCount}</td>
        <td>${escapeHtml(b.config.botDifficulty)}</td>
        <td>${b.config.mapWidth}x${b.config.mapHeight}</td>
        <td>
          <div class="sim-games-cell">
            <span>${b.gamesCompleted}/${b.totalGames}</span>
            ${
              b.status === 'running'
                ? `
              <div class="sim-progress-mini">
                <div class="sim-progress-fill" style="width:${pct}%;"></div>
              </div>
            `
                : ''
            }
          </div>
        </td>
        <td>${b.config.speed === 'fast' ? t('admin:simulations.speedFast') : t('admin:simulations.speedRealtime')}</td>
        <td><span class="sim-status ${statusClass}">${b.status === 'queued' ? t('admin:simulations.statusQueued', { position: b.queuePosition }) : b.status}</span></td>
        <td class="sim-td-actions">
          ${
            b.status === 'queued'
              ? `<button class="btn-warn btn-sm" data-action="dequeue" data-batch="${escapeHtml(b.batchId)}">${t('admin:simulations.actions.remove')}</button>`
              : `
            <button class="btn btn-secondary btn-sm" data-action="view" data-batch="${escapeHtml(b.batchId)}">${t('admin:simulations.actions.view')}</button>
            ${
              b.status !== 'running'
                ? `<button class="btn-warn btn-sm" data-action="delete" data-batch="${escapeHtml(b.batchId)}">${t('admin:simulations.actions.delete')}</button>`
                : ''
            }
            ${
              b.status === 'running'
                ? `
              ${b.config.speed === 'realtime' ? `<button class="btn btn-secondary btn-sm" data-action="spectate" data-batch="${escapeHtml(b.batchId)}">${t('admin:simulations.actions.spectate')}</button>` : ''}
              <button class="btn-warn btn-sm" data-action="cancel" data-batch="${escapeHtml(b.batchId)}">${t('admin:simulations.actions.cancel')}</button>
            `
                : ''
            }
          `
          }
        </td>
      </tr>
    `;
  }

  private handleListClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const batchId = target.dataset.batch;
    if (!action || !batchId) return;

    if (action === 'view') {
      await this.showBatchDetail(batchId);
    } else if (action === 'cancel') {
      this.socketClient.emit('sim:cancel', { batchId }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:simulations.notifications.cancelRequested'));
        } else {
          this.notifications.error(res.error || t('admin:simulations.errors.cancelFailed'));
        }
      });
    } else if (action === 'spectate') {
      this.startSpectating(batchId);
    } else if (action === 'dequeue') {
      this.socketClient.emit('sim:cancel', { batchId }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:simulations.notifications.removedFromQueue'));
          this.loadBatchList();
        } else {
          this.notifications.error(res.error || t('admin:simulations.errors.removeFailed'));
        }
      });
    } else if (action === 'delete') {
      if (confirm(t('admin:simulations.confirmDelete'))) {
        try {
          await ApiClient.delete(`/admin/simulations/${batchId}`);
          this.notifications.success(t('admin:simulations.notifications.deleted'));
          this.loadBatchList();
        } catch {
          this.notifications.error(t('admin:simulations.errors.deleteFailed'));
        }
      }
    }
  };

  private startSpectating(batchId: string): void {
    this.socketClient.emit('sim:spectate', { batchId }, (res) => {
      if (!res.success) {
        this.notifications.error(res.error || t('admin:simulations.errors.spectateFailed'));
        return;
      }

      // Wait for the first sim:state to get the initial game state, then launch GameScene
      const stateHandler = (data: { batchId: string; state: GameState }) => {
        if (data.batchId !== batchId) return;
        this.socketClient.off('sim:state', stateHandler);

        this.launchGameScene(batchId, data.state);
      };
      this.socketClient.on('sim:state', stateHandler);

      // Timeout in case no state arrives (game between transitions)
      setTimeout(() => {
        this.socketClient.off('sim:state', stateHandler);
      }, 5000);
    });
  }

  private launchGameScene(batchId: string, initialState: GameState): void {
    // Clear all DOM overlays (admin panel, lobby, etc.)
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      while (uiOverlay.firstChild) {
        uiOverlay.removeChild(uiOverlay.firstChild);
      }
    }

    // Set registry values for GameScene
    const registry = game.registry;
    registry.set('initialGameState', initialState);
    registry.set('simulationSpectate', { batchId });

    // Get a running scene to use its ScenePlugin for scene transitions
    const activeScene = game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
    if (activeScene) {
      activeScene.scene.start('GameScene');
      activeScene.scene.launch('HUDScene');
    }
  }

  private async launchSimulationReplay(batchId: string, gameIndex: number): Promise<void> {
    try {
      this.notifications.info(t('admin:simulations.notifications.loadingReplay'));
      const replayData = await ApiClient.get<ReplayData>(
        `/admin/simulations/${batchId}/replay/${gameIndex}`,
      );

      if (!replayData || !replayData.frames || replayData.frames.length === 0) {
        this.notifications.error(t('admin:simulations.errors.replayEmpty'));
        return;
      }

      // Reconstruct initial GameState from first frame + stored map
      const firstFrame = replayData.frames[0];
      const initialState: GameState = {
        tick: firstFrame.tick,
        players: firstFrame.players,
        bombs: firstFrame.bombs,
        explosions: firstFrame.explosions,
        powerUps: firstFrame.powerUps,
        map: replayData.map,
        status: firstFrame.status,
        winnerId: firstFrame.winnerId,
        winnerTeam: firstFrame.winnerTeam,
        roundTime: firstFrame.roundTime,
        timeElapsed: firstFrame.timeElapsed,
      };
      if (firstFrame.zone) initialState.zone = firstFrame.zone;
      if (firstFrame.hillZone) initialState.hillZone = firstFrame.hillZone;
      if (firstFrame.kothScores) initialState.kothScores = firstFrame.kothScores;

      // Clear all DOM overlays (admin panel, lobby, etc.)
      const uiOverlay = document.getElementById('ui-overlay');
      if (uiOverlay) {
        while (uiOverlay.firstChild) {
          uiOverlay.removeChild(uiOverlay.firstChild);
        }
      }

      // Set registry values for GameScene
      const registry = game.registry;
      registry.set('initialGameState', initialState);
      registry.set('replayMode', true);
      registry.set('replayData', replayData);

      // Start GameScene and HUDScene
      const activeScene = game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
      if (activeScene) {
        activeScene.scene.start('GameScene');
        activeScene.scene.launch('HUDScene');
      }
    } catch {
      this.notifications.error(t('admin:simulations.errors.replayLoadFailed'));
    }
  }

  private async showBatchDetail(batchId: string): Promise<void> {
    if (!this.container) return;
    this.viewMode = 'detail';
    this.detailBatchId = batchId;

    try {
      const data = await ApiClient.get<{ results: SimulationGameResult[]; summary: any }>(
        `/admin/simulations/${batchId}`,
      );
      this.detailResults = data.results || [];

      const status: SimulationBatchStatus =
        this.activeBatch?.batchId === batchId ? this.activeBatch : data.summary;

      this.renderDetailView(status);
    } catch {
      this.notifications.error(t('admin:simulations.errors.detailLoadFailed'));
      this.loadBatchList();
    }
  }

  private renderDetailView(status: SimulationBatchStatus): void {
    if (!this.container || this.viewMode !== 'detail') return;

    const pct =
      status.totalGames > 0 ? Math.round((status.gamesCompleted / status.totalGames) * 100) : 0;
    const modeLabel = GAME_MODES[status.config.gameMode]?.name || status.config.gameMode;

    // Build win distribution
    const winCounts: Record<string, number> = {};
    for (const r of this.detailResults) {
      if (r.winnerName) {
        winCounts[r.winnerName] = (winCounts[r.winnerName] || 0) + 1;
      }
    }
    const winEntries = Object.entries(winCounts).sort((a, b) => b[1] - a[1]);

    const detailStatusClass =
      status.status === 'running'
        ? 'text-accent'
        : status.status === 'completed'
          ? 'text-success'
          : 'text-warning';

    this.container.innerHTML = `
      <div class="sim-back-row">
        <button class="btn btn-secondary btn-sm" id="sim-back-to-list">${t('admin:simulations.backToList')}</button>
      </div>

      <div class="sim-info-card">
        <div class="sim-detail-header">
          <h3>${t('admin:simulations.simulationLabel', { mode: escapeHtml(modeLabel) })}</h3>
          <span class="sim-status ${detailStatusClass}">${status.status}</span>
        </div>
        <div class="sim-info-grid">
          <div>${t('admin:simulations.detail.bots')}: <strong>${status.config.botCount} (${status.config.botDifficulty})</strong></div>
          <div>${t('admin:simulations.detail.map')}: <strong>${status.config.mapWidth}x${status.config.mapHeight}</strong></div>
          <div>${t('admin:simulations.detail.time')}: <strong>${Math.floor(status.config.roundTime / 60)}m</strong></div>
          <div>${t('admin:simulations.detail.speed')}: <strong>${status.config.speed === 'fast' ? t('admin:simulations.speedFast') : t('admin:simulations.speedRealtime')}</strong></div>
          <div>${t('admin:simulations.detail.verbosity')}: <strong>${status.config.logVerbosity}</strong></div>
        </div>
        <div class="sim-progress-section">
          <div class="sim-progress-row">
            <span class="sim-progress-label">${t('admin:simulations.progress', { completed: status.gamesCompleted, total: status.totalGames, pct })}</span>
            <div class="sim-progress-track">
              <div class="sim-progress-fill" style="width:${pct}%;"></div>
            </div>
          </div>
          ${
            status.status === 'running' && status.currentGameTick !== null
              ? `
            <div class="sim-tick-info">
              ${t('admin:simulations.currentGameTick', { tick: status.currentGameTick, maxTicks: status.currentGameMaxTicks || '?' })}
            </div>
          `
              : ''
          }
        </div>
        ${
          status.status === 'running'
            ? `
          <div class="sim-action-row">
            ${status.config.speed === 'realtime' ? `<button class="btn btn-secondary btn-sm" id="sim-detail-spectate">${t('admin:simulations.spectateCurrentGame')}</button>` : ''}
            <button class="btn-warn btn-sm" id="sim-detail-cancel">${t('admin:simulations.cancelBatch')}</button>
          </div>
        `
            : ''
        }
      </div>

      ${
        winEntries.length > 0
          ? `
        <div class="sim-info-card">
          <h4>${t('admin:simulations.winDistribution')}</h4>
          <div class="sim-win-chips">
            ${winEntries
              .map(
                ([name, count]) => `
              <div class="sim-win-chip">
                <span class="sim-win-chip-name">${escapeHtml(name)}</span>
                <span class="sim-win-chip-count">${t('admin:simulations.winCount', { count })}</span>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      `
          : ''
      }

      ${this.renderResultsTable()}
    `;

    this.container.querySelector('#sim-back-to-list')?.addEventListener('click', () => {
      this.detailBatchId = null;
      this.detailResults = [];
      this.detailPage = 1;
      this.detailSortKey = 'gameIndex';
      this.detailSortAsc = true;
      this.loadBatchList();
    });

    this.container.querySelector('#sim-detail-spectate')?.addEventListener('click', () => {
      if (this.detailBatchId) {
        this.startSpectating(this.detailBatchId);
      }
    });

    this.container.querySelector('#sim-detail-cancel')?.addEventListener('click', () => {
      if (this.detailBatchId) {
        this.socketClient.emit('sim:cancel', { batchId: this.detailBatchId }, (res) => {
          if (res.success) {
            this.notifications.success(t('admin:simulations.notifications.cancelRequested'));
          } else {
            this.notifications.error(res.error || t('admin:simulations.errors.cancelFailed'));
          }
        });
      }
    });

    this.attachResultsTableListeners();
  }

  private renderResultsTable(): string {
    // Sort results
    const sorted = [...this.detailResults].sort((a, b) => {
      let cmp = 0;
      switch (this.detailSortKey) {
        case 'gameIndex':
          cmp = a.gameIndex - b.gameIndex;
          break;
        case 'winner':
          cmp = (a.winnerName || '').localeCompare(b.winnerName || '');
          break;
        case 'duration':
          cmp = a.durationSeconds - b.durationSeconds;
          break;
        case 'kills': {
          const aKills = Math.max(...a.placements.map((p) => p.kills));
          const bKills = Math.max(...b.placements.map((p) => p.kills));
          cmp = aKills - bKills;
          break;
        }
        case 'reason':
          cmp = a.finishReason.localeCompare(b.finishReason);
          break;
      }
      return this.detailSortAsc ? cmp : -cmp;
    });

    // Paginate
    const totalPages = Math.max(1, Math.ceil(sorted.length / this.detailPageSize));
    if (this.detailPage > totalPages) this.detailPage = totalPages;
    const start = (this.detailPage - 1) * this.detailPageSize;
    const pageResults = sorted.slice(start, start + this.detailPageSize);

    const sortIcon = (key: string) => {
      if (this.detailSortKey !== key) return '';
      return this.detailSortAsc ? ' ↑' : ' ↓';
    };

    return `
      <table class="admin-table" id="sim-results-table">
        <thead>
          <tr>
            <th class="sortable-th" data-sort="gameIndex">#${sortIcon('gameIndex')}</th>
            <th class="sortable-th" data-sort="winner">${t('admin:simulations.results.winner')}${sortIcon('winner')}</th>
            <th class="sortable-th" data-sort="duration">${t('admin:simulations.results.duration')}${sortIcon('duration')}</th>
            <th class="sortable-th" data-sort="kills">${t('admin:simulations.results.killLeader')}${sortIcon('kills')}</th>
            <th class="sortable-th" data-sort="reason">${t('admin:simulations.results.reason')}${sortIcon('reason')}</th>
            <th>${t('admin:simulations.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${pageResults
            .map((r) => {
              const killLeader = [...r.placements].sort((a, b) => b.kills - a.kills)[0];
              const mins = Math.floor(r.durationSeconds / 60);
              const secs = r.durationSeconds % 60;
              return `
              <tr>
                <td>${r.gameIndex + 1}</td>
                <td class="sim-winner-cell">${r.winnerName ? escapeHtml(r.winnerName) : `<span class="text-dim">${t('admin:simulations.results.draw')}</span>`}</td>
                <td>${mins}:${String(secs).padStart(2, '0')}</td>
                <td>${killLeader ? `${escapeHtml(killLeader.name)} (${killLeader.kills})` : '-'}</td>
                <td class="sim-reason-cell">${escapeHtml(r.finishReason)}</td>
                <td>${r.hasReplay ? `<button class="btn btn-secondary btn-sm" data-action="watch-replay" data-game-index="${r.gameIndex}">${t('admin:simulations.actions.replay')}</button>` : ''}</td>
              </tr>
            `;
            })
            .join('')}
          ${sorted.length === 0 ? `<tr><td colspan="6" class="sim-empty-row">${t('admin:simulations.noResults')}</td></tr>` : ''}
        </tbody>
      </table>
      ${
        totalPages > 1
          ? `
        <div class="sim-pagination">
          <button class="btn btn-secondary btn-sm" id="sim-page-prev" ${this.detailPage <= 1 ? 'disabled' : ''}>${t('admin:simulations.pagination.prev')}</button>
          <span class="sim-pagination-info">${t('admin:simulations.pagination.info', { page: this.detailPage, totalPages, totalResults: sorted.length })}</span>
          <button class="btn btn-secondary btn-sm" id="sim-page-next" ${this.detailPage >= totalPages ? 'disabled' : ''}>${t('admin:simulations.pagination.next')}</button>
        </div>
      `
          : ''
      }
    `;
  }

  private attachResultsTableListeners(): void {
    if (!this.container) return;

    // Watch replay buttons
    this.container.querySelectorAll('[data-action="watch-replay"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gameIndex = parseInt((btn as HTMLElement).dataset.gameIndex!);
        if (this.detailBatchId != null && !isNaN(gameIndex)) {
          this.launchSimulationReplay(this.detailBatchId, gameIndex);
        }
      });
    });

    // Sort headers
    this.container.querySelectorAll('#sim-results-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = (th as HTMLElement).dataset.sort!;
        if (this.detailSortKey === key) {
          this.detailSortAsc = !this.detailSortAsc;
        } else {
          this.detailSortKey = key;
          this.detailSortAsc = true;
        }
        this.detailPage = 1;
        this.refreshResultsTable();
      });
    });

    // Pagination
    this.container.querySelector('#sim-page-prev')?.addEventListener('click', () => {
      if (this.detailPage > 1) {
        this.detailPage--;
        this.refreshResultsTable();
      }
    });
    this.container.querySelector('#sim-page-next')?.addEventListener('click', () => {
      this.detailPage++;
      this.refreshResultsTable();
    });
  }

  private refreshResultsTable(): void {
    if (!this.container) return;
    const tableContainer = this.container.querySelector('#sim-results-table')?.parentElement;
    if (!tableContainer) return;

    // Find the table and pagination wrapper, replace them
    const oldTable = this.container.querySelector('#sim-results-table');
    const oldPagination = oldTable?.nextElementSibling;

    const temp = document.createElement('div');
    temp.innerHTML = this.renderResultsTable();

    if (oldTable) {
      oldTable.replaceWith(temp.querySelector('#sim-results-table')!);
    }
    if (oldPagination?.id === 'sim-page-prev' || oldPagination?.querySelector('#sim-page-prev')) {
      oldPagination.replaceWith(...Array.from(temp.children));
    } else {
      // Append pagination if it wasn't there before
      const newPagination = temp.querySelector('#sim-page-prev')?.parentElement;
      if (newPagination && oldTable?.parentElement) {
        oldTable.parentElement.appendChild(newPagination);
      }
    }

    this.attachResultsTableListeners();
  }

  private async showConfigModal(): Promise<void> {
    let simDefaults: SimulationDefaults = {};
    let activeAIs: BotAIEntry[] = [];
    try {
      const [defResp, aiResp] = await Promise.all([
        ApiClient.get<{ defaults: SimulationDefaults }>('/admin/settings/simulation_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
      ]);
      simDefaults = defResp.defaults ?? {};
      activeAIs = aiResp.ais ?? [];
    } catch {
      // Use hardcoded defaults on failure
    }

    const allPowerUps = Object.values(POWERUP_DEFINITIONS);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:simulations.modal.title'));
    modal.innerHTML = `
      <div class="modal sim-modal">
        <h2>${t('admin:simulations.modal.title')}</h2>

        <div class="sim-modal-grid">
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.gameMode')}</label>
            <select id="sim-mode">
              <option value="ffa">${t('admin:simulations.modal.modes.ffa')}</option>
              <option value="teams">${t('admin:simulations.modal.modes.teams')}</option>
              <option value="battle_royale">${t('admin:simulations.modal.modes.battleRoyale')}</option>
              <option value="sudden_death">${t('admin:simulations.modal.modes.suddenDeath')}</option>
              <option value="deathmatch">${t('admin:simulations.modal.modes.deathmatch')}</option>
              <option value="king_of_the_hill">${t('admin:simulations.modal.modes.kingOfTheHill')}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.botCount')}</label>
            <select id="sim-bot-count">
              <option value="2">${t('admin:simulations.modal.nBots', { count: 2 })}</option>
              <option value="3">${t('admin:simulations.modal.nBots', { count: 3 })}</option>
              <option value="4" selected>${t('admin:simulations.modal.nBots', { count: 4 })}</option>
              <option value="5">${t('admin:simulations.modal.nBots', { count: 5 })}</option>
              <option value="6">${t('admin:simulations.modal.nBots', { count: 6 })}</option>
              <option value="7">${t('admin:simulations.modal.nBots', { count: 7 })}</option>
              <option value="8">${t('admin:simulations.modal.nBots', { count: 8 })}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.botDifficulty')}</label>
            <select id="sim-difficulty">
              <option value="easy">${t('admin:simulations.modal.difficulties.easy')}</option>
              <option value="normal" selected>${t('admin:simulations.modal.difficulties.normal')}</option>
              <option value="hard">${t('admin:simulations.modal.difficulties.hard')}</option>
            </select>
          </div>
          ${
            activeAIs.length > 1
              ? `
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.botAI')}</label>
            <select id="sim-bot-ai">
              ${activeAIs.map((ai) => `<option value="${ai.id}"${ai.isBuiltin ? ' selected' : ''}>${escapeHtml(ai.name)}</option>`).join('')}
            </select>
          </div>
          `
              : ''
          }
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.mapSize')}</label>
            <select id="sim-map-size">
              <option value="21">${t('admin:simulations.modal.mapSizes.small')}</option>
              <option value="31" selected>${t('admin:simulations.modal.mapSizes.normal')}</option>
              <option value="39">${t('admin:simulations.modal.mapSizes.large')}</option>
              <option value="51">${t('admin:simulations.modal.mapSizes.huge')}</option>
              <option value="61">${t('admin:simulations.modal.mapSizes.massive')}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.matchTime')}</label>
            <select id="sim-round-time">
              <option value="60">${t('admin:simulations.modal.timeOptions.1min')}</option>
              <option value="120">${t('admin:simulations.modal.timeOptions.2min')}</option>
              <option value="180" selected>${t('admin:simulations.modal.timeOptions.3min')}</option>
              <option value="300">${t('admin:simulations.modal.timeOptions.5min')}</option>
              <option value="600">${t('admin:simulations.modal.timeOptions.10min')}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.wallDensity')}</label>
            <select id="sim-wall-density">
              <option value="0.3">${t('admin:simulations.modal.densities.low')}</option>
              <option value="0.5">${t('admin:simulations.modal.densities.medium')}</option>
              <option value="0.65" selected>${t('admin:simulations.modal.densities.high')}</option>
              <option value="0.8">${t('admin:simulations.modal.densities.veryHigh')}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.powerUpRate')}</label>
            <select id="sim-powerup-rate">
              <option value="0">${t('admin:simulations.modal.rates.none')}</option>
              <option value="0.15">${t('admin:simulations.modal.rates.low')}</option>
              <option value="0.3" selected>${t('admin:simulations.modal.rates.normal')}</option>
              <option value="0.5">${t('admin:simulations.modal.rates.high')}</option>
              <option value="0.8">${t('admin:simulations.modal.rates.veryHigh')}</option>
            </select>
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.totalGames')}</label>
            <input type="number" id="sim-total-games" value="10" min="1" max="1000" class="w-full">
          </div>
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.speed')}</label>
            <select id="sim-speed">
              <option value="fast" selected>${t('admin:simulations.modal.speedOptions.fast')}</option>
              <option value="realtime">${t('admin:simulations.modal.speedOptions.realtime')}</option>
            </select>
          </div>
        </div>

        <div class="sim-modal-grid mt-sm">
          <div class="form-group mb-0">
            <label>${t('admin:simulations.modal.logVerbosity')}</label>
            <select id="sim-verbosity">
              <option value="normal" selected>${t('admin:simulations.modal.verbosityOptions.normal')}</option>
              <option value="detailed">${t('admin:simulations.modal.verbosityOptions.detailed')}</option>
              <option value="full">${t('admin:simulations.modal.verbosityOptions.full')}</option>
            </select>
          </div>
        </div>

        <div class="sim-checkbox-row">
          <label class="sim-checkbox-label">
            <input type="checkbox" id="sim-reinforced"> ${t('admin:simulations.modal.reinforcedWalls')}
          </label>
          <label class="sim-checkbox-label">
            <input type="checkbox" id="sim-map-events"> ${t('admin:simulations.modal.mapEvents')}
          </label>
          <label class="sim-checkbox-label">
            <input type="checkbox" id="sim-hazard-tiles"> ${t('admin:simulations.modal.hazardTiles')}
          </label>
          <label class="sim-checkbox-label" id="sim-ff-label">
            <input type="checkbox" id="sim-friendly-fire" checked> ${t('admin:simulations.modal.friendlyFire')}
          </label>
          <label class="sim-checkbox-label accent-label">
            <input type="checkbox" id="sim-record-replays" checked>
            <span>${t('admin:simulations.modal.recordReplays')}</span>
          </label>
        </div>

        <div class="sim-powerup-section">
          <label>${t('admin:simulations.modal.powerUps')}</label>
          <div class="sim-powerup-chips">
            ${allPowerUps
              .map(
                (pu) => `
              <label class="sim-powerup-label">
                <input type="checkbox" class="sim-powerup-check" value="${pu.type}" checked>
                ${pu.name}
              </label>
            `,
              )
              .join('')}
          </div>
        </div>

        <div class="modal-actions sim-modal-actions">
          <button class="btn btn-secondary" id="sim-config-cancel">${t('admin:simulations.modal.cancel')}</button>
          <button class="btn btn-primary" id="sim-config-start">${t('admin:simulations.modal.startBatch')}</button>
        </div>
      </div>
    `;

    document.getElementById('ui-overlay')!.appendChild(modal);

    // Apply admin-configured simulation defaults
    this.applySimulationDefaults(modal, simDefaults);

    // Show/hide friendly fire based on game mode
    const modeSelect = modal.querySelector('#sim-mode') as HTMLSelectElement;
    const ffLabel = modal.querySelector('#sim-ff-label') as HTMLElement;
    const updateFFVisibility = () => {
      ffLabel.style.display = modeSelect.value === 'teams' ? '' : 'none';
    };
    modeSelect.addEventListener('change', updateFFVisibility);
    updateFFVisibility();

    modal.querySelector('#sim-config-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector('#sim-config-start')!.addEventListener('click', () => {
      const mapSize = parseInt((modal.querySelector('#sim-map-size') as HTMLSelectElement).value);
      const enabledPowerUps = Array.from(modal.querySelectorAll('.sim-powerup-check:checked')).map(
        (el) => (el as HTMLInputElement).value,
      );
      const speed = (modal.querySelector('#sim-speed') as HTMLSelectElement).value as
        | 'fast'
        | 'realtime';

      const config: SimulationConfig = {
        gameMode: (modal.querySelector('#sim-mode') as HTMLSelectElement).value as any,
        botCount: parseInt((modal.querySelector('#sim-bot-count') as HTMLSelectElement).value),
        botDifficulty: (modal.querySelector('#sim-difficulty') as HTMLSelectElement).value as any,
        mapWidth: mapSize,
        mapHeight: mapSize,
        roundTime: parseInt((modal.querySelector('#sim-round-time') as HTMLSelectElement).value),
        wallDensity: parseFloat(
          (modal.querySelector('#sim-wall-density') as HTMLSelectElement).value,
        ),
        enabledPowerUps: enabledPowerUps as any[],
        powerUpDropRate: parseFloat(
          (modal.querySelector('#sim-powerup-rate') as HTMLSelectElement).value,
        ),
        friendlyFire: (modal.querySelector('#sim-friendly-fire') as HTMLInputElement).checked,
        hazardTiles: (modal.querySelector('#sim-hazard-tiles') as HTMLInputElement).checked,
        reinforcedWalls: (modal.querySelector('#sim-reinforced') as HTMLInputElement).checked,
        enableMapEvents: (modal.querySelector('#sim-map-events') as HTMLInputElement).checked,
        totalGames: Math.min(
          1000,
          Math.max(
            1,
            parseInt((modal.querySelector('#sim-total-games') as HTMLInputElement).value) || 10,
          ),
        ),
        speed,
        logVerbosity: (modal.querySelector('#sim-verbosity') as HTMLSelectElement).value as any,
        recordReplays: (modal.querySelector('#sim-record-replays') as HTMLInputElement).checked,
        botAiId:
          (modal.querySelector('#sim-bot-ai') as HTMLSelectElement | null)?.value || undefined,
      };

      // Validate bot count for Teams mode (minimum 4)
      const modeConfig = GAME_MODES[config.gameMode];
      if (config.botCount < modeConfig.minPlayers) {
        this.notifications.error(
          t('admin:simulations.errors.minBots', {
            mode: modeConfig.name,
            min: modeConfig.minPlayers,
          }),
        );
        return;
      }

      modal.remove();

      this.socketClient.emit('sim:start', config, (res) => {
        if (!res.success) {
          this.notifications.error(res.error || t('admin:simulations.errors.startFailed'));
          return;
        }

        const batchId = res.batchId!;

        if (res.queued) {
          this.notifications.success(
            t('admin:simulations.notifications.queued', {
              position: res.queuePosition,
              count: config.totalGames,
            }),
          );
          this.loadBatchList();
        } else {
          this.notifications.success(
            t('admin:simulations.notifications.started', { count: config.totalGames }),
          );

          if (speed === 'realtime') {
            // For realtime: immediately spectate so the game plays in the browser
            this.startSpectating(batchId);
          } else {
            // For fast mode: show detail view with progress
            this.showBatchDetail(batchId);
          }
        }
      });
    });
  }

  private applySimulationDefaults(modal: HTMLElement, defaults: SimulationDefaults): void {
    const setSelect = (id: string, value: string | number | undefined) => {
      if (value === undefined) return;
      const el = modal.querySelector(id) as HTMLSelectElement | null;
      if (el) el.value = String(value);
    };
    const setCheckbox = (id: string, value: boolean | undefined) => {
      if (value === undefined) return;
      const el = modal.querySelector(id) as HTMLInputElement | null;
      if (el) el.checked = value;
    };

    setSelect('#sim-mode', defaults.gameMode);
    setSelect('#sim-bot-count', defaults.botCount);
    setSelect('#sim-difficulty', defaults.botDifficulty);
    setSelect('#sim-map-size', defaults.mapWidth);
    setSelect('#sim-round-time', defaults.roundTime);
    setSelect('#sim-wall-density', defaults.wallDensity);
    setSelect('#sim-powerup-rate', defaults.powerUpDropRate);
    setSelect('#sim-speed', defaults.speed);
    setSelect('#sim-verbosity', defaults.logVerbosity);

    if (defaults.totalGames !== undefined) {
      const el = modal.querySelector('#sim-total-games') as HTMLInputElement | null;
      if (el) el.value = String(defaults.totalGames);
    }

    setCheckbox('#sim-reinforced', defaults.reinforcedWalls);
    setCheckbox('#sim-map-events', defaults.enableMapEvents);
    setCheckbox('#sim-hazard-tiles', defaults.hazardTiles);
    setCheckbox('#sim-friendly-fire', defaults.friendlyFire);
    setCheckbox('#sim-record-replays', defaults.recordReplays);
    setSelect('#sim-bot-ai', defaults.botAiId);

    if (defaults.enabledPowerUps) {
      const enabled = new Set(defaults.enabledPowerUps);
      modal.querySelectorAll('.sim-powerup-check').forEach((cb) => {
        const input = cb as HTMLInputElement;
        input.checked = enabled.has(input.value as PowerUpType);
      });
    }
  }
}
