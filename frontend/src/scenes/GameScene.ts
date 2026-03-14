import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { GameState, PlayerState, BombState, ExplosionState, PowerUpState, TileType } from '@blast-arena/shared';
import { TILE_SIZE, TICK_MS } from '@blast-arena/shared';

export class GameScene extends Phaser.Scene {
  private socketClient!: SocketClient;
  private authManager!: AuthManager;
  private localPlayerId!: number;
  private tileMap!: Phaser.GameObjects.Group;
  private playerSprites: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private playerLabels: Map<number, Phaser.GameObjects.Text> = new Map();
  private bombSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private explosionSprites: Map<string, Phaser.GameObjects.Sprite[]> = new Map();
  private powerUpSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private lastInputSeq: number = 0;
  private lastGameState: GameState | null = null;
  private lastInputTime: number = 0;
  private localPlayerDead: boolean = false;
  private freeCamX: number = 0;
  private freeCamY: number = 0;
  // DOM-level key tracking for spectator mode (bypasses Phaser input entirely)
  private keysDown: Set<string> = new Set();
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundKeyUp: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.socketClient = this.registry.get('socketClient');
    this.authManager = this.registry.get('authManager');
    this.localPlayerId = this.authManager.getUser()?.id ?? 0;
    const initialState: GameState = this.registry.get('initialGameState');

    // Reset state for scene restarts
    this.localPlayerDead = false;
    this.freeCamX = 0;
    this.freeCamY = 0;
    this.removeSpectatorListeners();

    // Always install DOM key listeners from the start (for spectator mode later)
    this.installSpectatorListeners();

    console.log('[GameScene] create() called, localPlayerId:', this.localPlayerId, 'initialState:', initialState ? `${initialState.players.length} players, map ${initialState.map.width}x${initialState.map.height}` : 'NULL');

