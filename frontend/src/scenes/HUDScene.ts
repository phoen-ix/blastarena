import Phaser from 'phaser';
import {
  GameState,
  PlayerState,
  CampaignGameState,
  CampaignEnemyState,
  TileType,
  KillCause,
  OpenWorldScoreEntry,
  ServerToClientEvents,
} from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../utils/html';
import { HudPlayerList } from '../ui/hudPlayerList';
import { SpectatorChat } from '../game/SpectatorChat';
import { SpectatorActionBar } from '../game/SpectatorActionBar';
import { MinimapTerrain } from '../game/minimapTerrain';
import { t } from '../i18n';
import { getSettings } from '../game/Settings';
import { PLAYER_COLORS } from './BootScene';
import { AuthUI } from '../ui/AuthUI';
import type { NotificationUI } from '../ui/NotificationUI';
import type { AuthManager } from '../network/AuthManager';
import type { SocketClient } from '../network/SocketClient';
import type { GameScene } from './GameScene';

/** How long an admin broadcast stays on screen before hiding itself. */
const ADMIN_BANNER_MS = 10_000;

export class HUDScene extends Phaser.Scene {
  private hudContainer!: HTMLElement;
  private statsEl!: HTMLElement;
  private playerListEl!: HTMLElement;
  private killFeedEl!: HTMLElement;
  // Cached once per create(); updateHUD used to getElementById these on every tick. (audit F4)
  private timerEl: HTMLElement | null = null;
  private specBannerEl: HTMLElement | null = null;
  private lastTimerText = '';
  private lastTimerColor = '';
  private lastSpecBannerShown: boolean | null = null;
  private localPlayerDead: boolean = false;
  private localPlayerId!: number;
  /** Replays and simulation spectating: the viewer never takes part, even in a match they played. */
  private spectatorOnly: boolean = false;
  private localPlayerChangedHandler: ((id: number) => void) | null = null;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private socketClient: SocketClient | null = null;
  private playerDiedHandler:
    | ((data: { playerId: number; killerId: number | null; cause?: KillCause }) => void)
    | null = null;
  private killFeedEntries: { text: string; time: number; el?: HTMLElement }[] = [];
  private stateUpdateHandler: ((state: GameState) => void) | null = null;
  private campaignStateHandler: ((state: CampaignGameState) => void) | null = null;
  private campaignPlayerDiedHandler: (() => void) | null = null;
  // Admin "message room" broadcast: the server has always rebroadcast it, nothing rendered it.
  // Handler ref kept and removed in shutdown(). (audit G7)
  private adminMessageHandler: ServerToClientEvents['admin:roomMessage'] | null = null;
  private adminBannerEl: HTMLElement | null = null;
  private adminBannerTimer: ReturnType<typeof setTimeout> | null = null;
  private previousStats: {
    maxBombs: number;
    fireRange: number;
    speed: number;
    hasShield: boolean;
    hasKick: boolean;
    hasBombThrow: boolean;
    remoteDetonateMode?: 'all' | 'fifo';
  } | null = null;
  // Element refs for stats bar (avoid innerHTML on every update)
  private statEls: {
    bombs: HTMLElement;
    fire: HTMLElement;
    speed: HTMLElement;
    shield: HTMLElement;
    kick: HTMLElement;
    throw: HTMLElement;
    remoteMode: HTMLElement;
  } | null = null;
  // Player list element cache for differential updates
  // Rows are keyed and reused rather than re-rendered at the tick rate; the logic lives outside
  // this scene so it can be tested without Phaser. (audit HUD-PLAYERLIST-1)
  private playerList = new HudPlayerList();

  // Campaign HUD
  private campaignMode: boolean = false;
  private campaignHudEl: HTMLElement | null = null;
  private campaignLivesEl: HTMLElement | null = null;
  private campaignEnemiesEl: HTMLElement | null = null;
  private campaignCoopStatusEl: HTMLElement | null = null;
  private lastCampaignLives: number = -1;
  private lastCampaignEnemyCount: number = -1;
  /** Rendered co-op status row, so the DOMPurify-backed setHtml only runs on change. (audit F4) */
  private lastCoopStatusSig = '';
  private bossFillEl: HTMLElement | null = null;
  private lastBossFillWidth = '';
  private spectatorChat: SpectatorChat | null = null;
  private spectatorChatMounted: boolean = false;
  public spectatorActionBar: SpectatorActionBar | null = null;
  private spectatorActionBarMounted: boolean = false;
  // Compact login/register bar for open-world guests (docked bottom-center)
  private authBarEl: HTMLElement | null = null;
  private authUI: AuthUI | null = null;

  // Open world: round counter + live leaderboard + end-of-round scoreboard
  private openWorldMode: boolean = false;
  private owBoardEl: HTMLElement | null = null;
  private owRowsEl: HTMLElement | null = null;
  private owRoundEl: HTMLElement | null = null;
  private owRoundNumber: number = 0;
  private owScores: Map<number, OpenWorldScoreEntry> = new Map();
  private owRoundEndEl: HTMLElement | null = null;
  private owNextRoundTimer: ReturnType<typeof setInterval> | null = null;
  private owInfoHandler:
    | ((data: {
        playerCount: number;
        maxPlayers: number;
        roundTimeRemaining: number;
        roundNumber: number;
        leaderboard: OpenWorldScoreEntry[];
      }) => void)
    | null = null;
  private owScoreHandler: ((entry: OpenWorldScoreEntry) => void) | null = null;
  private owRoundEndHandler:
    | ((data: {
        roundNumber: number;
        leaderboard: OpenWorldScoreEntry[];
        nextRoundIn: number;
      }) => void)
    | null = null;
  private owRoundStartHandler: ((data: { roundNumber: number }) => void) | null = null;

  // Minimap
  private minimapContainer: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapEnabled: boolean = true;
  private minimapTileSize: number = 0;
  /** Offscreen terrain layer, drawn once and patched per tile diff. (audit F1) */
  private minimapTerrain: MinimapTerrain | null = null;
  private minimapTerrainCanvas: HTMLCanvasElement | null = null;
  /** Full grid from the initial state, held until the terrain layer is first built. */
  private minimapSeedTiles: TileType[][] | null = null;
  private lastMinimapTick: number = -1;

  constructor() {
    super({ key: 'HUDScene' });
  }

