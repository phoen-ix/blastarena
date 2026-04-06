import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import {
  GameState,
  CampaignGameState,
  Direction,
  ReplayData,
  ReplayTickEvents,
  PlayerCosmeticData,
  CampaignWorldTheme,
  OpenWorldScoreEntry,
  TILE_SIZE,
  TICK_MS,
} from '@blast-arena/shared';
import { t } from '../i18n';
import { TileMapRenderer } from '../game/TileMap';
import { PlayerSpriteRenderer } from '../game/PlayerSprite';
import { BombSpriteRenderer } from '../game/BombSprite';
import { ExplosionRenderer } from '../game/ExplosionSprite';
import { PowerUpRenderer } from '../game/PowerUpSprite';
import { ShrinkingZoneRenderer } from '../game/ShrinkingZone';
import { HillZoneRenderer } from '../game/HillZone';
import { EffectSystem } from '../game/EffectSystem';
import { CountdownOverlay } from '../game/CountdownOverlay';
import { GamepadManager } from '../game/GamepadManager';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { ReplayPlayer } from '../game/ReplayPlayer';
import { ReplayControls } from '../game/ReplayControls';
import { ReplayLogPanel } from '../game/ReplayLogPanel';
import { EnemySpriteRenderer } from '../game/EnemySprite';
import { EnemyTextureGenerator } from '../game/EnemyTextureGenerator';
import { EmoteBubbleRenderer } from '../game/EmoteBubble';
import { EmoteWheel } from '../game/EmoteWheel';
import { generateThemedTileTextures, generateHazardTileTextures } from '../utils/campaignThemes';
import { MapEventRenderer } from '../game/MapEventRenderer';
import {
  LocalCoopInput,
  LocalCoopConfig,
  LocalCoopP2Identity,
  CameraMode,
  DEFAULT_LOCAL_COOP_CONFIG,
} from '../game/LocalCoopInput';
import { ApiClient } from '../network/ApiClient';
import { EmoteId, EMOTES, CampaignLevelSummary } from '@blast-arena/shared';
import { audioManager } from '../game/AudioManager';

export class GameScene extends Phaser.Scene {
  private socketClient!: SocketClient;
  private authManager!: AuthManager;
  private localPlayerId!: number;

  // Composed renderers
  private tileMap!: TileMapRenderer;
  private playerRenderer!: PlayerSpriteRenderer;
  private bombRenderer!: BombSpriteRenderer;
  private explosionRenderer!: ExplosionRenderer;
  private powerUpRenderer!: PowerUpRenderer;
  private zoneRenderer!: ShrinkingZoneRenderer;
  private hillZoneRenderer!: HillZoneRenderer;
  private effectSystem!: EffectSystem;
  private countdownOverlay!: CountdownOverlay;
  private mapEventRenderer!: MapEventRenderer;

