import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { GameState, TILE_SIZE, TICK_MS } from '@blast-arena/shared';
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

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private detonateKey!: Phaser.Input.Keyboard.Key;
  private gamepadManager!: GamepadManager;
  private pendingGamepadAction: 'bomb' | 'detonate' | null = null;
  private lastInputSeq: number = 0;
  private lastInputTime: number = 0;

  // Game state
  private lastGameState: GameState | null = null;
  private localPlayerDead: boolean = false;
  private hasShownCountdown: boolean = false;

  // Spectator mode
  private freeCamX: number = 0;
  private freeCamY: number = 0;
  private spectateTargetId: number | null = null;
  private keysDown: Set<string> = new Set();
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    UIGamepadNavigator.getInstance().setActive(false);

    this.socketClient = this.registry.get('socketClient');
    this.authManager = this.registry.get('authManager');
    this.localPlayerId = this.authManager.getUser()?.id ?? 0;
    const initialState: GameState = this.registry.get('initialGameState');

    // Clean up stale state from previous game
    this.socketClient.off('game:state' as any);
    this.socketClient.off('game:over' as any);
    this.removeSpectatorListeners();
    this.cleanupRenderers();

    // Reset state
    this.localPlayerDead = false;
    this.freeCamX = 0;
    this.freeCamY = 0;
    this.spectateTargetId = null;
    this.lastGameState = null;
    this.hasShownCountdown = false;

    this.pendingGamepadAction = null;

    this.events.once('shutdown', this.shutdown, this);
    this.installSpectatorListeners();

    // Setup Phaser input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.detonateKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    }

    this.gamepadManager = new GamepadManager(this);

    // Create composed renderers
    this.effectSystem = new EffectSystem(this, this.socketClient, this.localPlayerId);
    this.playerRenderer = new PlayerSpriteRenderer(this, this.localPlayerId);
    this.bombRenderer = new BombSpriteRenderer(this);
    this.explosionRenderer = new ExplosionRenderer(this);
    this.powerUpRenderer = new PowerUpRenderer(this);
    this.zoneRenderer = new ShrinkingZoneRenderer(this);
    this.hillZoneRenderer = new HillZoneRenderer(this);
    this.countdownOverlay = new CountdownOverlay(this);

    if (initialState) {
      this.tileMap = new TileMapRenderer(
        this,
        initialState.map.tiles,
        initialState.map.width,
        initialState.map.height,
      );
      this.updateState(initialState);
    }

    // Listen for state updates
    this.socketClient.on('game:state', ((state: GameState) => {
      this.updateState(state);
    }) as any);

    this.socketClient.on('game:over', ((data: any) => {
      this.registry.set('gameOverData', data);
      this.scene.stop('HUDScene');
      this.scene.start('GameOverScene');
    }) as any);

    // Camera setup
    if (initialState) {
      this.applyCameraBounds(initialState.map.width, initialState.map.height);
    }

    // Re-apply camera bounds when viewport resizes
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setSize(gameSize.width, gameSize.height);
      if (this.lastGameState) {
        this.applyCameraBounds(this.lastGameState.map.width, this.lastGameState.map.height);
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

    // Update renderers
    if (this.tileMap && state.map.tiles) {
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
      this.hillZoneRenderer.update(state.hillZone, state.kothScores);
    }

    // Update effect system alive state
    const me = state.players.find((p) => p.id === this.localPlayerId);
    if (me) {
      this.effectSystem.setLocalPlayerAlive(me.alive);
    }

    // Update HUD
    this.events.emit('stateUpdate', state);
  }

  update(): void {
    // Detect local player death
    if (!this.localPlayerDead && this.lastGameState) {
      const me = this.lastGameState.players.find((p) => p.id === this.localPlayerId);
      if (me && !me.alive) {
        this.localPlayerDead = true;
        const cam = this.cameras.main;
        this.freeCamX = cam.scrollX + cam.width / 2;
        this.freeCamY = cam.scrollY + cam.height / 2;
      }
    }

    // Check for spectate target set by HUD click
    const pendingTarget = this.registry.get('spectateTargetId');
    if (pendingTarget !== null && pendingTarget !== undefined) {
      this.spectateTargetId = pendingTarget;
      this.registry.set('spectateTargetId', null);
    }

    this.processInput();
    this.updateCamera();
  }

  private applyCameraBounds(mapW: number, mapH: number): void {
    const cam = this.cameras.main;
    const worldW = mapW * TILE_SIZE;
    const worldH = mapH * TILE_SIZE;

    // When the world is smaller than the viewport, expand bounds so the camera
    // can center the world instead of being clamped to (0,0)
    const boundsX = Math.min(0, (worldW - cam.width) / 2);
    const boundsY = Math.min(0, (worldH - cam.height) / 2);
    const boundsW = Math.max(worldW, cam.width);
    const boundsH = Math.max(worldH, cam.height);

    cam.setBounds(boundsX, boundsY, boundsW, boundsH);
    cam.centerOn(worldW / 2, worldH / 2);
  }

  private updateCamera(): void {
    const cam = this.cameras.main;

    if (this.localPlayerDead) {
      (cam as any).useBounds = false;

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

    const sprite = this.playerRenderer.getSprite(this.localPlayerId);
    if (!sprite) return;
    cam.scrollX = Phaser.Math.Linear(cam.scrollX, sprite.x - cam.width / 2, 0.15);
    cam.scrollY = Phaser.Math.Linear(cam.scrollY, sprite.y - cam.height / 2, 0.15);
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

    // Don't send inputs during countdown
    if (this.lastGameState?.status !== 'playing') return;

    // Poll gamepad before throttle to capture just-pressed actions
    const gpInput = this.gamepadManager.poll();
    if (gpInput.action) {
      this.pendingGamepadAction = gpInput.action;
    }

    if (!this.cursors && !this.gamepadManager.isConnected()) return;

    const now = Date.now();
    if (now - this.lastInputTime < TICK_MS) return;

    let direction: string | null = null;
    let action: string | null = null;

    // Keyboard input
    if (this.cursors) {
      if (this.cursors.up.isDown || this.wasd?.up.isDown) direction = 'up';
      else if (this.cursors.down.isDown || this.wasd?.down.isDown) direction = 'down';
      else if (this.cursors.left.isDown || this.wasd?.left.isDown) direction = 'left';
      else if (this.cursors.right.isDown || this.wasd?.right.isDown) direction = 'right';

      if (this.spaceKey?.isDown) action = 'bomb';
      if (this.detonateKey?.isDown) action = 'detonate';
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
      this.socketClient.emit('game:input', {
        seq: this.lastInputSeq,
        direction: direction as any,
        action: action as any,
        tick: this.lastGameState?.tick || 0,
      });
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
      this.keysDown.add(e.code);
      if (
        this.localPlayerDead &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      ) {
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
    this.gamepadManager?.destroy();
  }

  shutdown(): void {
    this.socketClient.off('game:state' as any);
    this.socketClient.off('game:over' as any);
    this.removeSpectatorListeners();
    this.cleanupRenderers();
  }
}
