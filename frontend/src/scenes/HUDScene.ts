import Phaser from 'phaser';
import { GameState } from '@blast-arena/shared';

export class HUDScene extends Phaser.Scene {
  private hudContainer!: HTMLElement;
  private statsEl!: HTMLElement;
  private playerListEl!: HTMLElement;
  private killFeedEl!: HTMLElement;
  private localPlayerDead: boolean = false;
  private localPlayerId!: number;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private socketClient: any = null;
  private playerDiedHandler: ((data: { playerId: number; killerId: number | null }) => void) | null = null;
  private killFeedEntries: { text: string; time: number }[] = [];
  private previousStats: { maxBombs: number; fireRange: number; speed: number; hasShield: boolean; hasKick: boolean } | null = null;

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

    this.events.once('shutdown', this.shutdown, this);

    const authManager = this.registry.get('authManager');
    this.localPlayerId = authManager.getUser()?.id ?? 0;
    this.localPlayerDead = false;
    this.killFeedEntries = [];
    this.previousStats = null;

    this.socketClient = this.registry.get('socketClient');

    // Main HUD container
    this.hudContainer = document.createElement('div');
    this.hudContainer.className = 'hud-container';
    this.hudContainer.innerHTML = `
      <div class="hud-top">
        <div class="hud-timer" id="hud-timer">3:00</div>
      </div>
      <div class="hud-spectator-banner" id="hud-spectator" style="display:none;">
        SPECTATOR — WASD/Arrows/D-Pad to pan, 1-9/LB/RB or click to follow
      </div>
    `;

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
      setTimeout(() => { (item as HTMLElement).style.background = ''; }, 300);
    };
    this.playerListEl.addEventListener('mousedown', this.boundClickHandler);

    // Listen for kill events
    if (this.socketClient) {
      this.playerDiedHandler = (data: { playerId: number; killerId: number | null }) => {
        this.onPlayerDied(data);
      };
      this.socketClient.on('game:playerDied', this.playerDiedHandler);
    }

    // Listen for state updates from GameScene
    const gameScene = this.scene.get('GameScene');
    gameScene.events.on('stateUpdate', (state: GameState) => {
      this.updateHUD(state);
    });
  }

  private onPlayerDied(data: { playerId: number; killerId: number | null }): void {
    // Look up names from latest game state
    const state = this.registry.get('initialGameState') as GameState | undefined;
    if (!state) return;

    // We use the last known state stored in the event context
    const victim = this.lastKnownPlayers?.find(p => p.id === data.playerId);
    const killer = data.killerId ? this.lastKnownPlayers?.find(p => p.id === data.killerId) : null;

    let text: string;
    if (killer && killer.id !== data.playerId) {
      text = `${killer.username} eliminated ${victim?.username || '???'}`;
    } else {
      text = `${victim?.username || '???'} was eliminated`;
    }

    this.killFeedEntries.push({ text, time: Date.now() });
    if (this.killFeedEntries.length > 5) {
      this.killFeedEntries.shift();
    }
    this.renderKillFeed();
  }

  private lastKnownPlayers: any[] = [];

  private renderKillFeed(): void {
    const now = Date.now();
    // Remove entries older than 5 seconds
    this.killFeedEntries = this.killFeedEntries.filter(e => now - e.time < 5000);

    if (this.killFeedEl) {
      this.killFeedEl.innerHTML = this.killFeedEntries.map(e => {
        const age = now - e.time;
        const opacity = Math.max(0.3, 1 - age / 5000);
        return `<div class="killfeed-entry" style="opacity:${opacity}">${e.text}</div>`;
      }).join('');
    }
  }

  private updateHUD(state: GameState): void {
    this.lastKnownPlayers = state.players;

    // Track local player death
    const me = state.players.find((p: any) => p.id === this.localPlayerId);
    if (!this.localPlayerDead && me && !me.alive) {
      this.localPlayerDead = true;
    }

    // Spectator banner
    const specBanner = document.getElementById('hud-spectator');
    if (specBanner) {
      specBanner.style.display = this.localPlayerDead ? 'block' : 'none';
    }

    // Timer
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) {
      const remaining = Math.max(0, Math.ceil(state.roundTime - state.timeElapsed));
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      timerEl.style.color = remaining <= 30 ? '#ff3355' : '#fff';
    }

    // Player stats bar
    if (me && me.alive) {
      const statsEl = document.getElementById('hud-stats');
      if (statsEl) {
        const changed = (key: string) => {
          if (!this.previousStats) return '';
          const prev = (this.previousStats as any)[key];
          const curr = (me as any)[key];
          if (prev !== undefined && curr !== undefined && prev !== curr) {
            return ' stat-changed';
          }
          return '';
        };

        statsEl.innerHTML = `
          <span class="stat-item${changed('maxBombs')}">💣 ${me.maxBombs}</span>
          <span class="stat-item${changed('fireRange')}">🔥 ${me.fireRange}</span>
          <span class="stat-item${changed('speed')}">⚡ ${me.speed}</span>
          <span class="stat-item">${me.hasShield ? '🛡️' : '<span style="opacity:0.3">🛡️</span>'}</span>
          <span class="stat-item">${me.hasKick ? '👢' : '<span style="opacity:0.3">👢</span>'}</span>
        `;

        this.previousStats = {
          maxBombs: me.maxBombs,
          fireRange: me.fireRange,
          speed: me.speed,
          hasShield: me.hasShield,
          hasKick: me.hasKick,
        };
      }
    }

    // Player list
    const playersEl = document.getElementById('hud-players');
    if (playersEl) {
      const isTeamMode = state.players.some((p: any) => p.team !== null && p.team !== undefined);
      const sorted = [...state.players].sort((a: any, b: any) => {
        // In team mode, group by team first, then alive status
        if (isTeamMode && a.team !== b.team) return (a.team ?? 99) - (b.team ?? 99);
        return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
      });

      const teamColors = ['#ff4466', '#448aff'];
      let lastTeam = -1;

      playersEl.innerHTML = sorted.map((p: any) => {
        const dead = !p.alive;
        const clickable = p.alive && this.localPlayerDead;
        let teamHeader = '';
        if (isTeamMode && p.team !== lastTeam) {
          lastTeam = p.team;
          const teamName = p.team === 0 ? 'Team Red' : 'Team Blue';
          teamHeader = `<div style="font-size:11px;font-weight:600;color:${teamColors[p.team]};padding:4px 8px 2px;margin-top:${p.team > 0 ? '6px' : '0'};">${teamName}</div>`;
        }
        const teamDot = isTeamMode ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamColors[p.team]};margin-right:4px;vertical-align:middle;"></span>` : '';
        return `${teamHeader}<div class="hud-player-item${dead ? ' dead' : ''}${clickable ? ' clickable' : ''}" data-player-id="${p.id}">
          <span>${teamDot}${p.isBot ? '🤖 ' : ''}${p.username}</span>
        </div>`;
      }).join('');
    }

    // Refresh kill feed (for age-based opacity)
    this.renderKillFeed();
  }

  shutdown(): void {
    if (this.boundClickHandler) {
      this.playerListEl?.removeEventListener('mousedown', this.boundClickHandler);
      this.boundClickHandler = null;
    }
    if (this.playerDiedHandler && this.socketClient) {
      this.socketClient.off('game:playerDied', this.playerDiedHandler);
      this.playerDiedHandler = null;
    }
    this.hudContainer?.remove();
    this.statsEl?.remove();
    this.playerListEl?.remove();
    this.killFeedEl?.remove();
  }
}