  create(): void {
    if (this.boundClickHandler) {
      this.playerListEl?.removeEventListener('mousedown', this.boundClickHandler);
      this.boundClickHandler = null;
    }
    this.hudContainer?.remove();
    this.statsEl?.remove();
    this.playerListEl?.remove();
    this.killFeedEl?.remove();
    this.authBarEl?.remove();
    this.authBarEl = null;
    this.teardownOpenWorldHud();
    this.owScores.clear();
    this.owRoundNumber = 0;
    this.openWorldMode = false;

    this.events.once('shutdown', this.shutdown, this);

    const authManager = this.registry.get('authManager') as AuthManager;
    // GameScene owns the local player id: the open world assigns one per join, and the registry
    // key it comes from used to be read here in every mode, long after that session ended.
    const gameSceneRef = this.scene.get('GameScene') as GameScene | null;
    this.localPlayerId = gameSceneRef?.localId ?? authManager.getUser()?.id ?? 0;
    this.localPlayerDead = false;

    // Force spectator mode for simulation/replay viewers
    const simSpectate = this.registry.get('simulationSpectate');
    const replayMode = this.registry.get('replayMode');
    this.spectatorOnly = !!(simSpectate || replayMode || this.registry.get('adminSpectate'));
    if (this.spectatorOnly) {
      this.localPlayerDead = true;
    }

    this.killFeedEntries = [];
    // Previous match's roster must not name victims in this one (audit C9)
    this.lastKnownPlayers = [];
    this.previousStats = null;
    this.statEls = null;
    this.playerList.reset();
    this.lastTimerText = '';
    this.lastTimerColor = '';
    this.lastSpecBannerShown = null;
    this.lastCampaignLives = -1;
    this.lastCampaignEnemyCount = -1;
    this.lastCoopStatusSig = '';
    this.bossFillEl = null;
    this.lastBossFillWidth = '';
    document.getElementById('campaign-boss-hp')?.remove();
    this.campaignHudEl?.remove();
    this.campaignHudEl = null;
    this.campaignLivesEl = null;
    this.campaignEnemiesEl = null;
    this.campaignCoopStatusEl = null;
    this.hideAdminBanner();
    this.spectatorActionBar?.destroy();
    this.spectatorActionBar = null;
    this.spectatorActionBarMounted = false;

    this.socketClient = this.registry.get('socketClient');

    // Show "0:00" initially for campaign levels with no time limit (count-up), else "3:00"
    const initialState = this.registry.get('initialGameState') as GameState | undefined;
    const noTimeLimit =
      !!this.registry.get('campaignMode') && initialState && initialState.roundTime >= 99999;

    // Main HUD container
    this.hudContainer = document.createElement('div');
    this.hudContainer.className = 'hud-container';
    setHtml(
      this.hudContainer,
      `
      <div class="hud-top">
        <div class="hud-top-left">
          <div class="hud-timer" id="hud-timer">${noTimeLimit ? '0:00' : '3:00'}</div>
          <div class="hud-round" id="hud-round" style="display:none;"></div>
        </div>
      </div>
      <div class="hud-spectator-banner" id="hud-spectator" style="display:none;">
        ${t('ui:hud.spectator')}
      </div>
    `,
    );
    this.timerEl = this.hudContainer.querySelector<HTMLElement>('#hud-timer');
    this.specBannerEl = this.hudContainer.querySelector<HTMLElement>('#hud-spectator');

    // Player list
    this.playerListEl = document.createElement('div');
    this.playerListEl.className = 'hud-players';
    this.playerListEl.id = 'hud-players';

    // Kill feed
    this.killFeedEl = document.createElement('div');
    this.killFeedEl.className = 'hud-killfeed';
    this.killFeedEl.id = 'hud-killfeed';

    // Stats bar (bottom-left)
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'hud-stats-bar';
    this.statsEl.id = 'hud-stats';

    const overlay = document.getElementById('ui-overlay');
    overlay?.appendChild(this.hudContainer);
    overlay?.appendChild(this.playerListEl);
    overlay?.appendChild(this.killFeedEl);
    overlay?.appendChild(this.statsEl);

    // Minimap
    this.minimapEnabled = getSettings().minimap;
    this.minimapContainer?.remove();
    this.minimapContainer = null;
    this.minimapCanvas = null;
    this.minimapCtx = null;
    this.minimapTerrain = null;
    this.minimapTerrainCanvas = null;
    this.minimapSeedTiles = null;
    this.lastMinimapTick = -1;
    if (this.minimapEnabled) {
      this.minimapContainer = document.createElement('div');
      this.minimapContainer.className = 'hud-minimap';
      overlay?.appendChild(this.minimapContainer);
    }

    // Open-world guests keep a compact login/register bar docked bottom-center, so the
    // play area stays clear but authentication remains one click away.
    if (gameSceneRef?.isOpenWorld && authManager.isGuest) {
      this.mountAuthBar();
    }

    // Open world: a flat list of up to 32 players is unreadable, so it gives way to a live
    // leaderboard, and the persistent round counter joins the round timer.
    this.openWorldMode = !!gameSceneRef?.isOpenWorld;
    if (this.openWorldMode) {
      this.playerListEl.style.display = 'none';
      this.mountOpenWorldBoard(overlay);
      this.bindOpenWorldEvents(gameSceneRef);
    }

    // Spectate click handler
    this.boundClickHandler = (e: MouseEvent) => {
      if (!this.localPlayerDead) return;
      const item = (e.target as Element).closest('.hud-player-item[data-player-id]');
      if (!item || item.classList.contains('dead')) return;
      const id = parseInt(item.getAttribute('data-player-id')!);
      if (isNaN(id)) return;
      e.stopPropagation();
      this.registry.set('spectateTargetId', id);
      (item as HTMLElement).style.background = 'rgba(255, 107, 53, 0.6)';
      setTimeout(() => {
        (item as HTMLElement).style.background = '';
      }, 300);
    };
    this.playerListEl.addEventListener('mousedown', this.boundClickHandler);

    // Listen for kill events
    if (this.socketClient) {
      this.playerDiedHandler = (data: {
        playerId: number;
        killerId: number | null;
        cause?: KillCause;
      }) => {
        this.onPlayerDied(data);
      };
      this.socketClient.on('game:playerDied', this.playerDiedHandler);

      // Admin broadcast to the room (audit G7)
      this.adminMessageHandler = (data) => {
        this.showAdminBanner(data.message, data.from);
      };
      this.socketClient.on('admin:roomMessage', this.adminMessageHandler);
    }

    // Listen for state updates from GameScene
    const gameScene = this.scene.get('GameScene');
    this.stateUpdateHandler = (state: GameState) => {
      this.updateHUD(state);
    };
    gameScene.events.on('stateUpdate', this.stateUpdateHandler);

    // A guest re-joining the open world after a reconnect comes back under a new id
    this.localPlayerChangedHandler = (id: number) => {
      this.localPlayerId = id;
      this.renderOpenWorldBoard();
    };
    gameScene.events.on('localPlayerChanged', this.localPlayerChangedHandler);

    // Seed the minimap: GameScene emits stateUpdate during its create(), before this listener
    // exists. From its live grid rather than the registry's initial state — the landing's
    // background arena mounts this HUD long after joining, and open-world rounds replace the map,
    // so the initial grid drew walls that were long gone.
    const seedTiles = gameSceneRef?.liveTiles ?? initialState?.map?.tiles;
    if (this.minimapEnabled && seedTiles?.length) {
      this.minimapSeedTiles = seedTiles;
    }

    // Campaign mode: add lives/enemy counter, hide player list and kill feed
    this.campaignMode = !!this.registry.get('campaignMode');
    if (this.campaignMode) {
      this.playerListEl.style.display = 'none';
      this.killFeedEl.style.display = 'none';

      this.campaignHudEl = document.createElement('div');
      this.campaignHudEl.className = 'hud-campaign';
      this.campaignHudEl.style.cssText =
        'position:fixed;top:48px;left:20px;display:flex;gap:16px;align-items:center;font-family:"Chakra Petch",sans-serif;font-size:16px;color:#eae8e4;z-index:100;';
      const isCoopMode = !!this.registry.get('campaignCoopMode');
      setHtml(
        this.campaignHudEl,
        `
        <span id="campaign-lives" style="display:flex;align-items:center;gap:4px;"></span>
        <span id="campaign-enemies" style="color:var(--danger);"></span>
        ${isCoopMode ? '<span id="campaign-coop-status" style="display:flex;gap:8px;align-items:center;"></span>' : ''}
      `,
      );
      const overlay = document.getElementById('ui-overlay');
      overlay?.appendChild(this.campaignHudEl);
      this.campaignLivesEl = this.campaignHudEl.querySelector<HTMLElement>('#campaign-lives');
      this.campaignEnemiesEl = this.campaignHudEl.querySelector<HTMLElement>('#campaign-enemies');
      this.campaignCoopStatusEl =
        this.campaignHudEl.querySelector<HTMLElement>('#campaign-coop-status');

      // Listen for campaign state updates via Phaser event from GameScene
      // (not directly on socket — avoids shared-listener cleanup issues across scenes)
      this.campaignStateHandler = (state: CampaignGameState) => {
        this.updateCampaignHUD(state);
      };
      gameScene.events.on('campaignStateUpdate', this.campaignStateHandler);

      // A life lost: pulse the hearts so the change registers (audit G7)
      this.campaignPlayerDiedHandler = () => this.flashCampaignLives();
      gameScene.events.on('campaignPlayerDied', this.campaignPlayerDiedHandler);
    }
  }

