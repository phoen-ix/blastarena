import Phaser from 'phaser';
import { GameState, PlayerState, CampaignGameState } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { SpectatorChat } from '../game/SpectatorChat';

export class HUDScene extends Phaser.Scene {
  private hudContainer!: HTMLElement;
  private statsEl!: HTMLElement;
  private playerListEl!: HTMLElement;
  private killFeedEl!: HTMLElement;
  private localPlayerDead: boolean = false;
  private localPlayerId!: number;
  private boundClickHandler: ((e: MouseEvent) => void) | null = null;
  private socketClient: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    off: (event: string, handler: (...args: any[]) => void) => void;
  } | null = null;
  private playerDiedHandler:
    | ((data: { playerId: number; killerId: number | null }) => void)
    | null = null;
  private killFeedEntries: { text: string; time: number; el?: HTMLElement }[] = [];
  private stateUpdateHandler: ((state: GameState) => void) | null = null;
  private previousStats: {
    maxBombs: number;
    fireRange: number;
    speed: number;
    hasShield: boolean;
    hasKick: boolean;
  } | null = null;
  // Element refs for stats bar (avoid innerHTML on every update)
  private statEls: {
    bombs: HTMLElement;
    fire: HTMLElement;
    speed: HTMLElement;
    shield: HTMLElement;
    kick: HTMLElement;
  } | null = null;
  // Player list element cache for differential updates
  private playerListCache: Map<string, HTMLElement> = new Map();

  // Campaign HUD
  private campaignMode: boolean = false;
  private campaignHudEl: HTMLElement | null = null;
  private lastCampaignLives: number = -1;
  private lastCampaignEnemyCount: number = -1;
  private spectatorChat: SpectatorChat | null = null;
  private spectatorChatMounted: boolean = false;

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

    // Force spectator mode for simulation/replay viewers
    const simSpectate = this.registry.get('simulationSpectate');
    const replayMode = this.registry.get('replayMode');
    if (simSpectate || replayMode) {
      this.localPlayerDead = true;
    }

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
      setTimeout(() => {
        (item as HTMLElement).style.background = '';
      }, 300);
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
    this.stateUpdateHandler = (state: GameState) => {
      this.updateHUD(state);
    };
    gameScene.events.on('stateUpdate', this.stateUpdateHandler);

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
      this.campaignHudEl.innerHTML = `
        <span id="campaign-lives" style="display:flex;align-items:center;gap:4px;"></span>
        <span id="campaign-enemies" style="color:var(--danger);"></span>
        ${isCoopMode ? '<span id="campaign-coop-status" style="display:flex;gap:8px;align-items:center;"></span>' : ''}
      `;
      const overlay = document.getElementById('ui-overlay');
      overlay?.appendChild(this.campaignHudEl);

      // Listen for campaign state updates
      const sc = this.registry.get('socketClient');
      if (sc) {
        sc.on('campaign:state', (state: CampaignGameState) => {
          this.updateCampaignHUD(state);
        });
      }
    }
  }

  private onPlayerDied(data: { playerId: number; killerId: number | null }): void {
    // Look up names from latest game state
    const state = this.registry.get('initialGameState') as GameState | undefined;
    if (!state) return;

    // We use the last known state stored in the event context
    const victim = this.lastKnownPlayers?.find((p) => p.id === data.playerId);
    const killer = data.killerId
      ? this.lastKnownPlayers?.find((p) => p.id === data.killerId)
      : null;

    let text: string;
    if (killer && killer.id !== data.playerId) {
      text = `${escapeHtml(killer.username)} eliminated ${escapeHtml(victim?.username || '???')}`;
    } else {
      text = `${escapeHtml(victim?.username || '???')} was eliminated`;
    }

    this.killFeedEntries.push({ text, time: Date.now() });
    if (this.killFeedEntries.length > 5) {
      this.killFeedEntries.shift();
    }
    this.renderKillFeed();
  }

  private lastKnownPlayers: PlayerState[] = [];

  private renderKillFeed(): void {
    const now = Date.now();
    if (!this.killFeedEl) return;

    // Remove expired entries and their DOM elements
    const filtered: typeof this.killFeedEntries = [];
    for (const entry of this.killFeedEntries) {
      if (now - entry.time >= 5000) {
        entry.el?.remove();
      } else {
        // Update opacity on surviving entries
        const age = now - entry.time;
        const opacity = Math.max(0.3, 1 - age / 5000);
        if (entry.el) {
          entry.el.style.opacity = String(opacity);
        } else {
          // Create DOM element for new entries
          const el = document.createElement('div');
          el.className = 'killfeed-entry';
          el.style.opacity = String(opacity);
          el.innerHTML = entry.text;
          this.killFeedEl.appendChild(el);
          entry.el = el;
        }
        filtered.push(entry);
      }
    }
    this.killFeedEntries = filtered;
  }

  private updateHUD(state: GameState): void {
    this.lastKnownPlayers = state.players;

    // Track local player death (campaign: reset on respawn)
    const me = state.players.find((p) => p.id === this.localPlayerId);
    if (!this.localPlayerDead && me && !me.alive) {
      this.localPlayerDead = true;
      // Mount spectator chat when player dies (not campaign/replay/sim)
      if (
        !this.campaignMode &&
        !this.spectatorChatMounted &&
        !this.registry.get('replayMode') &&
        !this.registry.get('simulationSpectate')
      ) {
        this.mountSpectatorChat();
      }
    } else if (this.localPlayerDead && this.campaignMode && me && me.alive) {
      this.localPlayerDead = false;
    }

    // Spectator banner (not useful in campaign — single player, respawns)
    const specBanner = document.getElementById('hud-spectator');
    if (specBanner) {
      specBanner.style.display = this.localPlayerDead && !this.campaignMode ? 'block' : 'none';
    }

    // Timer (hide for campaign with no time limit)
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) {
      if (this.campaignMode && state.roundTime >= 99999) {
        timerEl.style.display = 'none';
      } else {
        timerEl.style.display = '';
        const remaining = Math.max(0, Math.ceil(state.roundTime - state.timeElapsed));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        timerEl.style.color = remaining <= 30 ? '#ff3355' : '#fff';
      }
    }

    // Player stats bar (element reuse — only update text/class when values change)
    if (me && me.alive) {
      const statsEl = document.getElementById('hud-stats');
      if (statsEl) {
        // Lazily create stat elements once
        if (!this.statEls) {
          statsEl.innerHTML = `
            <span class="stat-item">💣 <span id="stat-bombs"></span></span>
            <span class="stat-item">🔥 <span id="stat-fire"></span></span>
            <span class="stat-item">⚡ <span id="stat-speed"></span></span>
            <span class="stat-item" id="stat-shield">🛡️</span>
            <span class="stat-item" id="stat-kick">👢</span>
          `;
          this.statEls = {
            bombs: document.getElementById('stat-bombs')!,
            fire: document.getElementById('stat-fire')!,
            speed: document.getElementById('stat-speed')!,
            shield: document.getElementById('stat-shield')!,
            kick: document.getElementById('stat-kick')!,
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
      const isTeamMode = state.players.some((p) => p.team !== null && p.team !== undefined);
      const sorted = [...state.players].sort((a, b) => {
        // In team mode, group by team first, then alive status
        if (isTeamMode && a.team !== b.team) return (a.team ?? 99) - (b.team ?? 99);
        return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
      });

      const teamColors = ['#ff4466', '#448aff'];
      let lastTeam = -1;

      const isKOTH = !!state.kothScores;

      // In KOTH, sort by score descending
      if (isKOTH) {
        sorted.sort((a, b) => {
          const sa = state.kothScores?.[a.id] ?? 0;
          const sb = state.kothScores?.[b.id] ?? 0;
          return sb - sa || (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
        });
      }

      playersEl.innerHTML = sorted
        .map((p) => {
          const dead = !p.alive;
          const clickable = p.alive && this.localPlayerDead;
          let teamHeader = '';
          if (isTeamMode && p.team !== lastTeam) {
            lastTeam = p.team ?? -1;
            const teamName = p.team === 0 ? 'Team Red' : 'Team Blue';
            teamHeader = `<div style="font-size:11px;font-weight:600;color:${teamColors[p.team ?? 0]};padding:4px 8px 2px;margin-top:${(p.team ?? 0) > 0 ? '6px' : '0'};">${teamName}</div>`;
          }
          const teamDot = isTeamMode
            ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${teamColors[p.team ?? 0]};margin-right:4px;vertical-align:middle;"></span>`
            : '';

          // KOTH score badge
          let scoreBadge = '';
          if (isKOTH) {
            const score = state.kothScores?.[p.id] ?? 0;
            const isControlling = state.hillZone?.controllingPlayer === p.id;
            const scoreColor = isControlling ? '#00e676' : '#ffaa22';
            scoreBadge = `<span style="margin-left:auto;font-size:11px;font-weight:700;color:${scoreColor};font-family:'Chakra Petch',monospace;">${isControlling ? '👑 ' : ''}${score}</span>`;
          }

          const buddyTag = p.isBuddy
            ? '<span style="color:var(--accent);font-size:10px;font-weight:700;margin-left:4px;">[BUDDY]</span>'
            : '';

          return `${teamHeader}<div class="hud-player-item${dead ? ' dead' : ''}${clickable ? ' clickable' : ''}" data-player-id="${p.id}" style="${isKOTH ? 'display:flex;align-items:center;gap:4px;' : ''}">
          <span>${teamDot}${p.isBot ? '🤖 ' : ''}${escapeHtml(p.username)}${buddyTag}</span>
          ${scoreBadge}
        </div>`;
        })
        .join('');
    }

    // Refresh kill feed (for age-based opacity)
    this.renderKillFeed();
  }

  private updateCampaignHUD(state: CampaignGameState): void {
    // Lives display (hearts)
    if (state.lives !== this.lastCampaignLives) {
      this.lastCampaignLives = state.lives;
      const livesEl = document.getElementById('campaign-lives');
      if (livesEl) {
        let hearts = '';
        for (let i = 0; i < state.maxLives; i++) {
          hearts += i < state.lives ? '❤️' : '🖤';
        }
        livesEl.textContent = hearts;
      }
    }

    // Enemy count
    const aliveEnemies = state.enemies.filter((e) => e.alive).length;
    if (aliveEnemies !== this.lastCampaignEnemyCount) {
      this.lastCampaignEnemyCount = aliveEnemies;
      const enemiesEl = document.getElementById('campaign-enemies');
      if (enemiesEl) {
        enemiesEl.textContent = aliveEnemies > 0 ? `Enemies: ${aliveEnemies}` : '';
      }
    }

    // Co-op player status indicators
    if (state.coopMode) {
      const statusEl = document.getElementById('campaign-coop-status');
      if (statusEl) {
        const players = state.gameState.players;
        const locked = state.lockedInPlayers ?? [];
        statusEl.innerHTML = players
          .map((p) => {
            let statusIcon = '';
            let statusColor = 'var(--success)';
            if (!p.alive) {
              statusIcon = ' (dead)';
              statusColor = 'var(--danger)';
              // Check respawn timer
              if (state.respawnTimers && state.respawnTimers[p.id] !== undefined) {
                const ticksLeft = state.respawnTimers[p.id];
                const secsLeft = Math.ceil(ticksLeft / 20);
                statusIcon = ` (${secsLeft}s)`;
                statusColor = 'var(--warning)';
              }
            } else if (locked.includes(p.id)) {
              statusIcon = ' (ready)';
              statusColor = 'var(--accent)';
            }
            return `<span style="color:${statusColor}">${escapeHtml(p.username)}${statusIcon}</span>`;
          })
          .join('');
      }
    }

    // Boss HP bar
    const boss = state.enemies.find((e) => e.isBoss && e.alive);
    let bossBar = document.getElementById('campaign-boss-hp');
    if (boss) {
      if (!bossBar) {
        bossBar = document.createElement('div');
        bossBar.id = 'campaign-boss-hp';
        bossBar.style.cssText =
          'position:fixed;top:40px;left:50%;transform:translateX(-50%);width:300px;height:20px;background:rgba(0,0,0,0.6);border-radius:4px;overflow:hidden;z-index:100;';
        document.getElementById('ui-overlay')?.appendChild(bossBar);
        const fill = document.createElement('div');
        fill.id = 'campaign-boss-hp-fill';
        fill.style.cssText = 'height:100%;background:var(--danger);transition:width 0.2s;';
        bossBar.appendChild(fill);
      }
      const fill = document.getElementById('campaign-boss-hp-fill');
      if (fill) {
        fill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      }
    } else if (bossBar) {
      bossBar.remove();
    }
  }

  private mountSpectatorChat(): void {
    const socketClient = this.registry.get('socketClient');
    const authManager = this.registry.get('authManager');
    if (!socketClient || !authManager) return;
    const user = authManager.getUser();
    if (!user) return;

    this.spectatorChat = new SpectatorChat(socketClient, user.id, user.role);
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      this.spectatorChat.mount(uiOverlay);
      this.spectatorChatMounted = true;
    }
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
    if (this.playerDiedHandler && this.socketClient) {
      this.socketClient.off('game:playerDied', this.playerDiedHandler);
      this.playerDiedHandler = null;
    }
    if (this.spectatorChat) {
      this.spectatorChat.destroy();
      this.spectatorChat = null;
      this.spectatorChatMounted = false;
    }
    this.hudContainer?.remove();
    this.statsEl?.remove();
    this.playerListEl?.remove();
    this.killFeedEl?.remove();
    this.campaignHudEl?.remove();
    this.campaignHudEl = null;
    document.getElementById('campaign-boss-hp')?.remove();
  }
}