  // Input
  private addedKeys: Phaser.Input.Keyboard.Key[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private detonateKey!: Phaser.Input.Keyboard.Key;
  private throwKey!: Phaser.Input.Keyboard.Key;
  private gamepadManager!: GamepadManager;
  private pendingGamepadAction: 'bomb' | 'detonate' | 'throw' | null = null;
  private lastInputSeq: number = 0;
  private lastInputTime: number = 0;

  // Game state
  private lastGameState: GameState | null = null;
  private localPlayerDead: boolean = false;
  private hasShownCountdown: boolean = false;
  /** Stored map tiles from initial state — updated in-place with tile diffs */
  private storedTiles: import('@blast-arena/shared').TileType[][] | null = null;

  // Replay mode
  private replayPlayer: ReplayPlayer | null = null;
  private replayControls: ReplayControls | null = null;
  private replayLogPanel: ReplayLogPanel | null = null;

  // Campaign mode
  private campaignMode: boolean = false;
  private campaignCoopMode: boolean = false;
  private localCoopMode: boolean = false;
  private localCoopInput: LocalCoopInput | null = null;
  private localP2Id: number = 0;
  private buddyMode: boolean = false;
  private coopCameraMode: CameraMode = 'shared';
  private p2Camera: Phaser.Cameras.Scene2D.Camera | null = null;
  private splitDivider: Phaser.GameObjects.Graphics | null = null;
  private splitScreenInitialized: boolean = false;
  private splitBaseZoom: number = 1;
  private p1PartnerArrow: Phaser.GameObjects.Graphics | null = null;
  private p2PartnerArrow: Phaser.GameObjects.Graphics | null = null;
  private enemyRenderer: EnemySpriteRenderer | null = null;
  private lastCampaignState: CampaignGameState | null = null;
  private campaignStateHandler: ((state: CampaignGameState) => void) | null = null;

  // Emotes
  private emoteRenderer: EmoteBubbleRenderer | null = null;
  private emoteWheel: EmoteWheel | null = null;
  private emoteKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _emotePositions = new Map<number, { x: number; y: number }>();

  // Open world mode
  private openWorldMode: boolean = false;
  private openWorldRoundEndHandler:
    | ((data: {
        roundNumber: number;
        leaderboard: OpenWorldScoreEntry[];
        nextRoundIn: number;
      }) => void)
    | null = null;
  private openWorldRoundStartHandler:
    | ((data: { roundNumber: number; state: GameState }) => void)
    | null = null;

  // Campaign pause
  private paused: boolean = false;
  private pauseOverlay: HTMLElement | null = null;
  private pauseKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Spectator mode
  private freeCamX: number = 0;
  private freeCamY: number = 0;
  private spectateTargetId: number | null = null;
  private keysDown: Set<string> = new Set();
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  // Spectator Game Master targeting
  private spectatorTargeting: string | null = null;
  private spectatorClickHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  /**
   * Wrapper for Phaser's keyboard.addKey that explicitly tracks keys added by this scene.
   * This guarantees we can individually release these specific keys and unbind their
   * browser captures (preventDefault) on shutdown.
   * Avoids the "nuke everything" `clearCaptures()` API which could break other active scenes,
   * while fixing bugs where GameScene's WASD captures persisted into HTML text inputs.
   */
  private addKey(keyCode: number): Phaser.Input.Keyboard.Key {
    const key = this.input.keyboard!.addKey(keyCode);
    this.addedKeys.push(key);
    return key;
  }

  private removeAllTrackedKeys(): void {
    if (!this.input.keyboard) return;
    for (const key of this.addedKeys) {
      this.input.keyboard.removeKey(key.keyCode);
      this.input.keyboard.removeCapture(key.keyCode);
    }
    this.addedKeys = [];
  }

  create(): void {
    UIGamepadNavigator.getInstance().setActive(false);

    this.socketClient = this.registry.get('socketClient');
    this.authManager = this.registry.get('authManager');
    const initialState: GameState = this.registry.get('initialGameState');

    // Clean up stale state from previous game
    this.socketClient.off('game:state');
    this.socketClient.off('game:over');
    this.socketClient.off('game:emote');
    this.socketClient.off('game:bombThrown');
    // Remove only OUR campaign:state handler — HUDScene also listens on this event
    if (this.campaignStateHandler) {
      this.socketClient.off('campaign:state', this.campaignStateHandler);
      this.campaignStateHandler = null;
    }
    this.socketClient.off('campaign:levelComplete');
    this.socketClient.off('campaign:gameOver');
    this.socketClient.off('campaign:playerLockedIn');
    this.socketClient.off('campaign:partnerLeft');
    this.removeSpectatorListeners();
    if (this.emoteKeyHandler) {
      window.removeEventListener('keydown', this.emoteKeyHandler);
      this.emoteKeyHandler = null;
    }
    if (this.pauseKeyHandler) {
      window.removeEventListener('keydown', this.pauseKeyHandler);
      this.pauseKeyHandler = null;
    }
    this.hidePauseOverlay();
    this.cleanupRenderers();

    // Open world cleanup
    this.socketClient.off('openworld:state');
    if (this.openWorldRoundEndHandler) {
      this.socketClient.off('openworld:roundEnd', this.openWorldRoundEndHandler);
      this.openWorldRoundEndHandler = null;
    }
    if (this.openWorldRoundStartHandler) {
      this.socketClient.off('openworld:roundStart', this.openWorldRoundStartHandler);
      this.openWorldRoundStartHandler = null;
    }

    // Detect open world mode
    this.openWorldMode = !!this.registry.get('openWorldMode');
    this.registry.remove('openWorldMode');
    const openWorldPlayerId = this.registry.get('openWorldPlayerId') as number | undefined;

    // Set local player ID — open world guests get server-assigned negative IDs
    this.localPlayerId = openWorldPlayerId ?? this.authManager.getUser()?.id ?? 0;

    // Reset state
    this.paused = false;
    this.localPlayerDead = false;
    this.freeCamX = 0;
    this.freeCamY = 0;
    this.spectateTargetId = null;
    this.isDragging = false;
    this.lastGameState = null;
    this.hasShownCountdown = false;

    this.pendingGamepadAction = null;

    this.events.off('shutdown', this.shutdown, this);
    this.events.once('shutdown', this.shutdown, this);
    this.installSpectatorListeners();
    this.installMouseDragPan();

    // Spectator Game Master targeting
    this.spectatorTargeting = null;
    this.events.on('spectatorTargeting', (type: string) => {
      this.spectatorTargeting = type;
      this.input.setDefaultCursor('crosshair');
    });
    this.events.on('spectatorTargetingCancel', () => {
      this.spectatorTargeting = null;
      this.input.setDefaultCursor('default');
    });
    if (this.spectatorClickHandler) {
      this.input.off('pointerdown', this.spectatorClickHandler);
    }
    this.spectatorClickHandler = (pointer: Phaser.Input.Pointer) => {
      if (!this.spectatorTargeting || !this.lastGameState) return;
      // Convert screen coords to tile coords
      const cam = this.cameras.main;
      const worldX = pointer.x + cam.scrollX;
      const worldY = pointer.y + cam.scrollY;
      const tileX = Math.floor(worldX / 48);
      const tileY = Math.floor(worldY / 48);
      if (tileX < 0 || tileY < 0) return;

      // Get the SpectatorActionBar from HUDScene and execute
      const hudScene = this.scene.get('HUDScene') as any;
      if (hudScene?.spectatorActionBar) {
        hudScene.spectatorActionBar.executeAction(tileX, tileY);
      }
      this.spectatorTargeting = null;
      this.input.setDefaultCursor('default');
    };
    this.input.on('pointerdown', this.spectatorClickHandler);

    // Setup Phaser input
    if (this.input.keyboard) {
      this.addedKeys = [];
      this.cursors = {
        up: this.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: this.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        left: this.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: this.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        space: this.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        shift: this.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      };
      this.wasd = {
        up: this.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: this.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: this.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.spaceKey = this.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.detonateKey = this.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.throwKey = this.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    }

    this.gamepadManager = new GamepadManager(this);

    // Create composed renderers
    this.effectSystem = new EffectSystem(this, this.socketClient, this.localPlayerId);
    this.playerRenderer = new PlayerSpriteRenderer(this, this.localPlayerId);
    this.bombRenderer = new BombSpriteRenderer(this);
    this.explosionRenderer = new ExplosionRenderer(this);
    if (initialState?.map?.wrapping) {
      const wrapSize = {
        w: initialState.map.width * TILE_SIZE,
        h: initialState.map.height * TILE_SIZE,
      };
      this.playerRenderer.wrappingWorldSize = wrapSize;
      this.bombRenderer.wrappingWorldSize = wrapSize;
      this.explosionRenderer.wrappingWorldSize = wrapSize;
    }
    this.powerUpRenderer = new PowerUpRenderer(this);
    if (initialState?.map?.wrapping) {
      this.powerUpRenderer.wrappingWorldSize = {
        w: initialState.map.width * TILE_SIZE,
        h: initialState.map.height * TILE_SIZE,
      };
    }
    this.zoneRenderer = new ShrinkingZoneRenderer(this);
    this.hillZoneRenderer = new HillZoneRenderer(this);
    this.countdownOverlay = new CountdownOverlay(this);
    this.mapEventRenderer = new MapEventRenderer(this);
    this.emoteRenderer = new EmoteBubbleRenderer(this);

    // Listen for bomb throws to animate arc before state arrives
    this.socketClient.on('game:bombThrown', (data) => {
      this.bombRenderer.registerThrow(data.bombId, data.from, data.to);
    });

    // Listen for emotes from other players
    this.socketClient.on('game:emote', (data) => {
      if (!this.lastGameState || !this.emoteRenderer) return;
      const player = this.lastGameState.players.find((p) => p.id === data.playerId);
      if (player && player.alive) {
        const px = player.position.x * TILE_SIZE + TILE_SIZE / 2;
        const py = player.position.y * TILE_SIZE + TILE_SIZE / 2;
        this.emoteRenderer.showEmote(data.playerId, data.emoteId, px, py);
      }
    });

    // Emote keys 1-6 quick emotes + backtick for emote wheel
    this.emoteWheel = new EmoteWheel();
    this.emoteKeyHandler = (e: KeyboardEvent) => {
      if (this.localPlayerDead) return;
      if (this.lastGameState?.status !== 'playing') return;

      // Backtick toggles emote wheel
      if (e.code === 'Backquote') {
        e.preventDefault();
        if (this.emoteWheel!.isVisible()) {
          this.emoteWheel!.hide();
        } else {
          this.emoteWheel!.show((emoteId) => {
            this.socketClient.emit('game:emote', { emoteId });
          });
        }
        return;
      }

      // Digit 1-6 quick emotes (only when alive, spectator reuses when dead)
      const match = e.code.match(/^Digit([1-6])$/);
      if (match) {
        const emoteId = (parseInt(match[1]) - 1) as EmoteId;
        if (EMOTES[emoteId]) {
          this.socketClient.emit('game:emote', { emoteId });
        }
      }
    };
    window.addEventListener('keydown', this.emoteKeyHandler);

    if (initialState) {
      // Build player cosmetics map for BombSpriteRenderer
      const cosmeticsMap = new Map<number, PlayerCosmeticData>();
      for (const player of initialState.players) {
        if (player.cosmetics) {
          cosmeticsMap.set(player.id, player.cosmetics);
        }
      }
      this.bombRenderer.setPlayerCosmetics(cosmeticsMap);

      // Store a deep copy of initial tiles for delta updates
      this.storedTiles = initialState.map.tiles.map((row) => [...row]);
      const campaignTheme = this.registry.get('campaignTheme') as string | undefined;

      // Generate themed tile textures on demand (BootScene runs before theme is known)
      if (campaignTheme && campaignTheme !== 'classic') {
        generateThemedTileTextures(this, campaignTheme as CampaignWorldTheme);
        if (!this.textures.exists('vine')) {
          generateHazardTileTextures(this);
        }
      }

      this.tileMap = new TileMapRenderer(
        this,
        initialState.map.tiles,
        initialState.map.width,
        initialState.map.height,
        campaignTheme,
        initialState.map.wrapping ?? false,
      );
      this.updateState(initialState);
    }

    // Listen for state updates
    const replayMode = this.registry.get('replayMode');
    const simSpectate = this.registry.get('simulationSpectate');
    if (replayMode) {
      // Replay mode: play back recorded game data
      this.localPlayerDead = true; // Force spectator camera
      const replayData: ReplayData = this.registry.get('replayData');

      // Set up campaign enemy rendering for campaign replays
      const isCampaignReplay = !!replayData.campaign;
      if (isCampaignReplay && replayData.campaign) {
        this.campaignMode = true;
        EnemyTextureGenerator.generateForLevel(this, replayData.campaign.enemyTypes);
        this.enemyRenderer = new EnemySpriteRenderer(this);
        // Generate themed textures for replay playback
        const replayTheme = replayData.campaign.theme;
        if (replayTheme && replayTheme !== 'classic') {
          this.registry.set('campaignTheme', replayTheme);
          generateThemedTileTextures(this, replayTheme as CampaignWorldTheme);
          if (!this.textures.exists('vine')) {
            generateHazardTileTextures(this);
          }
        }
      }

      this.replayPlayer = new ReplayPlayer(replayData, {
        onFrame: (state: GameState) => this.updateState(state),
        onTickEvents: (events: ReplayTickEvents) => this.handleReplayTickEvents(events),
        onLogUpdate: (tick: number) => this.replayLogPanel?.updateTick(tick),
        onComplete: () => {
          /* pause at last frame */
        },
        onStateChange: () => {
          this.replayControls?.update();
        },
        onCampaignFrame: isCampaignReplay
          ? (data) => {
              this.enemyRenderer?.update(data.enemies);
              this.events.emit('campaignStateUpdate', {
                enemies: data.enemies,
                lives: data.lives,
                maxLives: replayData.campaign?.lives ?? data.lives,
                exitOpen: data.exitOpen,
                levelId: replayData.campaign?.levelId ?? 0,
                coopMode: replayData.campaign?.coopMode ?? false,
                gameState: {},
              });
            }
          : undefined,
      });

      const matchInfo = {
        matchId: replayData.matchId,
        gameMode: replayData.gameMode,
        playerCount: replayData.gameOver.placements.length,
      };

      this.replayControls = new ReplayControls(this.replayPlayer, matchInfo, () =>
        this.exitReplay(),
      );
      this.replayControls.mount();

      this.replayLogPanel = new ReplayLogPanel(replayData.log, (tick: number) => {
        this.replayPlayer?.seekTo(tick);
        this.replayControls?.update();
      });
      this.replayLogPanel.mount();

      // Start playback from the beginning
      this.replayPlayer.seekTo(0);
      this.replayPlayer.play();
    } else if (simSpectate) {
      // Simulation spectate mode: listen on sim:state, no input sending
      this.localPlayerDead = true; // Force spectator mode
      this.socketClient.on('sim:state', (data) => {
        this.updateState(data.state);
      });

      // Handle game-to-game transitions within a batch
      this.socketClient.on('sim:gameTransition', (data) => {
        // Wait for the next game's initial state, then restart the scene
        const nextStateHandler = (stateData: { batchId: string; state: GameState }) => {
          if (stateData.batchId !== data.batchId) return;
          this.socketClient.off('sim:state', nextStateHandler);

          // Restart scene with new initial state
          this.registry.set('initialGameState', stateData.state);
          this.registry.set('simulationSpectate', { batchId: data.batchId });
          this.scene.restart();
        };
        // Temporarily swap to the transition handler
        this.socketClient.off('sim:state');
        this.socketClient.on('sim:state', nextStateHandler);
      });

      // When the batch completes, return to lobby
      this.socketClient.on('sim:completed', () => {
        this.socketClient.off('sim:state');
        this.socketClient.off('sim:gameTransition');
        this.socketClient.off('sim:completed');
        this.socketClient.emit('sim:unspectate', { batchId: simSpectate.batchId });
        this.registry.remove('simulationSpectate');
        this.scene.stop('HUDScene');
        this.scene.start('LobbyScene');
      });
    } else if (this.registry.get('campaignMode')) {
      // Campaign mode: listen on campaign-specific events
      this.campaignMode = true;
      this.campaignCoopMode = !!this.registry.get('campaignCoopMode');
      this.localCoopMode = !!this.registry.get('localCoopMode');

      this.buddyMode = !!this.registry.get('buddyMode');

      // Set up local co-op input handler
      if (this.localCoopMode) {
        const coopConfig =
          (this.registry.get('localCoopConfig') as LocalCoopConfig | undefined) ||
          DEFAULT_LOCAL_COOP_CONFIG;
        this.coopCameraMode = coopConfig.cameraMode;
        this.localCoopInput = new LocalCoopInput(this, this.gamepadManager, coopConfig);
        // Determine P2's ID from the initial state (second player in the player list)
        const initialState = this.registry.get('initialGameState') as GameState | undefined;
        if (initialState && initialState.players.length >= 2) {
          const p2 = initialState.players.find((p) => p.id !== this.localPlayerId);
          if (p2) this.localP2Id = p2.id;
        }

        // Set up buddy rendering (smaller sprite with glow)
        if (this.buddyMode && this.localP2Id) {
          const buddyConfig = this.registry.get('buddyConfig') as
            | { name: string; color: string; size: number }
            | undefined;
          const sizePercent = buddyConfig ? Math.round(buddyConfig.size * 100) : 60;
          const glowColor = buddyConfig
            ? parseInt(buddyConfig.color.replace('#', ''), 16)
            : 0x44aaff;
          this.playerRenderer.setBuddyPlayer(this.localP2Id, sizePercent, glowColor);
        }
      }

      // Generate enemy textures from loaded enemy types
      const campaignEnemyTypes = this.registry.get('campaignEnemyTypes');
      if (campaignEnemyTypes) {
        EnemyTextureGenerator.generateForLevel(this, campaignEnemyTypes);
      }
      this.enemyRenderer = new EnemySpriteRenderer(this);

      this.campaignStateHandler = (state: CampaignGameState) => {
        this.lastCampaignState = state;
        this.updateState(state.gameState);
        this.enemyRenderer?.update(state.enemies);
        // Emit campaign state as Phaser event so HUDScene can listen without
        // needing its own socket listener (avoids shared-listener cleanup bugs)
        this.events.emit('campaignStateUpdate', state);
      };
      this.socketClient.on('campaign:state', this.campaignStateHandler);

      this.socketClient.on('campaign:levelComplete', (data) => {
        this.registry.set('gameOverData', {
          campaignResult: true,
          success: true,
          levelId: data.levelId,
          timeSeconds: data.timeSeconds,
          stars: data.stars,
          nextLevelId: data.nextLevelId,
        });
        this.scene.stop('HUDScene');
        this.scene.start('GameOverScene');
      });

      this.socketClient.on('campaign:gameOver', (data) => {
        this.registry.set('gameOverData', {
          campaignResult: true,
          success: false,
          levelId: data.levelId,
          reason: data.reason,
        });
        this.scene.stop('HUDScene');
        this.scene.start('GameOverScene');
      });

      // Co-op specific listeners
      if (this.campaignCoopMode) {
        this.socketClient.on('campaign:playerLockedIn', (data) => {
          // Visual indicator: pulse the locked player's sprite
          const sprite = this.playerRenderer?.getSprite(data.playerId);
          if (sprite) {
            sprite.setTint(0x00ff88);
            this.tweens.add({
              targets: sprite,
              alpha: { from: 1, to: 0.7 },
              duration: 600,
              yoyo: true,
              repeat: -1,
            });
          }
        });

        this.socketClient.on('campaign:partnerLeft', (data) => {
          const notifications = this.registry.get('notifications');
          if (notifications) {
            const reason =
              data.reason === 'disconnected'
                ? t('ui:coop.partnerDisconnected')
                : t('ui:coop.partnerLeft');
            notifications.info(reason);
          }
        });
      }

      // Escape key to toggle pause menu
      this.pauseKeyHandler = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
          e.preventDefault();
          if (this.paused) {
            this.resumeCampaign();
          } else {
            this.pauseCampaign();
          }
        }
      };
      window.addEventListener('keydown', this.pauseKeyHandler);
    } else if (this.openWorldMode) {
      // Open world uses its own state event
      this.socketClient.on('openworld:state', (state) => {
        this.updateState(state);
      });

      // Handle round transitions
      this.openWorldRoundEndHandler = (data) => {
        // HUDScene handles the scoreboard overlay via Phaser events
        this.events.emit('openWorldRoundEnd', data);
      };
      this.socketClient.on('openworld:roundEnd', this.openWorldRoundEndHandler);

      this.openWorldRoundStartHandler = (data) => {
        // New round — update stored tiles and camera
        if (data.state.map?.tiles) {
          this.storedTiles = data.state.map.tiles.map(
            (row: import('@blast-arena/shared').TileType[]) => [...row],
          );
          this.tileMap?.updateTiles(data.state.map.tiles);
          this.applyCameraBounds(data.state.map.width, data.state.map.height);
        }
        this.updateState(data.state);
        this.events.emit('openWorldRoundStart', data);
      };
      this.socketClient.on('openworld:roundStart', this.openWorldRoundStartHandler);

      // Escape key to toggle leave menu
      this.pauseKeyHandler = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
          e.preventDefault();
          if (this.paused) {
            this.hideLeaveOverlay();
          } else {
            this.showLeaveOverlay();
          }
        }
      };
      window.addEventListener('keydown', this.pauseKeyHandler);
    } else {
      this.socketClient.on('game:state', (state) => {
        this.updateState(state);
      });

      this.socketClient.on('game:over', (data) => {
        this.registry.set('gameOverData', data);
        this.scene.stop('HUDScene');
        this.scene.start('GameOverScene');
      });

      // Escape key to toggle leave game menu (multiplayer)
      if (!this.registry.get('replayMode') && !this.registry.get('simulationSpectate')) {
        this.pauseKeyHandler = (e: KeyboardEvent) => {
          if (e.code === 'Escape') {
            e.preventDefault();
            if (this.paused) {
              this.hideLeaveOverlay();
            } else {
              this.showLeaveOverlay();
            }
          }
        };
        window.addEventListener('keydown', this.pauseKeyHandler);
      }
    }

    // Camera setup
    if (initialState) {
      this.applyCameraBounds(initialState.map.width, initialState.map.height);
      this.initSplitScreen();
    }

    // Re-apply camera bounds when viewport resizes
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setSize(gameSize.width, gameSize.height);
      if (this.lastGameState) {
        this.applyCameraBounds(this.lastGameState.map.width, this.lastGameState.map.height);
      }
      if (this.localCoopMode && this.p2Camera && this.coopCameraMode !== 'shared') {
        this.updateSplitViewports(gameSize.width, gameSize.height);
      }
    });

    this.registry.set('spectateTargetId', null);
  }

  private updateState(state: GameState): void {
    this.lastGameState = state;

    // Countdown overlay trigger — show during countdown, not after
    if (state.status === 'countdown' && !this.hasShownCountdown) {
      this.hasShownCountdown = true;
      this.countdownOverlay.show();
    }

    // Update tile map — apply diffs to stored tiles, or use full tiles for replays/initial state
    if (this.tileMap && this.storedTiles) {
      if (state.tileDiffs && state.tileDiffs.length > 0) {
        // Apply tile diffs to our stored copy
        for (const diff of state.tileDiffs) {
          this.storedTiles[diff.y][diff.x] = diff.type;
        }
        const destroyed = this.tileMap.updateTiles(this.storedTiles);
        if (destroyed.length > 0) {
          this.effectSystem.onTilesDestroyed(destroyed);
        }
      } else if (state.map.tiles && state.map.tiles.length > 0) {
        // Full tile update (initial state, replays, simulations)
        const destroyed = this.tileMap.updateTiles(state.map.tiles);
        if (destroyed.length > 0) {
          this.effectSystem.onTilesDestroyed(destroyed);
        }
        // Update stored tiles from full state
        this.storedTiles = state.map.tiles.map((row) => [...row]);
      }
    } else if (this.tileMap && state.map.tiles && state.map.tiles.length > 0) {
      // No stored tiles yet (e.g. simulation spectate joining mid-game)
      this.storedTiles = state.map.tiles.map((row) => [...row]);
      const destroyed = this.tileMap.updateTiles(state.map.tiles);
      if (destroyed.length > 0) {
        this.effectSystem.onTilesDestroyed(destroyed);
      }
    }

    this.playerRenderer.update(state.players);
    this.bombRenderer.update(state.bombs);
    this.explosionRenderer.update(state.explosions);
    this.powerUpRenderer.update(state.powerUps);

    if (state.zone) {
      this.zoneRenderer.update(state.zone, state.map.width, state.map.height);
    }

    if (state.hillZone) {
      this.hillZoneRenderer.update(state.hillZone, state.kothScores, state.pendingHillZone);
    }

    // Update map events (meteors, etc.)
    this.mapEventRenderer.update(state.mapEvents, state.tick);

    // Update effect system alive state
    const me = state.players.find((p) => p.id === this.localPlayerId);
    if (me) {
      this.effectSystem.setLocalPlayerAlive(me.alive);
    }

    // Update HUD
    this.events.emit('stateUpdate', state);
  }

  update(_time: number, delta: number): void {
    // Detect local player death / campaign respawn
    if (this.lastGameState) {
      const me = this.lastGameState.players.find((p) => p.id === this.localPlayerId);
      if (!this.localPlayerDead && me && !me.alive) {
        this.localPlayerDead = true;
        const cam = this.cameras.main;
        this.freeCamX = cam.scrollX + cam.width / 2;
        this.freeCamY = cam.scrollY + cam.height / 2;
      } else if (this.localPlayerDead && me && me.alive) {
        // Player respawned (campaign, deathmatch, open world) — exit spectator mode
        this.localPlayerDead = false;
        this.spectateTargetId = null;
        // Snap camera to respawn position (avoid slow lerp from distant free-cam)
        const cam = this.cameras.main;
        const px = me.position.x * TILE_SIZE + TILE_SIZE / 2;
        const py = me.position.y * TILE_SIZE + TILE_SIZE / 2;
        let snapX = px - cam.width / 2;
        let snapY = py - cam.height / 2;
        if (this.openWorldMode && this.lastGameState?.map?.wrapping) {
          const worldW = this.lastGameState.map.width * TILE_SIZE;
          const worldH = this.lastGameState.map.height * TILE_SIZE;
          snapX = ((snapX % worldW) + worldW) % worldW;
          snapY = ((snapY % worldH) + worldH) % worldH;
        }
        cam.scrollX = snapX;
        cam.scrollY = snapY;
      }
    }

    // Check for spectate target set by HUD click
    const pendingTarget = this.registry.get('spectateTargetId');
    if (pendingTarget !== null && pendingTarget !== undefined) {
      this.spectateTargetId = pendingTarget;
      this.registry.set('spectateTargetId', null);
    }

    // Gamepad menu buttons (pause/emote) — polled every frame, not throttled
    this.pollGamepadMenu();

    this.processInput();
    this.updateCamera();
    this.updatePartnerArrows();

    // Update emote bubble positions to follow players
    if (this.emoteRenderer && this.lastGameState) {
      this._emotePositions.clear();
      for (const p of this.lastGameState.players) {
        if (p.alive) {
          this._emotePositions.set(p.id, {
            x: p.position.x * TILE_SIZE + TILE_SIZE / 2,
            y: p.position.y * TILE_SIZE + TILE_SIZE / 2,
          });
        }
      }
      this.emoteRenderer.update(this._emotePositions);
    }

    // Drive replay playback from Phaser's frame loop
    if (this.replayPlayer) {
      const advanced = this.replayPlayer.tick(delta);
      if (advanced) {
        this.replayControls?.update();
      }
    }
  }

  private applyCameraBounds(mapW: number, mapH: number): void {
    const cam = this.cameras.main;
    const worldW = mapW * TILE_SIZE;
    const worldH = mapH * TILE_SIZE;

    // Wrapping maps: no bounds — ghost tiles handle the visual continuity
    if (this.lastGameState?.map?.wrapping || this.openWorldMode) {
      cam.removeBounds();
      cam.centerOn(worldW / 2, worldH / 2);
      return;
    }

    if (this.coopCameraMode !== 'shared' && this.p2Camera) {
      // Split-screen: use tight bounds and auto-zoom to fill each viewport
      const fitZoom = (c: Phaser.Cameras.Scene2D.Camera) => {
        const zx = c.width / worldW;
        const zy = c.height / worldH;
        return Phaser.Math.Clamp(Math.min(zx, zy), 0.5, 3.0);
      };

      this.splitBaseZoom = fitZoom(cam);
      cam.setZoom(this.splitBaseZoom);
      cam.setBounds(0, 0, worldW, worldH);
      cam.centerOn(worldW / 2, worldH / 2);

      const p2Zoom = fitZoom(this.p2Camera);
      this.p2Camera.setZoom(p2Zoom);
      this.p2Camera.setBounds(0, 0, worldW, worldH);
      this.p2Camera.centerOn(worldW / 2, worldH / 2);
      return;
    }

    // When the world is smaller than the viewport, expand bounds so the camera
    // can center the world instead of being clamped to (0,0)
    const boundsX = Math.min(0, (worldW - cam.width) / 2);
    const boundsY = Math.min(0, (worldH - cam.height) / 2);
    const boundsW = Math.max(worldW, cam.width);
    const boundsH = Math.max(worldH, cam.height);

    cam.setBounds(boundsX, boundsY, boundsW, boundsH);
    cam.centerOn(worldW / 2, worldH / 2);
  }

  private initSplitScreen(): void {
    if (!this.localCoopMode || this.coopCameraMode === 'shared' || this.splitScreenInitialized) {
      return;
    }
    this.splitScreenInitialized = true;

    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;

    if (this.coopCameraMode === 'split-h') {
      cam.setViewport(0, 0, w, Math.floor(h / 2));
      this.p2Camera = this.cameras.add(0, Math.floor(h / 2), w, Math.ceil(h / 2));
    } else {
      cam.setViewport(0, 0, Math.floor(w / 2), h);
      this.p2Camera = this.cameras.add(Math.floor(w / 2), 0, Math.ceil(w / 2), h);
    }

    // Partner off-screen indicator arrows
    this.p1PartnerArrow = this.add.graphics();
    this.p1PartnerArrow.setScrollFactor(0);
    this.p1PartnerArrow.setDepth(9998);
    this.p2Camera.ignore(this.p1PartnerArrow);

    this.p2PartnerArrow = this.add.graphics();
    this.p2PartnerArrow.setScrollFactor(0);
    this.p2PartnerArrow.setDepth(9998);
    cam.ignore(this.p2PartnerArrow);

    // Bounds + zoom are applied by applyCameraBounds() which is called right after
    this.drawSplitDivider(w, h);
  }

  private updateSplitViewports(w: number, h: number): void {
    if (!this.p2Camera) return;
    const cam = this.cameras.main;
    if (this.coopCameraMode === 'split-h') {
      cam.setViewport(0, 0, w, Math.floor(h / 2));
      this.p2Camera.setViewport(0, Math.floor(h / 2), w, Math.ceil(h / 2));
    } else if (this.coopCameraMode === 'split-v') {
      cam.setViewport(0, 0, Math.floor(w / 2), h);
      this.p2Camera.setViewport(Math.floor(w / 2), 0, Math.ceil(w / 2), h);
    }
    // Recalculate zoom for new viewport sizes
    if (this.lastGameState) {
      this.applyCameraBounds(this.lastGameState.map.width, this.lastGameState.map.height);
    }
    this.drawSplitDivider(w, h);
  }

  private drawSplitDivider(w: number, h: number): void {
    if (!this.splitDivider) {
      this.splitDivider = this.add.graphics();
      this.splitDivider.setScrollFactor(0);
      this.splitDivider.setDepth(9999);
    }
    this.splitDivider.clear();
    if (this.coopCameraMode === 'split-h') {
      const y = Math.floor(h / 2);
      // Dark outline
      this.splitDivider.lineStyle(6, 0x000000, 0.9);
      this.splitDivider.lineBetween(0, y, w, y);
      this.splitDivider.strokePath();
      // Bright inner line
      this.splitDivider.lineStyle(2, 0xffffff, 0.7);
      this.splitDivider.lineBetween(0, y, w, y);
      this.splitDivider.strokePath();
    } else {
      const x = Math.floor(w / 2);
      this.splitDivider.lineStyle(6, 0x000000, 0.9);
      this.splitDivider.lineBetween(x, 0, x, h);
      this.splitDivider.strokePath();
      this.splitDivider.lineStyle(2, 0xffffff, 0.7);
      this.splitDivider.lineBetween(x, 0, x, h);
      this.splitDivider.strokePath();
    }
  }

  private updatePartnerArrows(): void {
    if (this.coopCameraMode === 'shared' || !this.p2Camera) return;

    const p1Sprite = this.playerRenderer.getSprite(this.localPlayerId);
    const p2Sprite = this.playerRenderer.getSprite(this.localP2Id);

    this.drawPartnerArrow(this.p1PartnerArrow, this.cameras.main, p1Sprite, p2Sprite);
    this.drawPartnerArrow(this.p2PartnerArrow, this.p2Camera, p2Sprite, p1Sprite);
  }

  private drawPartnerArrow(
    gfx: Phaser.GameObjects.Graphics | null,
    cam: Phaser.Cameras.Scene2D.Camera,
    localSprite: Phaser.GameObjects.Sprite | undefined,
    partnerSprite: Phaser.GameObjects.Sprite | undefined,
  ): void {
    if (!gfx) return;
    gfx.clear();
    if (!partnerSprite || !localSprite) return;

    // Convert partner world position to camera-local coords
    const localX = (partnerSprite.x - cam.scrollX) * cam.zoom;
    const localY = (partnerSprite.y - cam.scrollY) * cam.zoom;

    // Check if visible within viewport
    const pad = 20;
    if (localX >= pad && localX <= cam.width - pad && localY >= pad && localY <= cam.height - pad) {
      return;
    }

    // Direction from local player to off-screen partner (line connecting the two)
    const myX = (localSprite.x - cam.scrollX) * cam.zoom;
    const myY = (localSprite.y - cam.scrollY) * cam.zoom;
    const dx = localX - myX;
    const dy = localY - myY;
    const angle = Math.atan2(dy, dx);

    // Find edge intersection from local player along the player-to-partner line
    const edgePad = 24;
    const hw = cam.width / 2 - edgePad;
    const hh = cam.height / 2 - edgePad;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    // Ray from myX,myY in direction angle — find where it hits the viewport edge
    let tMin = Infinity;
    if (Math.abs(Math.cos(angle)) > 0.001) {
      const tRight = (cx + hw - myX) / Math.cos(angle);
      const tLeft = (cx - hw - myX) / Math.cos(angle);
      if (tRight > 0) tMin = Math.min(tMin, tRight);
      if (tLeft > 0) tMin = Math.min(tMin, tLeft);
    }
    if (Math.abs(Math.sin(angle)) > 0.001) {
      const tBottom = (cy + hh - myY) / Math.sin(angle);
      const tTop = (cy - hh - myY) / Math.sin(angle);
      if (tBottom > 0) tMin = Math.min(tMin, tBottom);
      if (tTop > 0) tMin = Math.min(tMin, tTop);
    }
    if (!isFinite(tMin)) tMin = 1;

    const rawX = myX + Math.cos(angle) * tMin;
    const rawY = myY + Math.sin(angle) * tMin;
    // Clamp to viewport bounds
    const arrowX = Math.max(edgePad, Math.min(cam.width - edgePad, rawX));
    const arrowY = Math.max(edgePad, Math.min(cam.height - edgePad, rawY));

    // Triangle pointing toward partner
    const size = 10;
    const tipX = arrowX + Math.cos(angle) * size;
    const tipY = arrowY + Math.sin(angle) * size;
    const baseAngle = Math.PI * 0.75;
    const x1 = arrowX + Math.cos(angle + baseAngle) * size;
    const y1 = arrowY + Math.sin(angle + baseAngle) * size;
    const x2 = arrowX + Math.cos(angle - baseAngle) * size;
    const y2 = arrowY + Math.sin(angle - baseAngle) * size;

    gfx.lineStyle(2, 0x000000, 0.8);
    gfx.fillStyle(0x00ccff, 0.9);
    gfx.beginPath();
    gfx.moveTo(tipX, tipY);
    gfx.lineTo(x1, y1);
    gfx.lineTo(x2, y2);
    gfx.closePath();
    gfx.fillPath();
    gfx.strokePath();
  }

  private handleReplayTickEvents(events: ReplayTickEvents): void {
    if (events.bombThrown) {
      for (const thrown of events.bombThrown) {
        this.bombRenderer.registerThrow(thrown.bombId, thrown.from, thrown.to);
      }
    }
    for (const explosion of events.explosions) {
      this.effectSystem.triggerExplosion(explosion);
    }
    for (const death of events.playerDied) {
      this.effectSystem.triggerPlayerDied(death);
    }
  }

  private exitReplay(): void {
    this.replayPlayer?.destroy();
    this.replayControls?.destroy();
    this.replayLogPanel?.destroy();
    this.replayPlayer = null;
    this.replayControls = null;
    this.replayLogPanel = null;
    this.registry.remove('replayMode');
    this.registry.remove('replayData');
    this.registry.remove('initialGameState');
    this.registry.remove('campaignMode');
    this.registry.remove('campaignTheme');
    this.scene.stop('HUDScene');
    this.scene.start('LobbyScene');
  }

  private updateCamera(): void {
    const cam = this.cameras.main;

    if (this.localPlayerDead) {
      cam.removeBounds();

      if (this.spectateTargetId !== null) {
        const targetPlayer = this.lastGameState?.players.find(
          (p) => p.id === this.spectateTargetId && p.alive,
        );
        if (targetPlayer) {
          const tx = targetPlayer.position.x * TILE_SIZE + TILE_SIZE / 2;
          const ty = targetPlayer.position.y * TILE_SIZE + TILE_SIZE / 2;
          cam.scrollX = Phaser.Math.Linear(cam.scrollX, tx - cam.width / 2, 0.06);
          cam.scrollY = Phaser.Math.Linear(cam.scrollY, ty - cam.height / 2, 0.06);
          this.freeCamX = cam.scrollX + cam.width / 2;
          this.freeCamY = cam.scrollY + cam.height / 2;
          return;
        }
        this.spectateTargetId = null;
      }

      cam.scrollX = this.freeCamX - cam.width / 2;
      cam.scrollY = this.freeCamY - cam.height / 2;
      return;
    }

    // Local co-op camera
    if (this.localCoopMode && this.localP2Id) {
      const p1Sprite = this.playerRenderer.getSprite(this.localPlayerId);
      const p2Sprite = this.playerRenderer.getSprite(this.localP2Id);

      if (this.coopCameraMode === 'shared') {
        // Shared auto-zoom: camera follows midpoint, zooms out as players separate
        if (p1Sprite && p2Sprite) {
          const midX = (p1Sprite.x + p2Sprite.x) / 2;
          const midY = (p1Sprite.y + p2Sprite.y) / 2;
          const dist = Phaser.Math.Distance.Between(p1Sprite.x, p1Sprite.y, p2Sprite.x, p2Sprite.y);
          const maxDist = Math.max(cam.width, cam.height);
          const targetZoom = Phaser.Math.Clamp(1.0 - (dist / maxDist) * 0.6, 0.5, 1.0);
          cam.zoom = Phaser.Math.Linear(cam.zoom, targetZoom, 0.05);
          cam.scrollX = Phaser.Math.Linear(cam.scrollX, midX - cam.width / (2 * cam.zoom), 0.15);
          cam.scrollY = Phaser.Math.Linear(cam.scrollY, midY - cam.height / (2 * cam.zoom), 0.15);
          return;
        }
        // One player dead — follow the alive one
        const aliveSprite = p1Sprite || p2Sprite;
        if (aliveSprite) {
          cam.zoom = Phaser.Math.Linear(cam.zoom, 1.0, 0.05);
          cam.scrollX = Phaser.Math.Linear(cam.scrollX, aliveSprite.x - cam.width / 2, 0.15);
          cam.scrollY = Phaser.Math.Linear(cam.scrollY, aliveSprite.y - cam.height / 2, 0.15);
          return;
        }
      } else if (this.lastGameState) {
        // Split-screen: follow player per-axis, but lock to world center
        // on axes where the zoomed map already fits within the viewport
        const worldW = this.lastGameState.map.width * TILE_SIZE;
        const worldH = this.lastGameState.map.height * TILE_SIZE;

        const followAxis = (
          c: Phaser.Cameras.Scene2D.Camera,
          sprite: Phaser.GameObjects.Sprite | undefined,
        ) => {
          if (!sprite) return;
          const fitsX = worldW * c.zoom <= c.width;
          const fitsY = worldH * c.zoom <= c.height;
          const targetX = fitsX
            ? (worldW - c.width / c.zoom) / 2
            : sprite.x - c.width / (2 * c.zoom);
          const targetY = fitsY
            ? (worldH - c.height / c.zoom) / 2
            : sprite.y - c.height / (2 * c.zoom);
          c.scrollX = Phaser.Math.Linear(c.scrollX, targetX, 0.15);
          c.scrollY = Phaser.Math.Linear(c.scrollY, targetY, 0.15);
        };

        followAxis(cam, p1Sprite);
        if (this.p2Camera) followAxis(this.p2Camera, p2Sprite);
        return;
      }
    }

    const sprite = this.playerRenderer.getSprite(this.localPlayerId);
    if (!sprite) return;

    const targetX = sprite.x - cam.width / 2;
    const targetY = sprite.y - cam.height / 2;

    if (this.openWorldMode && this.lastGameState?.map?.wrapping) {
      const worldW = this.lastGameState.map.width * TILE_SIZE;
      const worldH = this.lastGameState.map.height * TILE_SIZE;

      // Wrap target to canonical range, then shortest-path interpolation
      const wrappedTargetX = ((targetX % worldW) + worldW) % worldW;
      const wrappedTargetY = ((targetY % worldH) + worldH) % worldH;

      let dx = wrappedTargetX - cam.scrollX;
      let dy = wrappedTargetY - cam.scrollY;
      if (dx > worldW / 2) dx -= worldW;
      else if (dx < -worldW / 2) dx += worldW;
      if (dy > worldH / 2) dy -= worldH;
      else if (dy < -worldH / 2) dy += worldH;

      cam.scrollX += dx * 0.15;
      cam.scrollY += dy * 0.15;

      // Keep camera in canonical range
      cam.scrollX = ((cam.scrollX % worldW) + worldW) % worldW;
      cam.scrollY = ((cam.scrollY % worldH) + worldH) % worldH;
    } else {
      cam.scrollX = Phaser.Math.Linear(cam.scrollX, targetX, 0.15);
      cam.scrollY = Phaser.Math.Linear(cam.scrollY, targetY, 0.15);
    }
  }

  /** Poll gamepad Start (pause) and Y (emote wheel) — runs every frame, unthrottled */
  private pollGamepadMenu(): void {
    if (!this.gamepadManager) return;
    const menu = this.gamepadManager.pollMenu();

    // Start button = pause toggle (campaign) or leave overlay (multiplayer)
    if (menu.pause) {
      if (this.campaignMode) {
        if (this.paused) this.resumeCampaign();
        else this.pauseCampaign();
      } else if (!this.registry.get('replayMode') && !this.registry.get('simulationSpectate')) {
        if (this.paused) this.hideLeaveOverlay();
        else this.showLeaveOverlay();
      }
    }

    // Y button = emote wheel toggle (only when alive and playing)
    if (menu.emoteWheel && !this.localPlayerDead && this.lastGameState?.status === 'playing') {
      if (this.emoteWheel!.isVisible()) {
        this.emoteWheel!.hide();
      } else {
        this.emoteWheel!.show((emoteId) => {
          this.socketClient.emit('game:emote', { emoteId });
        });
      }
    }
  }

  private processInput(): void {
    if (this.localPlayerDead) {
      const panSpeed = 5;
      if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) this.freeCamY -= panSpeed;
      if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) this.freeCamY += panSpeed;
      if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) this.freeCamX -= panSpeed;
      if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) this.freeCamX += panSpeed;

      // Gamepad spectator input
      const gpSpec = this.gamepadManager.pollSpectator();
      if (gpSpec.panX !== 0 || gpSpec.panY !== 0) {
        this.freeCamX += gpSpec.panX * panSpeed;
        this.freeCamY += gpSpec.panY * panSpeed;
        this.spectateTargetId = null;
      }
      if (gpSpec.nextPlayer || gpSpec.prevPlayer) {
        this.cycleSpectateTarget(gpSpec.nextPlayer ? 1 : -1);
      }

      if (this.lastGameState) {
        const worldW = this.lastGameState.map.width * TILE_SIZE;
        const worldH = this.lastGameState.map.height * TILE_SIZE;
        this.freeCamX = Phaser.Math.Clamp(this.freeCamX, 0, worldW);
        this.freeCamY = Phaser.Math.Clamp(this.freeCamY, 0, worldH);
      }
      return;
    }

    // Don't send inputs during countdown or pause
    if (this.lastGameState?.status !== 'playing') return;
    if (this.paused) return;

    // Local co-op: route both P1 and P2 through LocalCoopInput (configurable presets)
    if (this.localCoopMode && this.localCoopInput) {
      const now = Date.now();
      if (now - this.lastInputTime < TICK_MS) return;

      const p1 = this.localCoopInput.pollP1();
      if (p1.direction || p1.action) {
        this.lastInputTime = now;
        this.lastInputSeq++;
        this.socketClient.emit('campaign:input', {
          seq: this.lastInputSeq,
          direction: p1.direction,
          action: p1.action,
          tick: this.lastGameState?.tick || 0,
        });
      }

      if (this.localP2Id) {
        const p2 = this.localCoopInput.pollP2();
        if (p2.direction || p2.action) {
          this.lastInputSeq++;
          this.socketClient.emit('campaign:input', {
            seq: this.lastInputSeq,
            direction: p2.direction,
            action: p2.action,
            tick: this.lastGameState?.tick || 0,
            playerId: this.localP2Id,
          });
        }
      }
      return;
    }

    // Poll gamepad before throttle to capture just-pressed actions
    const gpInput = this.gamepadManager.poll();
    if (gpInput.action) {
      this.pendingGamepadAction = gpInput.action;
    }

    if (!this.cursors && !this.gamepadManager.isConnected()) return;

    const now = Date.now();
    if (now - this.lastInputTime < TICK_MS) return;

    let direction: Direction | null = null;
    let action: 'bomb' | 'detonate' | 'throw' | null = null;

    // Keyboard input
    if (this.cursors) {
      if (this.cursors.up.isDown || this.wasd?.up.isDown) direction = 'up';
      else if (this.cursors.down.isDown || this.wasd?.down.isDown) direction = 'down';
      else if (this.cursors.left.isDown || this.wasd?.left.isDown) direction = 'left';
      else if (this.cursors.right.isDown || this.wasd?.right.isDown) direction = 'right';

      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) action = 'bomb';
      if (Phaser.Input.Keyboard.JustDown(this.detonateKey)) action = 'detonate';
      if (Phaser.Input.Keyboard.JustDown(this.throwKey)) action = 'throw';
    }

    // Gamepad input (fills nulls — keyboard takes priority)
    if (!direction && gpInput.direction) direction = gpInput.direction;
    if (!action && this.pendingGamepadAction) {
      action = this.pendingGamepadAction;
      this.pendingGamepadAction = null;
    }

    if (direction || action) {
      this.lastInputTime = now;
      this.lastInputSeq++;

      // Play input SFX optimistically
      if (action === 'bomb') audioManager.bombPlace();
      else if (action === 'throw') audioManager.bombThrow();

      const input = {
        seq: this.lastInputSeq,
        direction,
        action,
        tick: this.lastGameState?.tick || 0,
      };
      if (this.campaignMode) {
        this.socketClient.emit('campaign:input', input);
      } else if (this.openWorldMode) {
        this.socketClient.emit('openworld:input', input);
      } else {
        this.socketClient.emit('game:input', input);
      }
    }
  }

  private cycleSpectateTarget(delta: number): void {
    if (!this.lastGameState) return;
    const alivePlayers = this.lastGameState.players.filter(
      (p) => p.alive && p.id !== this.localPlayerId,
    );
    if (alivePlayers.length === 0) return;

    const currentIdx = alivePlayers.findIndex((p) => p.id === this.spectateTargetId);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = delta > 0 ? 0 : alivePlayers.length - 1;
    } else {
      nextIdx = (currentIdx + delta + alivePlayers.length) % alivePlayers.length;
    }
    this.spectateTargetId = alivePlayers[nextIdx].id;
  }

  private installSpectatorListeners(): void {
    this.keysDown.clear();
    const panKeys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
    ];
    this.boundKeyDown = (e: KeyboardEvent) => {
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);

      // In replay mode, arrow keys are reserved for timeline seek (ReplayControls)
      if (this.replayPlayer && isArrow) return;

      this.keysDown.add(e.code);
      if (this.localPlayerDead && isArrow) {
        e.preventDefault();
      }
      if (this.localPlayerDead && panKeys.includes(e.code)) {
        this.spectateTargetId = null;
      }
      if (this.localPlayerDead && e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', ''));
        if (num >= 1 && num <= 9 && this.lastGameState) {
          const alivePlayers = this.lastGameState.players.filter(
            (p) => p.alive && p.id !== this.localPlayerId,
          );
          if (num <= alivePlayers.length) {
            this.spectateTargetId = alivePlayers[num - 1].id;
          }
        }
      }
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    };
    this.boundBlur = () => {
      this.keysDown.clear();
    };
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);
  }

  private removeSpectatorListeners(): void {
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.boundKeyUp) {
      window.removeEventListener('keyup', this.boundKeyUp);
      this.boundKeyUp = null;
    }
    if (this.boundBlur) {
      window.removeEventListener('blur', this.boundBlur);
      this.boundBlur = null;
    }
    this.keysDown.clear();
  }

  private static readonly DRAG_THRESHOLD = 4;

  private installMouseDragPan(): void {
    this.isDragging = false;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.localPlayerDead) return;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.isDragging = false;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.localPlayerDead || !pointer.isDown) return;

      const dx = pointer.x - this.dragStartX;
      const dy = pointer.y - this.dragStartY;

      if (!this.isDragging) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < GameScene.DRAG_THRESHOLD) return;
        this.isDragging = true;
        this.spectateTargetId = null;
      }

      this.freeCamX -= pointer.x - pointer.prevPosition.x;
      this.freeCamY -= pointer.y - pointer.prevPosition.y;
    });

    this.input.on('pointerup', () => {
      if (!this.localPlayerDead) return;
      // In replay mode, a click (no drag) toggles play/pause
      if (!this.isDragging && this.replayPlayer) {
        this.replayPlayer.togglePlayPause();
        this.replayControls?.update();
      }
      this.isDragging = false;
    });
  }

  private cleanupRenderers(): void {
    this.tileMap?.destroy();
    this.playerRenderer?.destroy();
    this.bombRenderer?.destroy();
    this.explosionRenderer?.destroy();
    this.powerUpRenderer?.destroy();
    this.zoneRenderer?.destroy();
    this.hillZoneRenderer?.destroy();
    this.effectSystem?.destroy();
    this.countdownOverlay?.destroy();
    this.mapEventRenderer?.destroy();
    this.gamepadManager?.destroy();
    this.enemyRenderer?.destroy();
    this.enemyRenderer = null;
    this.emoteRenderer?.destroy();
    this.emoteRenderer = null;
    this.emoteWheel?.hide();
    this.emoteWheel = null;
  }

  private pauseCampaign(): void {
    if (this.paused || !this.campaignMode) return;
    if (this.lastGameState?.status !== 'playing') return;
    this.socketClient.emit('campaign:pause', (res) => {
      if (!res?.success) return;
      this.paused = true;
      this.showPauseOverlay();
    });
  }

  private resumeCampaign(): void {
    if (!this.paused) return;
    this.socketClient.emit('campaign:resume', (res) => {
      if (!res?.success) return;
      this.paused = false;
      this.hidePauseOverlay();
    });
  }

  private showLeaveOverlay(): void {
    if (this.paused) return;
    this.paused = true;
    this.hidePauseOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `
      <div class="pause-menu">
        <h2 class="pause-title">${t('ui:game.leaveTitle')}</h2>
        <p style="color: var(--text-muted); margin: 0; font-size: 14px;">${t('ui:game.leaveWarning')}</p>
        <button class="btn btn-primary pause-btn" id="leave-confirm" style="background: var(--danger);">${t('ui:game.leaveConfirm')}</button>
        <button class="btn btn-secondary pause-btn" id="leave-cancel">${t('ui:game.leaveCancel')}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    this.pauseOverlay = overlay;

    overlay.querySelector('#leave-confirm')!.addEventListener('click', () => {
      this.paused = false;
      this.hidePauseOverlay();
      if (this.openWorldMode) {
        this.socketClient.emit('openworld:leave');
      } else {
        this.socketClient.emit('room:leave');
      }
      this.registry.remove('currentRoom');
      this.scene.stop('HUDScene');
      this.scene.start('LobbyScene');
    });
    overlay.querySelector('#leave-cancel')!.addEventListener('click', () => {
      this.hideLeaveOverlay();
    });

    // Enable gamepad navigation for overlay buttons
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.setActive(true);
    gpNav.pushContext({
      id: 'leave-overlay',
      elements: () => [...overlay.querySelectorAll<HTMLElement>('.pause-btn')],
      onBack: () => this.hideLeaveOverlay(),
    });
  }

  private hideLeaveOverlay(): void {
    this.paused = false;
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    this.hidePauseOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `
      <div class="pause-menu">
        <h2 class="pause-title">PAUSED</h2>
        <button class="btn btn-primary pause-btn" id="pause-continue">Continue</button>
        <button class="btn btn-secondary pause-btn" id="pause-restart">Restart Level</button>
        <button class="btn btn-ghost pause-btn" id="pause-exit">Exit Level</button>
      </div>
    `;
    document.body.appendChild(overlay);
    this.pauseOverlay = overlay;

    overlay.querySelector('#pause-continue')!.addEventListener('click', () => {
      this.resumeCampaign();
    });
    overlay.querySelector('#pause-restart')!.addEventListener('click', () => {
      const levelId = this.lastCampaignState?.levelId;
      if (!levelId) return;
      this.paused = false;
      this.hidePauseOverlay();
      this.socketClient.emit('campaign:quit');
      this.restartCampaignLevel(levelId);
    });
    overlay.querySelector('#pause-exit')!.addEventListener('click', () => {
      this.paused = false;
      this.hidePauseOverlay();
      this.socketClient.emit('campaign:quit');
      this.registry.remove('campaignMode');
      this.registry.remove('campaignCoopMode');
      this.registry.remove('localCoopMode');
      this.registry.remove('localCoopConfig');
      this.registry.remove('buddyMode');
      this.registry.remove('buddyConfig');
      this.registry.remove('campaignTheme');
      this.registry.set('openCampaign', true);
      this.scene.stop('HUDScene');
      this.scene.start('LobbyScene');
    });

    // Enable gamepad navigation for overlay buttons
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.setActive(true);
    gpNav.pushContext({
      id: 'pause-overlay',
      elements: () => [...overlay.querySelectorAll<HTMLElement>('.pause-btn')],
      onBack: () => this.resumeCampaign(),
    });
  }

  private hidePauseOverlay(): void {
    if (this.pauseOverlay) {
      const gpNav = UIGamepadNavigator.getInstance();
      gpNav.popContext('pause-overlay');
      gpNav.popContext('leave-overlay');
      gpNav.setActive(false);
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
  }

  private restartCampaignLevel(levelId: number): void {
    const isCoopMode = !!this.registry.get('campaignCoopMode');
    const isLocalCoopMode = !!this.registry.get('localCoopMode');
    const isBuddyMode = !!this.registry.get('buddyMode');

    ApiClient.get<{ enemyTypes: any[] }>('/campaign/enemy-types')
      .then((enemyTypesResp) => {
        const gameStartHandler = (data: {
          state: CampaignGameState;
          level: CampaignLevelSummary;
        }) => {
          this.socketClient.off('campaign:gameStart', gameStartHandler);

          this.registry.set('campaignMode', true);
          this.registry.set('campaignCoopMode', isCoopMode || isLocalCoopMode);
          this.registry.set('localCoopMode', isLocalCoopMode);
          if (isBuddyMode) {
            this.registry.set('buddyMode', true);
          }
          this.registry.set('initialGameState', data.state.gameState);
          this.registry.set('campaignEnemyTypes', enemyTypesResp.enemyTypes || []);
          if (data.state.theme) {
            this.registry.set('campaignTheme', data.state.theme);
          }

          this.scene.start('GameScene');
          this.scene.launch('HUDScene');
        };
        this.socketClient.on('campaign:gameStart', gameStartHandler);

        const startData: {
          levelId: number;
          coopMode?: boolean;
          localCoopMode?: boolean;
          localP2?: { userId?: number; username: string; guestColor?: number };
          buddyMode?: boolean;
        } = { levelId };
        if (isBuddyMode) {
          startData.buddyMode = true;
        } else if (isCoopMode && !isLocalCoopMode) {
          startData.coopMode = true;
        } else if (isLocalCoopMode) {
          startData.localCoopMode = true;
          const p2Id = this.registry.get('localCoopP2Identity') as LocalCoopP2Identity | undefined;
          if (p2Id?.mode === 'loggedIn' && p2Id.loggedInUserId) {
            startData.localP2 = {
              userId: p2Id.loggedInUserId,
              username: p2Id.loggedInUsername || 'Player 2',
            };
          } else {
            startData.localP2 = {
              username: p2Id?.guestName || 'Player 2',
              guestColor: p2Id?.guestColor,
            };
          }
        }

        this.socketClient.emit('campaign:start', startData, (response) => {
          if (response && response.error) {
            this.socketClient.off('campaign:gameStart', gameStartHandler);
            this.registry.remove('campaignMode');
            this.registry.remove('campaignCoopMode');
            this.registry.remove('localCoopMode');
            this.registry.remove('campaignTheme');
            this.registry.set('openCampaign', true);
            this.scene.stop('HUDScene');
            this.scene.start('LobbyScene');
          }
        });
      })
      .catch(() => {
        this.registry.remove('campaignMode');
        this.registry.remove('campaignCoopMode');
        this.registry.remove('localCoopMode');
        this.registry.remove('campaignTheme');
        this.registry.set('openCampaign', true);
        this.scene.stop('HUDScene');
        this.scene.start('LobbyScene');
      });
  }

  shutdown(): void {
    this.socketClient.off('game:state');
    this.socketClient.off('game:over');
    this.socketClient.off('game:bombThrown');
    this.socketClient.off('openworld:state');
    if (this.openWorldRoundEndHandler) {
      this.socketClient.off('openworld:roundEnd', this.openWorldRoundEndHandler);
      this.openWorldRoundEndHandler = null;
    }
    if (this.openWorldRoundStartHandler) {
      this.socketClient.off('openworld:roundStart', this.openWorldRoundStartHandler);
      this.openWorldRoundStartHandler = null;
    }
    this.socketClient.off('sim:state');
    this.socketClient.off('sim:gameTransition');
    this.socketClient.off('sim:completed');
    // Remove only OUR campaign:state handler — HUDScene also listens on this event
    if (this.campaignStateHandler) {
      this.socketClient.off('campaign:state', this.campaignStateHandler);
      this.campaignStateHandler = null;
    }
    this.socketClient.off('campaign:levelComplete');
    this.socketClient.off('campaign:gameOver');
    this.socketClient.off('campaign:playerLockedIn');
    this.socketClient.off('campaign:partnerLeft');
    this.socketClient.off('game:emote');
    if (this.emoteKeyHandler) {
      window.removeEventListener('keydown', this.emoteKeyHandler);
      this.emoteKeyHandler = null;
    }
    if (this.pauseKeyHandler) {
      window.removeEventListener('keydown', this.pauseKeyHandler);
      this.pauseKeyHandler = null;
    }
    this.hidePauseOverlay();
    this.paused = false;
    this.campaignMode = false;
    this.campaignCoopMode = false;
    this.localCoopMode = false;
    this.buddyMode = false;
    this.openWorldMode = false;
    this.localCoopInput?.destroy();
    this.localCoopInput = null;
    this.localP2Id = 0;
    if (this.p2Camera) {
      this.cameras.remove(this.p2Camera);
      this.p2Camera = null;
    }
    this.splitDivider?.destroy();
    this.splitDivider = null;
    this.p1PartnerArrow?.destroy();
    this.p1PartnerArrow = null;
    this.p2PartnerArrow?.destroy();
    this.p2PartnerArrow = null;
    this.coopCameraMode = 'shared';
    this.splitBaseZoom = 1;
    this.splitScreenInitialized = false;
    this.lastCampaignState = null;
    this.replayPlayer?.destroy();
    this.replayControls?.destroy();
    this.replayLogPanel?.destroy();
    this.replayPlayer = null;
    this.replayControls = null;
    this.replayLogPanel = null;
    this.removeSpectatorListeners();
    this.removeAllTrackedKeys();

    // Clean up spectator game master targeting
    if (this.spectatorClickHandler) {
      this.input.off('pointerdown', this.spectatorClickHandler);
      this.spectatorClickHandler = null;
    }
    this.spectatorTargeting = null;
    this.events.off('spectatorTargeting');
    this.events.off('spectatorTargetingCancel');
    this.input.setDefaultCursor('default');

    this.cleanupRenderers();
  }
}