  /** Brief pulse of the lives display when the party loses a life. */
  private flashCampaignLives(): void {
    const el = this.campaignLivesEl;
    if (!el || typeof el.animate !== 'function') return;
    el.animate(
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.4)', filter: 'brightness(2.2)', offset: 0.3 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 550, easing: 'ease-out' },
    );
  }

  /**
   * Dismissible banner for an admin's "message room" broadcast. One at a time — a newer message
   * replaces the current banner — and it hides itself after ADMIN_BANNER_MS. (audit G7)
   */
  private showAdminBanner(message: string, from: string): void {
    this.hideAdminBanner();
    // Styled by the themed .hud-admin-banner rules in styles.css. It used to carry an inline dark
    // background that overrode them, leaving the text unreadable in the light themes.
    const banner = document.createElement('div');
    banner.className = 'hud-admin-banner';
    banner.setAttribute('role', 'status');
    setHtml(
      banner,
      `
      <div class="hud-admin-banner-body">
        <div class="hud-admin-banner-from">${escapeHtml(t('ui:hud.adminMessageFrom', { from }))}</div>
        <div class="hud-admin-banner-text">${escapeHtml(message)}</div>
      </div>
      <button type="button" class="hud-admin-banner-close" aria-label="${escapeHtml(t('common:actions.close'))}">✕</button>
    `,
    );
    banner
      .querySelector('.hud-admin-banner-close')
      ?.addEventListener('click', () => this.hideAdminBanner());
    // Keep Space/Enter on the focused close button out of the game input
    banner.addEventListener('keydown', (e) => e.stopPropagation());
    document.getElementById('ui-overlay')?.appendChild(banner);
    this.adminBannerEl = banner;
    this.adminBannerTimer = setTimeout(() => this.hideAdminBanner(), ADMIN_BANNER_MS);
  }

  private hideAdminBanner(): void {
    if (this.adminBannerTimer) {
      clearTimeout(this.adminBannerTimer);
      this.adminBannerTimer = null;
    }
    this.adminBannerEl?.remove();
    this.adminBannerEl = null;
  }

  private static CAUSE_ICONS: Record<string, string> = {
    bomb: '💣',
    self: '💀',
    zone: '🔴',
    lava: '🌋',
    quicksand: '⏳',
    spikes: '⚔️',
    dark_rift: '🌀',
    disconnect: '🔌',
  };

  private onPlayerDied(data: {
    playerId: number;
    killerId: number | null;
    cause?: KillCause;
  }): void {
    // Names come from the last state this HUD rendered. (This used to bail when the unrelated
    // `initialGameState` registry key was absent — e.g. after a replay exit cleared it.
    // audit C9)
    const victim = this.lastKnownPlayers.find((p) => p.id === data.playerId);
    const killer = data.killerId ? this.lastKnownPlayers.find((p) => p.id === data.killerId) : null;

    const causeIcon = HUDScene.CAUSE_ICONS[data.cause ?? 'bomb'] ?? '💣';

    let text: string;
    if (killer && killer.id !== data.playerId) {
      text = `${causeIcon} ${t('ui:hud.eliminated', {
        killer: escapeHtml(killer.username),
        victim: escapeHtml(victim?.username || '???'),
      })}`;
    } else if (data.cause === 'self') {
      text = `${causeIcon} ${t('ui:hud.selfEliminated', { player: escapeHtml(victim?.username || '???') })}`;
    } else if (data.cause && data.cause !== 'bomb') {
      // Hazard/environment kill
      text = `${causeIcon} ${t('ui:hud.hazardEliminated', {
        player: escapeHtml(victim?.username || '???'),
        hazard: data.cause,
      })}`;
    } else {
      text = `${causeIcon} ${t('ui:hud.selfEliminated', { player: escapeHtml(victim?.username || '???') })}`;
    }

    this.killFeedEntries.push({ text, time: Date.now() });
    if (this.killFeedEntries.length > 5) {
      this.killFeedEntries.shift();
    }
    this.renderKillFeed();

    // Show death banner when local player dies
    if (data.playerId === this.localPlayerId) {
      this.showDeathBanner(killer, data.cause);
    }
  }

  private showDeathBanner(killer: PlayerState | null | undefined, cause?: KillCause): void {
    const causeIcon = HUDScene.CAUSE_ICONS[cause ?? 'bomb'] ?? '💣';
    let message: string;
    if (killer && killer.id !== this.localPlayerId) {
      message = `${causeIcon} ${t('ui:hud.youWereEliminated', { killer: escapeHtml(killer.username) })}`;
    } else if (cause && cause !== 'bomb' && cause !== 'self') {
      message = `${causeIcon} ${t('ui:hud.youWereEliminatedBy', { cause })}`;
    } else {
      message = `${causeIcon} ${t('ui:hud.youEliminated')}`;
    }

    const banner = document.createElement('div');
    banner.className = 'hud-death-banner';
    setHtml(banner, message);
    document.getElementById('ui-overlay')?.appendChild(banner);

    // Fade out and remove after 3 seconds
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 500);
    }, 3000);
  }

  private lastKnownPlayers: PlayerState[] = [];

  private renderKillFeed(): void {
    // Runs every tick; the feed is empty for most of a match. (audit F4)
    if (!this.killFeedEl || this.killFeedEntries.length === 0) return;
    const now = Date.now();

    // Expire in place, newest entries are at the end so removal is cheap
    const entries = this.killFeedEntries;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const age = now - entry.time;
      if (age >= 5000) {
        entry.el?.remove();
        entries.splice(i, 1);
        continue;
      }
      // Update opacity on surviving entries
      const opacity = Math.max(0.3, 1 - age / 5000);
      if (entry.el) {
        entry.el.style.opacity = String(opacity);
      } else {
        // Create DOM element for new entries
        const el = document.createElement('div');
        el.className = 'killfeed-entry';
        el.style.opacity = String(opacity);
        setHtml(el, entry.text);
        this.killFeedEl.appendChild(el);
        entry.el = el;
      }
    }
  }

  private updateHUD(state: GameState): void {
    this.lastKnownPlayers = state.players;

    // Track local player death (campaign: reset on respawn)
    const me = state.players.find((p) => p.id === this.localPlayerId);
    if (!this.localPlayerDead && me && !me.alive) {
      this.localPlayerDead = true;
      // Mount spectator chat when player dies (not campaign/replay/sim). Nor the open world:
      // spectator chat is a room feature and the server drops it there.
      if (
        !this.campaignMode &&
        !this.openWorldMode &&
        !this.spectatorChatMounted &&
        !this.registry.get('replayMode') &&
        !this.registry.get('simulationSpectate')
      ) {
        this.mountSpectatorChat();
      }
      // Mount spectator action bar when player dies + feature enabled
      if (
        !this.campaignMode &&
        !this.spectatorActionBarMounted &&
        !this.registry.get('replayMode') &&
        !this.registry.get('simulationSpectate') &&
        state.spectatorActions
      ) {
        this.mountSpectatorActionBar();
      }
    } else if (this.localPlayerDead && me && me.alive && !this.spectatorOnly) {
      // Player respawned (campaign, deathmatch, open world)
      this.localPlayerDead = false;
      // Unmount spectator UI on respawn
      if (this.spectatorChat) {
        this.spectatorChat.destroy();
        this.spectatorChat = null;
        this.spectatorChatMounted = false;
      }
      if (this.spectatorActionBar) {
        this.spectatorActionBar.destroy();
        this.spectatorActionBar = null;
        this.spectatorActionBarMounted = false;
      }
    }

    // Update spectator action bar energy
    if (this.spectatorActionBar && state.spectatorEnergy) {
      this.spectatorActionBar.updateFromState(state.spectatorEnergy, this.localPlayerId);
    }

    // Spectator banner (not useful in campaign — single player, respawns). Cached element,
    // written only when the visibility flips. (audit F4)
    const showSpecBanner = this.localPlayerDead && !this.campaignMode;
    if (this.specBannerEl && showSpecBanner !== this.lastSpecBannerShown) {
      this.lastSpecBannerShown = showSpecBanner;
      this.specBannerEl.style.display = showSpecBanner ? 'block' : 'none';
    }

    // Timer — count-up for campaign with no time limit, countdown otherwise. The text changes
    // once a second, not once a tick, so text/colour writes are gated on change. (audit F4)
    if (this.timerEl) {
      let text: string;
      let color: string;
      if (this.campaignMode && state.roundTime >= 99999) {
        const elapsed = Math.max(0, Math.floor(state.timeElapsed));
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        text = `${mins}:${secs.toString().padStart(2, '0')}`;
        color = '#fff';
      } else {
        const remaining = Math.max(0, Math.ceil(state.roundTime - state.timeElapsed));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        text = `${mins}:${secs.toString().padStart(2, '0')}`;
        color = remaining <= 30 ? '#ff3355' : '#fff';
      }
      if (text !== this.lastTimerText) {
        if (this.lastTimerText === '') this.timerEl.style.display = '';
        this.lastTimerText = text;
        this.timerEl.textContent = text;
      }
      if (color !== this.lastTimerColor) {
        this.lastTimerColor = color;
        this.timerEl.style.color = color;
      }
    }

    // Player stats bar (element reuse — only update text/class when values change)
    if (me && me.alive) {
      const statsEl = this.statsEl;
      if (statsEl) {
        // Lazily create stat elements once
        if (!this.statEls) {
          setHtml(
            statsEl,
            `
            <span class="stat-item">💣 <span id="stat-bombs"></span></span>
            <span class="stat-item">🔥 <span id="stat-fire"></span></span>
            <span class="stat-item">⚡ <span id="stat-speed"></span></span>
            <span class="stat-item" id="stat-shield">🛡️</span>
            <span class="stat-item" id="stat-kick">👢</span>
            <span class="stat-item" id="stat-throw" style="opacity:0.3">🎯</span>
            <span class="stat-item" id="stat-remote-mode" style="display:none; font-size:0.75em;">🎯 ALL</span>
          `,
          );
          this.statEls = {
            bombs: document.getElementById('stat-bombs')!,
            fire: document.getElementById('stat-fire')!,
            speed: document.getElementById('stat-speed')!,
            shield: document.getElementById('stat-shield')!,
            kick: document.getElementById('stat-kick')!,
            throw: document.getElementById('stat-throw')!,
            remoteMode: document.getElementById('stat-remote-mode')!,
          };
        }

        const prev = this.previousStats;
        const els = this.statEls;

        // Only update DOM when values actually change
        if (!prev || prev.maxBombs !== me.maxBombs) {
          els.bombs.textContent = String(me.maxBombs);
          if (prev) els.bombs.parentElement!.classList.add('stat-changed');
        }
        if (!prev || prev.fireRange !== me.fireRange) {
          els.fire.textContent = String(me.fireRange);
          if (prev) els.fire.parentElement!.classList.add('stat-changed');
        }
        if (!prev || prev.speed !== me.speed) {
          els.speed.textContent = String(me.speed);
          if (prev) els.speed.parentElement!.classList.add('stat-changed');
        }
        if (!prev || prev.hasShield !== me.hasShield) {
          els.shield.style.opacity = me.hasShield ? '1' : '0.3';
        }
        if (!prev || prev.hasKick !== me.hasKick) {
          els.kick.style.opacity = me.hasKick ? '1' : '0.3';
        }
        if (!prev || prev.hasBombThrow !== me.hasBombThrow) {
          els.throw.style.opacity = me.hasBombThrow ? '1' : '0.3';
        }
        if (!prev || prev.remoteDetonateMode !== me.remoteDetonateMode) {
          if (me.hasRemoteBomb && me.remoteDetonateMode) {
            els.remoteMode.style.display = '';
            els.remoteMode.textContent = `🎯 ${me.remoteDetonateMode === 'fifo' ? t('ui:hud.remoteMode.fifo') : t('ui:hud.remoteMode.all')}`;
          } else {
            els.remoteMode.style.display = 'none';
          }
        }

        this.previousStats = {
          maxBombs: me.maxBombs,
          fireRange: me.fireRange,
          speed: me.speed,
          hasShield: me.hasShield,
          hasKick: me.hasKick,
          hasBombThrow: me.hasBombThrow,
          remoteDetonateMode: me.remoteDetonateMode,
        };
      }
    }

    // Player list (open world renders the leaderboard instead)
    const playersEl = this.openWorldMode ? null : this.playerListEl;
    if (playersEl) {
      this.playerList.render(playersEl, state.players, {
        kothScores: state.kothScores,
        controllingPlayerId: state.hillZone?.controllingPlayer ?? null,
        localPlayerDead: this.localPlayerDead,
      });
    }

    // Minimap
    this.updateMinimap(state);

    // Refresh kill feed (for age-based opacity)
    this.renderKillFeed();
  }

  private updateMinimap(state: GameState): void {
    if (!this.minimapEnabled || !this.minimapContainer) return;

    const map = state.map;
    const maxSize = 140;
    const fullTiles = map.tiles && map.tiles.length > 0 ? map.tiles : null;

    // Terrain layer: built from the first full grid seen (or the seed from the initial state),
    // rebuilt when the map size changes (open-world round restart), otherwise patched.
    //
    // This MUST happen before the redraw throttle below. tileDiffs are per-tick and cleared
    // server-side after each broadcast, so a diff skipped here is lost for good — with the
    // throttle in front, three out of every four ticks' diffs were dropped and destroyed walls
    // stayed drawn on the minimap for the rest of the match. (audit MINIMAP-DIFF-1)
    if (!this.minimapTerrain || !this.minimapTerrain.matches(map.width, map.height)) {
      const tiles = fullTiles ?? this.minimapSeedTiles;
      if (!tiles || tiles.length < map.height) return;
      this.buildMinimapCanvases(map.width, map.height, tiles, maxSize);
      this.minimapSeedTiles = null;
    } else if (fullTiles) {
      // Replays and simulation spectate carry the whole grid every frame: cheap compare, patch
      // only what changed. (audit F1)
      this.minimapTerrain.sync(fullTiles);
    } else if (state.tileDiffs) {
      this.minimapTerrain.applyDiffs(state.tileDiffs);
    }

    // Redraw at ~5 FPS for performance.
    //
    // The open world builds a fresh GameStateManager for each round, which resets tick to 0. A
    // plain `tick - last < 4` then went permanently negative from round 2 onward and the minimap
    // froze on the previous round's map for the rest of the session (HUDScene is not restarted
    // between rounds). A backwards tick means a new round. (audit MINIMAP-ROUND-1)
    if (state.tick < this.lastMinimapTick) this.lastMinimapTick = -1;
    if (state.tick - this.lastMinimapTick < 4) return;
    this.lastMinimapTick = state.tick;

    const ctx = this.minimapCtx;
    const terrainCanvas = this.minimapTerrainCanvas;
    if (!ctx || !terrainCanvas) return;
    const ts = this.minimapTileSize;

    // Terrain: one blit of the pre-painted layer instead of a fillRect per tile. (audit F1)
    ctx.drawImage(terrainCanvas, 0, 0);

    // Draw bombs (pulsing yellow/red)
    const bombBright = state.tick % 8 < 4;
    ctx.fillStyle = bombBright ? '#ffcc00' : '#ff4400';
    for (const bomb of state.bombs) {
      ctx.fillRect(bomb.position.x * ts, bomb.position.y * ts, ts, ts);
    }

    // Draw explosions
    ctx.fillStyle = '#ff6622';
    for (const exp of state.explosions) {
      for (const cell of exp.cells) {
        ctx.fillRect(cell.x * ts, cell.y * ts, ts, ts);
      }
    }

    // Draw power-ups
    ctx.fillStyle = '#00ff88';
    for (const pu of state.powerUps) {
      const px = pu.position.x * ts;
      const py = pu.position.y * ts;
      const half = Math.max(1, Math.floor(ts / 2));
      const offset = Math.floor((ts - half) / 2);
      ctx.fillRect(px + offset, py + offset, half, half);
    }

    // Draw players
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.alive) continue;
      const color = p.cosmetics?.colorHex ?? PLAYER_COLORS[i % PLAYER_COLORS.length];
      ctx.fillStyle = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
      const px = p.position.x * ts;
      const py = p.position.y * ts;
      ctx.fillRect(px, py, ts, ts);
      // Bright border for local player
      if (p.id === this.localPlayerId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, ts, ts);
      }
    }

    // Draw zone boundary (Battle Royale)
    if (state.zone) {
      const z = state.zone;
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
      ctx.lineWidth = 1;
      const zx = (z.centerX - z.currentRadius) * ts;
      const zy = (z.centerY - z.currentRadius) * ts;
      const zw = z.currentRadius * 2 * ts;
      const zh = z.currentRadius * 2 * ts;
      ctx.strokeRect(zx, zy, zw, zh);
    }

    // Draw KOTH hill zone
    if (state.hillZone) {
      const h = state.hillZone;
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x * ts, h.y * ts, h.width * ts, h.height * ts);
    }
  }

  /** (Re)create the visible minimap canvas and its offscreen terrain layer for a map size. */
  private buildMinimapCanvases(
    width: number,
    height: number,
    tiles: TileType[][],
    maxSize: number,
  ): void {
    if (!this.minimapContainer) return;
    const ts = Math.max(1, Math.floor(maxSize / Math.max(width, height)));
    this.minimapTileSize = ts;

    if (!this.minimapCanvas) {
      this.minimapCanvas = document.createElement('canvas');
      this.minimapCanvas.style.imageRendering = 'pixelated';
      this.minimapContainer.appendChild(this.minimapCanvas);
    }
    // Assigning the size also clears the canvas, which is what a new map wants
    this.minimapCanvas.width = width * ts;
    this.minimapCanvas.height = height * ts;
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.minimapTerrainCanvas = document.createElement('canvas');
    this.minimapTerrainCanvas.width = width * ts;
    this.minimapTerrainCanvas.height = height * ts;
    const terrainCtx = this.minimapTerrainCanvas.getContext('2d');
    this.minimapTerrain = terrainCtx
      ? new MinimapTerrain(terrainCtx, tiles, width, height, ts)
      : null;
    // Force an immediate redraw with the new terrain
    this.lastMinimapTick = -1;
  }

  private updateCampaignHUD(state: CampaignGameState): void {
    // Lives display (hearts)
    if (state.lives !== this.lastCampaignLives) {
      this.lastCampaignLives = state.lives;
      if (this.campaignLivesEl) {
        let hearts = '';
        for (let i = 0; i < state.maxLives; i++) {
          hearts += i < state.lives ? '❤️' : '🖤';
        }
        this.campaignLivesEl.textContent = hearts;
      }
    }

    // Enemy count (plain loop — this runs every tick; audit F4)
    let aliveEnemies = 0;
    let boss: CampaignEnemyState | undefined;
    for (const e of state.enemies) {
      if (!e.alive) continue;
      aliveEnemies++;
      if (e.isBoss && !boss) boss = e;
    }
    if (aliveEnemies !== this.lastCampaignEnemyCount) {
      this.lastCampaignEnemyCount = aliveEnemies;
      if (this.campaignEnemiesEl) {
        this.campaignEnemiesEl.textContent =
          aliveEnemies > 0 ? t('ui:hud.enemies', { count: aliveEnemies }) : '';
      }
    }

    // Co-op player status indicators. The row used to be rebuilt through setHtml (DOMPurify)
    // on every tick; now only when its content actually changes. (audit F4)
    if (state.coopMode && this.campaignCoopStatusEl) {
      const players = state.gameState.players;
      const locked = state.lockedInPlayers ?? [];
      let sig = '';
      const parts: string[] = [];
      for (const p of players) {
        let statusIcon = '';
        let statusColor = 'var(--success)';
        if (!p.alive) {
          statusIcon = ` ${t('ui:hud.coopDead')}`;
          statusColor = 'var(--danger)';
          // Check respawn timer
          if (state.respawnTimers && state.respawnTimers[p.id] !== undefined) {
            const ticksLeft = state.respawnTimers[p.id];
            const secsLeft = Math.ceil(ticksLeft / 20);
            statusIcon = ` ${t('ui:hud.coopRespawnIn', { seconds: secsLeft })}`;
            statusColor = 'var(--warning)';
          }
        } else if (locked.includes(p.id)) {
          statusIcon = ` ${t('ui:hud.coopReady')}`;
          statusColor = 'var(--accent)';
        }
        sig += `${p.id}|${p.username}|${statusColor}|${statusIcon};`;
        parts.push(
          `<span style="color:${statusColor}">${escapeHtml(p.username)}${escapeHtml(statusIcon)}</span>`,
        );
      }
      if (sig !== this.lastCoopStatusSig) {
        this.lastCoopStatusSig = sig;
        setHtml(this.campaignCoopStatusEl, parts.join(''));
      }
    }

    // Boss HP bar — fill element cached, width written only when it changes (audit F4)
    if (boss) {
      if (!this.bossFillEl || !this.bossFillEl.isConnected) {
        const bossBar = document.createElement('div');
        bossBar.id = 'campaign-boss-hp';
        bossBar.style.cssText =
          'position:fixed;top:40px;left:50%;transform:translateX(-50%);width:300px;height:20px;background:rgba(0,0,0,0.6);border-radius:4px;overflow:hidden;z-index:100;';
        document.getElementById('ui-overlay')?.appendChild(bossBar);
        const fill = document.createElement('div');
        fill.id = 'campaign-boss-hp-fill';
        fill.style.cssText = 'height:100%;background:var(--danger);transition:width 0.2s;';
        bossBar.appendChild(fill);
        this.bossFillEl = fill;
        this.lastBossFillWidth = '';
      }
      const width = `${(boss.hp / boss.maxHp) * 100}%`;
      if (width !== this.lastBossFillWidth) {
        this.lastBossFillWidth = width;
        this.bossFillEl.style.width = width;
      }
    } else if (this.bossFillEl) {
      this.bossFillEl.parentElement?.remove();
      this.bossFillEl = null;
      this.lastBossFillWidth = '';
    }
  }

  // ---------------- Open world HUD ----------------

  /** Live scoreboard docked where the player list sits in a normal match. */
  private mountOpenWorldBoard(overlay: HTMLElement | null): void {
    this.owRoundEl = document.getElementById('hud-round');
    this.owBoardEl = document.createElement('div');
    this.owBoardEl.className = 'hud-ow-board';
    setHtml(
      this.owBoardEl,
      `
      <div class="hud-ow-title">${t('ui:openWorld.leaderboard')}</div>
      <div class="hud-ow-rows"></div>
    `,
    );
    this.owRowsEl = this.owBoardEl.querySelector('.hud-ow-rows');
    overlay?.appendChild(this.owBoardEl);
    this.renderOpenWorldBoard();
  }

  /** All open-world socket listeners live on GameScene; the HUD only consumes its Phaser events. */
  private bindOpenWorldEvents(gameScene: GameScene | null): void {
    this.owRoundEndHandler = (data) => this.showRoundEndOverlay(data);
    gameScene?.events.on('openWorldRoundEnd', this.owRoundEndHandler);

    this.owRoundStartHandler = (data) => {
      this.owRoundNumber = data.roundNumber;
      // Server resets every score for the new round; the fresh board arrives with the next info
      this.owScores.clear();
      this.updateRoundChip();
      this.renderOpenWorldBoard();
      this.hideRoundEndOverlay();
    };
    gameScene?.events.on('openWorldRoundStart', this.owRoundStartHandler);

    this.owInfoHandler = (data) => {
      this.owRoundNumber = data.roundNumber;
      this.updateRoundChip();
      // Authoritative full standings — replace rather than merge, so players who left the world
      // (or dropped in score) don't linger on the board
      this.owScores.clear();
      for (const entry of data.leaderboard) {
        this.owScores.set(entry.playerId, entry);
      }
      this.renderOpenWorldBoard();
    };
    gameScene?.events.on('openWorldInfo', this.owInfoHandler);

    // Kills move the board immediately instead of waiting for the next 5s snapshot
    this.owScoreHandler = (entry) => {
      this.owScores.set(entry.playerId, entry);
      this.renderOpenWorldBoard();
    };
    gameScene?.events.on('openWorldScoreUpdate', this.owScoreHandler);

    // Seed from the last snapshot GameScene saw (or the one carried in the join ack), so the
    // board isn't blank until the next 5s broadcast — the HUD can mount long after the arena.
    const seed = this.registry.get('openWorldInfo') as
      | { roundNumber: number; leaderboard: OpenWorldScoreEntry[] }
      | undefined;
    if (seed) {
      this.owRoundNumber = seed.roundNumber;
      this.updateRoundChip();
      for (const entry of seed.leaderboard) {
        this.owScores.set(entry.playerId, entry);
      }
      this.renderOpenWorldBoard();
    }
  }

  private updateRoundChip(): void {
    if (!this.owRoundEl) return;
    if (this.owRoundNumber <= 0) {
      this.owRoundEl.style.display = 'none';
      return;
    }
    this.owRoundEl.style.display = '';
    this.owRoundEl.textContent = t('ui:openWorld.roundNumber', { number: this.owRoundNumber });
  }

  private sortedOpenWorldScores(): OpenWorldScoreEntry[] {
    return [...this.owScores.values()].sort(
      (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
    );
  }

  private openWorldRowHtml(entry: OpenWorldScoreEntry, rank: number): string {
    const self = entry.playerId === this.localPlayerId ? ' self' : '';
    return `<div class="hud-ow-row${self}">
      <span class="hud-ow-rank">${rank}</span>
      <span class="hud-ow-name">${escapeHtml(entry.username)}</span>
      <span class="hud-ow-kd">${entry.kills}/${entry.deaths}</span>
      <span class="hud-ow-score">${entry.score}</span>
    </div>`;
  }

  /** Top slots plus the local player's own row when they rank below the visible cut-off. */
  private renderOpenWorldBoard(): void {
    if (!this.owRowsEl) return;
    const entries = this.sortedOpenWorldScores();
    if (entries.length === 0) {
      setHtml(this.owRowsEl, `<div class="hud-ow-empty">${t('ui:openWorld.noPlayers')}</div>`);
      return;
    }

    const visible = 8;
    const rows = entries.slice(0, visible).map((e, i) => this.openWorldRowHtml(e, i + 1));
    const myRank = entries.findIndex((e) => e.playerId === this.localPlayerId);
    if (myRank >= visible) {
      rows.push('<div class="hud-ow-gap">···</div>');
      rows.push(this.openWorldRowHtml(entries[myRank], myRank + 1));
    }
    setHtml(this.owRowsEl, rows.join(''));
  }

  private showRoundEndOverlay(data: {
    roundNumber: number;
    leaderboard: OpenWorldScoreEntry[];
    nextRoundIn: number;
  }): void {
    this.hideRoundEndOverlay();
    this.owRoundNumber = data.roundNumber;
    this.updateRoundChip();

    // Final standings also seed the live board, so it matches the overlay behind it
    this.owScores.clear();
    for (const entry of data.leaderboard) {
      this.owScores.set(entry.playerId, entry);
    }
    this.renderOpenWorldBoard();

    const rows = data.leaderboard
      .slice(0, 10)
      .map(
        (e, i) => `<tr class="${e.playerId === this.localPlayerId ? 'self' : ''}">
          <td class="hud-ow-rank">${i + 1}</td>
          <td>${escapeHtml(e.username)}</td>
          <td>${e.kills}</td>
          <td>${e.deaths}</td>
          <td class="hud-ow-score">${e.score}</td>
        </tr>`,
      )
      .join('');

    this.owRoundEndEl = document.createElement('div');
    this.owRoundEndEl.className = 'hud-ow-roundend';
    setHtml(
      this.owRoundEndEl,
      `
      <div class="hud-ow-roundend-title">${t('ui:openWorld.roundEnd')}</div>
      <div class="hud-ow-roundend-sub">${t('ui:openWorld.roundNumber', { number: data.roundNumber })}</div>
      <table class="hud-ow-roundend-table">
        <thead>
          <tr>
            <th></th>
            <th></th>
            <th>${t('ui:openWorld.kills')}</th>
            <th>${t('ui:openWorld.deaths')}</th>
            <th>${t('ui:openWorld.score')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="hud-ow-roundend-next"></div>
    `,
    );
    document.getElementById('ui-overlay')?.appendChild(this.owRoundEndEl);

    const nextEl = this.owRoundEndEl.querySelector('.hud-ow-roundend-next') as HTMLElement;
    let seconds = Math.max(0, Math.round(data.nextRoundIn));
    nextEl.textContent = t('ui:openWorld.nextRound', { seconds });
    this.owNextRoundTimer = setInterval(() => {
      seconds--;
      if (seconds > 0) {
        nextEl.textContent = t('ui:openWorld.nextRound', { seconds });
      } else if (seconds > -10) {
        // Countdown finished — wait for the server's roundStart to clear the overlay
        nextEl.textContent = t('ui:openWorld.roundStart');
      } else {
        // roundStart never arrived (world disabled mid-freeze): don't leave a stuck overlay
        this.hideRoundEndOverlay();
      }
    }, 1000);
  }

  private hideRoundEndOverlay(): void {
    if (this.owNextRoundTimer) {
      clearInterval(this.owNextRoundTimer);
      this.owNextRoundTimer = null;
    }
    this.owRoundEndEl?.remove();
    this.owRoundEndEl = null;
  }

  private teardownOpenWorldHud(): void {
    this.hideRoundEndOverlay();
    const gameScene = this.scene.get('GameScene');
    if (this.owRoundEndHandler) {
      gameScene?.events.off('openWorldRoundEnd', this.owRoundEndHandler);
      this.owRoundEndHandler = null;
    }
    if (this.owRoundStartHandler) {
      gameScene?.events.off('openWorldRoundStart', this.owRoundStartHandler);
      this.owRoundStartHandler = null;
    }
    if (this.owInfoHandler) {
      gameScene?.events.off('openWorldInfo', this.owInfoHandler);
      this.owInfoHandler = null;
    }
    if (this.owScoreHandler) {
      gameScene?.events.off('openWorldScoreUpdate', this.owScoreHandler);
      this.owScoreHandler = null;
    }
    this.owBoardEl?.remove();
    this.owBoardEl = null;
    this.owRowsEl = null;
    this.owRoundEl = null;
  }

  private mountSpectatorChat(): void {
    const socketClient = this.registry.get('socketClient');
    const authManager = this.registry.get('authManager');
    if (!socketClient || !authManager) return;
    const user = authManager.getUser();
    if (!user) return;

    this.spectatorChat = new SpectatorChat(socketClient, user.role);
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      this.spectatorChat.mount(uiOverlay);
      this.spectatorChatMounted = true;
    }
  }

  private mountSpectatorActionBar(): void {
    const socketClient = this.registry.get('socketClient');
    if (!socketClient) return;

    this.spectatorActionBar = new SpectatorActionBar(socketClient);
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      this.spectatorActionBar.mount(uiOverlay);
      this.spectatorActionBarMounted = true;

      // Wire up targeting callbacks to GameScene
      const gameScene = this.scene.get('GameScene');
      if (gameScene) {
        this.spectatorActionBar.setCallbacks(
          (type) => gameScene.events.emit('spectatorTargeting', type),
          () => gameScene.events.emit('spectatorTargetingCancel'),
        );
      }
    }
  }

  /** Docked login/register bar shown to open-world guests while playing. */
  private mountAuthBar(): void {
    this.authBarEl = document.createElement('div');
    this.authBarEl.className = 'hud-auth-bar';
    setHtml(
      this.authBarEl,
      `
      <div class="hud-auth-brand"><span>${t('auth:login.title')}</span>${t('auth:login.titleAccent')}</div>
      <button class="btn btn-secondary" id="hud-login-btn">${t('ui:menu.login')}</button>
      <button class="btn btn-ghost" id="hud-register-btn">${t('ui:menu.register')}</button>
    `,
    );
    // Seamless takeover from an already-docked landing bar: same spot, no fly-in replay.
    if (this.registry.get('authBarNoAnim')) {
      this.registry.remove('authBarNoAnim');
      this.authBarEl.classList.add('hud-auth-bar--instant');
    }
    this.authBarEl
      .querySelector('#hud-login-btn')!
      .addEventListener('click', () => this.openAuthOverlay('login'));
    this.authBarEl
      .querySelector('#hud-register-btn')!
      .addEventListener('click', () => this.openAuthOverlay('register'));
    // Keep keystrokes on the focused bar buttons (Tab + Space/Enter) out of the game input —
    // otherwise Space drops a bomb instead of activating the button (same pattern as
    // SpectatorChat's input handler).
    this.authBarEl.addEventListener('keydown', (e) => e.stopPropagation());
    document.getElementById('ui-overlay')?.appendChild(this.authBarEl);
  }

  /**
   * Open the auth form OVER the running game: the arena stays live behind the overlay and the
   * guest keeps their session unless login actually succeeds. Game input is blocked while the
   * form is open so keystrokes reach the form.
   */
  private openAuthOverlay(mode: 'login' | 'register'): void {
    if (this.registry.get('authOverlayOpen')) return;
    const authManager = this.registry.get('authManager') as AuthManager;
    const notifications = this.registry.get('notifications') as NotificationUI;
    this.registry.set('authOverlayOpen', true);
    (this.scene.get('GameScene') as GameScene | null)?.setInputBlocked(true);
    this.authUI = new AuthUI(
      authManager,
      notifications,
      () => this.onAuthSuccess(),
      () => this.onAuthClose(),
    );
    this.authUI.show(mode);
  }

  /**
   * Login succeeded: drop the guest session (server removes the guest player on disconnect)
   * and restart MenuScene — its auto-login picks up the new refresh cookie and routes through
   * the normal verification/lobby flow, which auto-joins the open world as the account.
   * Uses game.scene (manager-level) because an AFK kick may have stopped this scene while the
   * form was open.
   */
  private onAuthSuccess(): void {
    this.registry.remove('authOverlayOpen');
    this.authUI = null;
    if (this.game.scene.isActive('GameScene')) this.game.scene.stop('GameScene');
    if (this.game.scene.isActive('HUDScene')) this.game.scene.stop('HUDScene');
    (this.registry.get('socketClient') as SocketClient | undefined)?.disconnect();
    this.registry.remove('openWorldPlayerId');
    this.game.scene.start('MenuScene');
  }

  /** Form dismissed without logging in: resume play, or return to the landing if AFK-kicked. */
  private onAuthClose(): void {
    this.registry.remove('authOverlayOpen');
    this.authUI = null;
    if (!this.game.scene.isActive('GameScene')) {
      // AFK kick ended the run while the form was open — the arena is gone.
      this.game.scene.start('MenuScene');
      return;
    }
    (this.scene.get('GameScene') as GameScene | null)?.setInputBlocked(false);
  }

  shutdown(): void {
    if (this.boundClickHandler) {
      this.playerListEl?.removeEventListener('mousedown', this.boundClickHandler);
      this.boundClickHandler = null;
    }
    if (this.stateUpdateHandler) {
      const gameScene = this.scene.get('GameScene');
      gameScene?.events.off('stateUpdate', this.stateUpdateHandler);
      this.stateUpdateHandler = null;
    }
    if (this.localPlayerChangedHandler) {
      this.scene.get('GameScene')?.events.off('localPlayerChanged', this.localPlayerChangedHandler);
      this.localPlayerChangedHandler = null;
    }
    if (this.playerDiedHandler && this.socketClient) {
      this.socketClient.off('game:playerDied', this.playerDiedHandler);
      this.playerDiedHandler = null;
    }
    if (this.campaignStateHandler) {
      const gameScene = this.scene.get('GameScene');
      gameScene?.events.off('campaignStateUpdate', this.campaignStateHandler);
      this.campaignStateHandler = null;
    }
    if (this.campaignPlayerDiedHandler) {
      const gameScene = this.scene.get('GameScene');
      gameScene?.events.off('campaignPlayerDied', this.campaignPlayerDiedHandler);
      this.campaignPlayerDiedHandler = null;
    }
    if (this.adminMessageHandler && this.socketClient) {
      this.socketClient.off('admin:roomMessage', this.adminMessageHandler);
      this.adminMessageHandler = null;
    }
    this.hideAdminBanner();
    if (this.spectatorChat) {
      this.spectatorChat.destroy();
      this.spectatorChat = null;
      this.spectatorChatMounted = false;
    }
    if (this.spectatorActionBar) {
      this.spectatorActionBar.destroy();
      this.spectatorActionBar = null;
      this.spectatorActionBarMounted = false;
    }
    this.hudContainer?.remove();
    this.statsEl?.remove();
    this.playerListEl?.remove();
    this.killFeedEl?.remove();
    this.authBarEl?.remove();
    this.authBarEl = null;
    this.teardownOpenWorldHud();
    this.minimapContainer?.remove();
    this.minimapContainer = null;
    this.minimapTerrain = null;
    this.minimapTerrainCanvas = null;
    this.minimapSeedTiles = null;
    this.minimapCanvas = null;
    this.minimapCtx = null;
    this.timerEl = null;
    this.specBannerEl = null;
    this.campaignHudEl?.remove();
    this.campaignHudEl = null;
    this.campaignLivesEl = null;
    this.campaignEnemiesEl = null;
    this.campaignCoopStatusEl = null;
    document.getElementById('campaign-boss-hp')?.remove();
    this.bossFillEl = null;
  }
}