    // Setup Phaser input (for alive gameplay)
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }

    // Setup tile map
    this.tileMap = this.add.group();
    if (initialState) {
      this.renderMap(initialState.map.tiles, initialState.map.width, initialState.map.height);
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

    // Camera setup: bounds to full map, follow local player
    if (initialState) {
      const worldW = initialState.map.width * TILE_SIZE;
      const worldH = initialState.map.height * TILE_SIZE;
      this.cameras.main.setBounds(0, 0, worldW, worldH);

      // If map fits on screen, center it; otherwise camera will follow player in update()
      const cam = this.cameras.main;
      if (worldW <= cam.width && worldH <= cam.height) {
        cam.centerOn(worldW / 2, worldH / 2);
      }
    }
  }

  private installSpectatorListeners(): void {
    this.keysDown.clear();
    this.boundKeyDown = (e: KeyboardEvent) => {
      this.keysDown.add(e.code);
      // Prevent browser scrolling when spectating
      if (this.localPlayerDead && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    };
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
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
    this.keysDown.clear();
  }

  update(): void {
    // Detect local player death from latest game state (every frame, very robust)
    if (!this.localPlayerDead && this.lastGameState) {
      const me = this.lastGameState.players.find(p => p.id === this.localPlayerId);
      if (me && !me.alive) {
        this.localPlayerDead = true;
        // Start spectator cam from current camera center (no jump)
        const cam = this.cameras.main;
        this.freeCamX = cam.scrollX + cam.width / 2;
        this.freeCamY = cam.scrollY + cam.height / 2;
      }
    }

    this.processInput();
    this.updateCamera();
  }

  private updateCamera(): void {
    const cam = this.cameras.main;

    if (this.localPlayerDead) {
      // Force-disable camera bounds every frame to prevent Phaser from clamping scroll
      (cam as any).useBounds = false;
      cam.scrollX = this.freeCamX - cam.width / 2;
      cam.scrollY = this.freeCamY - cam.height / 2;
      return;
    }

    const sprite = this.playerSprites.get(this.localPlayerId);
    if (!sprite) return;

    // Smooth lerp toward player position
    cam.scrollX = Phaser.Math.Linear(cam.scrollX, sprite.x - cam.width / 2, 0.15);
    cam.scrollY = Phaser.Math.Linear(cam.scrollY, sprite.y - cam.height / 2, 0.15);
  }

  private processInput(): void {
    // When dead, use DOM key tracking to pan the spectator camera
    if (this.localPlayerDead) {
      const panSpeed = 5;
      if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) this.freeCamY -= panSpeed;
      if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) this.freeCamY += panSpeed;
      if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) this.freeCamX -= panSpeed;
      if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) this.freeCamX += panSpeed;
      // Clamp to map area
      if (this.lastGameState) {
        const worldW = this.lastGameState.map.width * TILE_SIZE;
        const worldH = this.lastGameState.map.height * TILE_SIZE;
        this.freeCamX = Phaser.Math.Clamp(this.freeCamX, 0, worldW);
        this.freeCamY = Phaser.Math.Clamp(this.freeCamY, 0, worldH);
      }
      return;
    }

    if (!this.cursors) return;

    // Rate-limit input to match server tick rate (no point sending faster)
    const now = Date.now();
    if (now - this.lastInputTime < TICK_MS) return;

    let direction: string | null = null;
    let action: string | null = null;

    if (this.cursors.up.isDown || this.wasd?.up.isDown) direction = 'up';
    else if (this.cursors.down.isDown || this.wasd?.down.isDown) direction = 'down';
    else if (this.cursors.left.isDown || this.wasd?.left.isDown) direction = 'left';
    else if (this.cursors.right.isDown || this.wasd?.right.isDown) direction = 'right';

    if (this.spaceKey?.isDown) action = 'bomb';

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

  private renderMap(tiles: TileType[][], width: number, height: number): void {
    this.tileSprites = [];
    for (let y = 0; y < height; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < width; x++) {
        const tile = tiles[y][x];
        const textureKey = this.getTileTexture(tile);
        const sprite = this.add.sprite(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, textureKey);
        this.tileSprites[y][x] = sprite;
        this.tileMap.add(sprite);
      }
    }
  }

  private getTileTexture(type: TileType): string {
    switch (type) {
      case 'wall': return 'wall';
      case 'destructible': return 'destructible';
      default: return 'floor';
    }
  }

  private updateState(state: GameState): void {
    this.lastGameState = state;

    // Update tiles (destructible walls may have been destroyed)
    if (state.map.tiles) {
      for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
          if (this.tileSprites[y]?.[x]) {
            const newTexture = this.getTileTexture(state.map.tiles[y][x]);
            if (this.tileSprites[y][x].texture.key !== newTexture) {
              this.tileSprites[y][x].setTexture(newTexture);
            }
          }
        }
      }
    }

    // Update players
    this.updatePlayers(state.players);

    // Update bombs
    this.updateBombs(state.bombs);

    // Update explosions
    this.updateExplosions(state.explosions);

    // Update power-ups
    this.updatePowerUps(state.powerUps);

    // Update HUD
    this.events.emit('stateUpdate', state);
  }

  private updatePlayers(players: PlayerState[]): void {
    const activeIds = new Set(players.map(p => p.id));

    // Remove despawned players
    for (const [id, sprite] of this.playerSprites) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.playerSprites.delete(id);
        const label = this.playerLabels.get(id);
        if (label) {
          label.destroy();
          this.playerLabels.delete(id);
        }
      }
    }

    // Update/create players
    players.forEach((player, index) => {
      const targetX = player.position.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = player.position.y * TILE_SIZE + TILE_SIZE / 2;

      if (!player.alive) {
        // Play death effect then remove sprite
        const existing = this.playerSprites.get(player.id);
        if (existing) {
          this.playerSprites.delete(player.id);
          existing.setTint(0xff0000);
          this.tweens.add({
            targets: existing,
            alpha: 0,
            scaleX: 0.2,
            scaleY: 0.2,
            duration: 500,
            ease: 'Power2',
            onComplete: () => existing.destroy(),
          });
        }
        const existingLabel = this.playerLabels.get(player.id);
        if (existingLabel) {
          this.playerLabels.delete(player.id);
          this.tweens.add({
            targets: existingLabel,
            alpha: 0,
            y: existingLabel.y - 20,
            duration: 500,
            ease: 'Power2',
            onComplete: () => existingLabel.destroy(),
          });
        }
        return;
      }

      let sprite = this.playerSprites.get(player.id);
      if (!sprite) {
        const colors = [0xe94560, 0x44aaff, 0x44ff44, 0xff8800, 0xcc44ff, 0xffff44, 0xff44ff, 0x44ffff];
        const textureKey = `player_${index % 8}`;
        if (this.textures.exists(textureKey)) {
          sprite = this.add.sprite(targetX, targetY, textureKey);
        } else {
          // Generate a texture for this player color so sprite moves properly
          const genKey = `player_gen_${index % 8}`;
          if (!this.textures.exists(genKey)) {
            const gfx = this.add.graphics();
            gfx.fillStyle(colors[index % 8], 1);
            gfx.fillRoundedRect(0, 0, TILE_SIZE - 4, TILE_SIZE - 4, 4);
            gfx.generateTexture(genKey, TILE_SIZE - 4, TILE_SIZE - 4);
            gfx.destroy();
          }
          sprite = this.add.sprite(targetX, targetY, genKey);
        }
        sprite.setDepth(10);
        sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);
        this.playerSprites.set(player.id, sprite);
        console.log(`[GameScene] Created player sprite for ${player.displayName} (id=${player.id}) at tile (${player.position.x}, ${player.position.y})`);

        // Add name label
        const label = this.add.text(targetX, targetY - TILE_SIZE / 2 - 2, player.displayName, {
          fontSize: '11px',
          color: '#fff',
          stroke: '#000',
          strokeThickness: 2,
        }).setOrigin(0.5, 1).setDepth(11);
        this.playerLabels.set(player.id, label);
      }

      // Interpolate position
      sprite.x = Phaser.Math.Linear(sprite.x, targetX, 0.3);
      sprite.y = Phaser.Math.Linear(sprite.y, targetY, 0.3);

      // Update label position to follow sprite
      const label = this.playerLabels.get(player.id);
      if (label) {
        label.x = sprite.x;
        label.y = sprite.y - TILE_SIZE / 2 - 2;
      }
    });
  }

  private updateBombs(bombs: BombState[]): void {
    const activeIds = new Set(bombs.map(b => b.id));

    for (const [id, sprite] of this.bombSprites) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.bombSprites.delete(id);
      }
    }

    for (const bomb of bombs) {
      if (!this.bombSprites.has(bomb.id)) {
        const sprite = this.add.sprite(
          bomb.position.x * TILE_SIZE + TILE_SIZE / 2,
          bomb.position.y * TILE_SIZE + TILE_SIZE / 2,
          'bomb'
        );
        sprite.setDepth(5);

        // Pulsing animation
        this.tweens.add({
          targets: sprite,
          scaleX: 1.15,
          scaleY: 1.15,
          duration: 300,
          yoyo: true,
          repeat: -1,
        });

        this.bombSprites.set(bomb.id, sprite);
      }
    }
  }

  private updateExplosions(explosions: ExplosionState[]): void {
    const activeIds = new Set(explosions.map(e => e.id));

    for (const [id, sprites] of this.explosionSprites) {
      if (!activeIds.has(id)) {
        sprites.forEach(s => s.destroy());
        this.explosionSprites.delete(id);
      }
    }

    for (const explosion of explosions) {
      if (!this.explosionSprites.has(explosion.id)) {
        const sprites = explosion.cells.map((cell: { x: number; y: number }) => {
          const sprite = this.add.sprite(
            cell.x * TILE_SIZE + TILE_SIZE / 2,
            cell.y * TILE_SIZE + TILE_SIZE / 2,
            'explosion'
          );
          sprite.setDepth(8);
          sprite.setAlpha(0.9);
          return sprite;
        });
        this.explosionSprites.set(explosion.id, sprites);
      }
    }
  }

  private updatePowerUps(powerUps: PowerUpState[]): void {
    const activeIds = new Set(powerUps.map(p => p.id));

    for (const [id, sprite] of this.powerUpSprites) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.powerUpSprites.delete(id);
      }
    }

    for (const powerUp of powerUps) {
      if (!this.powerUpSprites.has(powerUp.id)) {
        const sprite = this.add.sprite(
          powerUp.position.x * TILE_SIZE + TILE_SIZE / 2,
          powerUp.position.y * TILE_SIZE + TILE_SIZE / 2,
          `powerup_${powerUp.type}`
        );
        sprite.setDepth(3);

        // Floating animation
        this.tweens.add({
          targets: sprite,
          y: sprite.y - 4,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });

        this.powerUpSprites.set(powerUp.id, sprite);
      }
    }
  }

  shutdown(): void {
    // Clean up socket listeners to prevent leaks
    this.socketClient.off('game:state' as any);
    this.socketClient.off('game:over' as any);

    // Clean up DOM key listeners
    this.removeSpectatorListeners();

    this.playerSprites.forEach(s => s.destroy());
    this.playerLabels.forEach(s => s.destroy());
    this.bombSprites.forEach(s => s.destroy());
    this.explosionSprites.forEach(sprites => sprites.forEach(s => s.destroy()));
    this.powerUpSprites.forEach(s => s.destroy());
    this.playerSprites.clear();
    this.playerLabels.clear();
    this.bombSprites.clear();
    this.explosionSprites.clear();
    this.powerUpSprites.clear();
  }
}
