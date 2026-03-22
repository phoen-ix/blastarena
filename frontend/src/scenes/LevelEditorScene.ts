import Phaser from 'phaser';
import { TileType, TILE_SIZE, CampaignLevel, EnemyTypeEntry } from '@blast-arena/shared';
import { EnemyTextureGenerator } from '../game/EnemyTextureGenerator';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { ApiClient } from '../network/ApiClient';

type EditorTool =
  | 'empty'
  | 'wall'
  | 'destructible'
  | 'spawn'
  | 'exit'
  | 'goal'
  | 'teleporter_a'
  | 'teleporter_b'
  | 'conveyor_up'
  | 'conveyor_down'
  | 'conveyor_left'
  | 'conveyor_right'
  | 'enemy'
  | 'powerup'
  | 'eraser';

interface PlacedEnemy {
  id: number;
  enemyTypeId: number;
  x: number;
  y: number;
  sprite?: Phaser.GameObjects.Sprite;
}

interface PlacedPowerUp {
  id: number;
  type: string;
  x: number;
  y: number;
  hidden: boolean;
  sprite?: Phaser.GameObjects.Sprite;
}

export class LevelEditorScene extends Phaser.Scene {
  private levelId: number | null = null;
  private level: CampaignLevel | null = null;
  private enemyTypes: EnemyTypeEntry[] = [];

  private mapWidth = 15;
  private mapHeight = 13;
  private tiles: TileType[][] = [];
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];
  private gridOverlay!: Phaser.GameObjects.Graphics;
  private spawnOverlay!: Phaser.GameObjects.Graphics;
  private spawnLabels: Phaser.GameObjects.Text[] = [];

  private enemies: PlacedEnemy[] = [];
  private powerups: PlacedPowerUp[] = [];
  private coveredTiles: Map<string, TileType> = new Map();
  private coveredTileSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private nextEntityId = 1;

  private currentTool: EditorTool = 'empty';
  private selectedEnemyTypeId: number = 0;
  private selectedPowerUpType: string = 'bomb_up';

  // Level settings
  private levelName = 'Untitled Level';
  private levelLives = 3;
  private levelTimeLimit = 0;
  private levelParTime = 0;
  private levelWinCondition: string = 'kill_all';
  private levelIsPublished = false;

  // History for undo/redo
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  // Map dimension inputs (for programmatic update after odd-rounding)
  private widthInput: HTMLInputElement | null = null;
  private heightInput: HTMLInputElement | null = null;

  // Keyboard pan keys
  private panKeys: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  } | null = null;

  // DOM overlay
  private editorContainer: HTMLElement | null = null;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  private static readonly TOOLBAR_WIDTH = 200;

  constructor() {
    super({ key: 'LevelEditorScene' });
  }

  create(): void {
    this.levelId = this.registry.get('editorLevelId') ?? null;
    this.enemies = [];
    this.powerups = [];
    this.coveredTiles = new Map();
    this.coveredTileSprites = new Map();
    this.tileSprites = [];
    this.nextEntityId = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.spawnLabels = [];

    this.events.once('shutdown', this.shutdown, this);

    // Load enemy types
    this.loadData().then(() => {
      this.buildGrid();
      this.buildGridOverlay();
      this.drawSpawnOverlay();
      this.setupCamera();
      this.setupInput();
      this.buildEditorUI();
      this.pushGamepadContext();
    });
  }

  private async loadData(): Promise<void> {
    const apiClient = ApiClient;

    // Load enemy types
    try {
      const resp = await apiClient.get<{ enemyTypes: EnemyTypeEntry[] }>('/campaign/enemy-types');
      this.enemyTypes = resp.enemyTypes || [];
      EnemyTextureGenerator.generateForLevel(this, this.enemyTypes);
    } catch {
      this.enemyTypes = [];
    }

    // Load level if editing existing
    if (this.levelId) {
      try {
        const resp = await apiClient.get<{ level: CampaignLevel }>(
          `/admin/campaign/levels/${this.levelId}`,
        );
        this.level = resp.level;
        if (this.level) {
          this.mapWidth = this.level.mapWidth;
          this.mapHeight = this.level.mapHeight;
          this.levelName = this.level.name;
          this.levelLives = this.level.lives;
          this.levelTimeLimit = this.level.timeLimit;
          this.levelParTime = this.level.parTime ?? 0;
          this.levelWinCondition = this.level.winCondition;
          this.levelIsPublished = this.level.isPublished;
          this.tiles = this.level.tiles.map((row) => [...row]);

          // Restore enemy placements
          for (const ep of this.level.enemyPlacements) {
            this.enemies.push({
              id: this.nextEntityId++,
              enemyTypeId: ep.enemyTypeId,
              x: ep.x,
              y: ep.y,
            });
          }

          // Restore power-up placements
          for (const pp of this.level.powerupPlacements) {
            this.powerups.push({
              id: this.nextEntityId++,
              type: pp.type,
              x: pp.x,
              y: pp.y,
              hidden: pp.hidden,
            });
          }

          // Restore covered tiles
          for (const ct of this.level.coveredTiles ?? []) {
            this.coveredTiles.set(`${ct.x},${ct.y}`, ct.type);
          }
        }
      } catch {
        this.level = null;
      }
    }

    // Initialize empty map if no level loaded
    if (this.tiles.length === 0) {
      this.initEmptyMap();
    }
  }

  private initEmptyMap(): void {
    this.tiles = [];
    for (let y = 0; y < this.mapHeight; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.mapWidth; x++) {
        if (x === 0 || y === 0 || x === this.mapWidth - 1 || y === this.mapHeight - 1) {
          this.tiles[y][x] = 'wall';
        } else if (x % 2 === 0 && y % 2 === 0) {
          this.tiles[y][x] = 'wall';
        } else {
          this.tiles[y][x] = 'empty';
        }
      }
    }
    // Place a default spawn at top-left corner (1,1)
    this.tiles[1][1] = 'spawn';
  }

  private buildGrid(): void {
    // Destroy existing
    for (const row of this.tileSprites) {
      for (const s of row) s?.destroy();
    }
    this.tileSprites = [];

    for (let y = 0; y < this.mapHeight; y++) {
      this.tileSprites[y] = [];
      for (let x = 0; x < this.mapWidth; x++) {
        const texture = this.getTileTexture(this.tiles[y][x], x, y);
        const sprite = this.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          texture,
        );
        sprite.setDepth(0);
        this.tileSprites[y][x] = sprite;
      }
    }

    // Place entity sprites
    for (const enemy of this.enemies) {
      const key = `enemy_${enemy.enemyTypeId}_down`;
      if (this.textures.exists(key)) {
        enemy.sprite = this.add.sprite(
          enemy.x * TILE_SIZE + TILE_SIZE / 2,
          enemy.y * TILE_SIZE + TILE_SIZE / 2,
          key,
        );
        enemy.sprite.setDepth(5);
      }
    }

    for (const pu of this.powerups) {
      const key = `powerup_${pu.type}`;
      if (this.textures.exists(key)) {
        pu.sprite = this.add.sprite(
          pu.x * TILE_SIZE + TILE_SIZE / 2,
          pu.y * TILE_SIZE + TILE_SIZE / 2,
          key,
        );
        pu.sprite.setDepth(6);
      }
    }

    // Rebuild covered tile overlay sprites
    for (const s of this.coveredTileSprites.values()) s.destroy();
    this.coveredTileSprites.clear();
    for (const [key, type] of this.coveredTiles) {
      const [x, y] = key.split(',').map(Number);
      this.setCoveredTile(x, y, type);
    }
  }

  private buildGridOverlay(): void {
    this.gridOverlay = this.add.graphics();
    this.gridOverlay.setDepth(1);
    this.gridOverlay.lineStyle(1, 0x444466, 0.3);
    for (let x = 0; x <= this.mapWidth; x++) {
      this.gridOverlay.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, this.mapHeight * TILE_SIZE);
    }
    for (let y = 0; y <= this.mapHeight; y++) {
      this.gridOverlay.lineBetween(0, y * TILE_SIZE, this.mapWidth * TILE_SIZE, y * TILE_SIZE);
    }
  }

  private drawSpawnOverlay(): void {
    if (!this.spawnOverlay) {
      this.spawnOverlay = this.add.graphics();
    }
    this.spawnOverlay.clear();
    this.spawnOverlay.setDepth(2);

    // Remove old spawn labels
    if (this.spawnLabels) {
      for (const label of this.spawnLabels) label.destroy();
    }
    this.spawnLabels = [];

    let spawnIndex = 0;
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (this.tiles[y]?.[x] !== 'spawn') continue;
        spawnIndex++;
        const cx = x * TILE_SIZE + TILE_SIZE / 2;
        const cy = y * TILE_SIZE + TILE_SIZE / 2;
        const r = TILE_SIZE * 0.35;

        // P2+ spawn uses a slightly different color scheme
        const isP2 = spawnIndex >= 2;
        const bgColor = isP2 ? 0x443311 : 0x115544;
        const borderColor = isP2 ? 0xffcc44 : 0x00ffcc;
        const labelColor = isP2 ? '#ffcc44' : '#00ffcc';

        // Solid filled background
        this.spawnOverlay.fillStyle(bgColor, 1);
        this.spawnOverlay.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Bright border
        this.spawnOverlay.lineStyle(3, borderColor, 1);
        this.spawnOverlay.strokeRect(
          x * TILE_SIZE + 1,
          y * TILE_SIZE + 1,
          TILE_SIZE - 2,
          TILE_SIZE - 2,
        );

        // Diamond outline
        this.spawnOverlay.lineStyle(2, borderColor, 1);
        this.spawnOverlay.beginPath();
        this.spawnOverlay.moveTo(cx, cy - r);
        this.spawnOverlay.lineTo(cx + r, cy);
        this.spawnOverlay.lineTo(cx, cy + r);
        this.spawnOverlay.lineTo(cx - r, cy);
        this.spawnOverlay.closePath();
        this.spawnOverlay.strokePath();

        // Numbered spawn label (S1, S2, etc.)
        const label = this.add
          .text(cx, cy, `S${spawnIndex}`, {
            fontSize: '14px',
            color: labelColor,
            fontFamily: 'Chakra Petch, sans-serif',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(3);
        this.spawnLabels.push(label);
      }
    }
  }

  private getTileTexture(type: TileType, x: number, y: number): string {
    switch (type) {
      case 'wall':
        return 'wall';
      case 'destructible':
        return 'destructible';
      case 'destructible_cracked':
        return 'destructible_cracked';
      case 'exit':
        return 'exit';
      case 'goal':
        return 'goal';
      case 'teleporter_a':
        return 'teleporter_a';
      case 'teleporter_b':
        return 'teleporter_b';
      case 'conveyor_up':
        return 'conveyor_up';
      case 'conveyor_down':
        return 'conveyor_down';
      case 'conveyor_left':
        return 'conveyor_left';
      case 'conveyor_right':
        return 'conveyor_right';
      case 'spawn':
        return `floor_${(x + y) % 4}`;
      default:
        return `floor_${(x + y) % 4}`;
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    const worldW = this.mapWidth * TILE_SIZE;
    const worldH = this.mapHeight * TILE_SIZE;
    cam.setBounds(-TILE_SIZE, -TILE_SIZE, worldW + TILE_SIZE * 2, worldH + TILE_SIZE * 2);

    // Restrict rendering to the area right of the toolbar
    const tw = LevelEditorScene.TOOLBAR_WIDTH;
    cam.setViewport(tw, 0, this.scale.width - tw, this.scale.height);
    cam.centerOn(worldW / 2, worldH / 2);

    // Update viewport on window resize
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      cam.setViewport(tw, 0, gameSize.width - tw, gameSize.height);
    });

    // Zoom with scroll wheel
    this.input.on(
      'wheel',
      (_pointer: any, _gameObjects: any, _dx: number, _dy: number, dz: number) => {
        const newZoom = Phaser.Math.Clamp(cam.zoom - dz * 0.001, 0.25, 3);
        cam.setZoom(newZoom);
      },
    );
  }

  private setupInput(): void {
    // Left click: place tile/entity
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
        this.isPanning = true;
        this.lastPanX = pointer.x;
        this.lastPanY = pointer.y;
        return;
      }

      // Check if clicking on UI
      if (pointer.x < LevelEditorScene.TOOLBAR_WIDTH) return; // Left panel

      // Blur any focused input so keyboard panning resumes
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      this.saveUndoState();
      this.handlePlacement(pointer);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        const cam = this.cameras.main;
        cam.scrollX -= (pointer.x - this.lastPanX) / cam.zoom;
        cam.scrollY -= (pointer.y - this.lastPanY) / cam.zoom;
        this.lastPanX = pointer.x;
        this.lastPanY = pointer.y;
        return;
      }

      // Paint mode (left button held)
      if (
        pointer.isDown &&
        pointer.leftButtonDown() &&
        pointer.x >= LevelEditorScene.TOOLBAR_WIDTH
      ) {
        this.handlePlacement(pointer);
      }
    });

    this.input.on('pointerup', () => {
      this.isPanning = false;
    });

    // Keyboard shortcuts
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-Z', (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey) {
          if (event.shiftKey) this.redo();
          else this.undo();
        }
      });
      this.input.keyboard.on('keydown-Y', (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey) this.redo();
      });

      // Pan keys (false = don't capture, so Ctrl+Z still works)
      this.panKeys = {
        up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false),
        down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false),
        left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT, false),
        right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false),
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
      };
    }
  }

  update(_time: number, delta: number): void {
    if (!this.panKeys) return;

    // Don't pan while typing in input fields
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')
    ) {
      return;
    }

    const PAN_SPEED = 400;
    const cam = this.cameras.main;
    const speed = (PAN_SPEED * delta) / (1000 * cam.zoom);

    let dx = 0;
    let dy = 0;
    if (this.panKeys.left.isDown || this.panKeys.a.isDown) dx -= speed;
    if (this.panKeys.right.isDown || this.panKeys.d.isDown) dx += speed;
    if (this.panKeys.up.isDown || this.panKeys.w.isDown) dy -= speed;
    if (this.panKeys.down.isDown || this.panKeys.s.isDown) dy += speed;

    if (dx !== 0 || dy !== 0) {
      cam.scrollX += dx;
      cam.scrollY += dy;
    }
  }

  private handlePlacement(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tx = Math.floor(worldPoint.x / TILE_SIZE);
    const ty = Math.floor(worldPoint.y / TILE_SIZE);

    if (tx < 0 || tx >= this.mapWidth || ty < 0 || ty >= this.mapHeight) return;

    const posKey = `${tx},${ty}`;
    const currentTile = this.tiles[ty][tx];

    switch (this.currentTool) {
      case 'empty': {
        // Placing empty on a wall with a covered tile: restore the covered tile
        const covered = this.coveredTiles.get(posKey);
        if (covered) {
          this.tiles[ty][tx] = covered;
          this.removeCoveredTile(tx, ty);
        } else {
          this.tiles[ty][tx] = 'empty';
        }
        this.updateTileSprite(tx, ty);
        this.syncPowerupHiddenState(tx, ty);
        break;
      }
      case 'wall':
        // Indestructible wall: remove power-ups and covered tiles (will never break)
        this.removePowerupsAt(tx, ty);
        this.removeCoveredTile(tx, ty);
        this.tiles[ty][tx] = 'wall';
        this.updateTileSprite(tx, ty);
        break;
      case 'destructible': {
        // Placing a destructible wall on a special tile: store original as covered
        if (this.isSpecialTile(currentTile)) {
          this.setCoveredTile(tx, ty, currentTile);
        }
        this.tiles[ty][tx] = 'destructible';
        this.updateTileSprite(tx, ty);
        this.syncPowerupHiddenState(tx, ty);
        break;
      }
      case 'spawn':
        this.removeCoveredTile(tx, ty);
        this.tiles[ty][tx] = 'spawn';
        this.updateTileSprite(tx, ty);
        this.syncPowerupHiddenState(tx, ty);
        break;
      case 'exit':
      case 'goal':
      case 'teleporter_a':
      case 'teleporter_b':
      case 'conveyor_up':
      case 'conveyor_down':
      case 'conveyor_left':
      case 'conveyor_right': {
        // Placing a special tile on a destructible wall: store as covered tile
        const isWall = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        if (isWall) {
          this.setCoveredTile(tx, ty, this.currentTool as TileType);
        } else {
          this.removeCoveredTile(tx, ty);
          this.tiles[ty][tx] = this.currentTool as TileType;
          this.updateTileSprite(tx, ty);
        }
        break;
      }
      case 'eraser':
        this.removeCoveredTile(tx, ty);
        this.tiles[ty][tx] = 'empty';
        this.updateTileSprite(tx, ty);
        // Remove entities at this position
        this.removeEntitiesAt(tx, ty);
        break;
      case 'enemy':
        if (this.selectedEnemyTypeId > 0) {
          // Remove existing enemy at this tile
          this.removeEnemiesAt(tx, ty);
          const enemy: PlacedEnemy = {
            id: this.nextEntityId++,
            enemyTypeId: this.selectedEnemyTypeId,
            x: tx,
            y: ty,
          };
          const key = `enemy_${enemy.enemyTypeId}_down`;
          if (this.textures.exists(key)) {
            enemy.sprite = this.add.sprite(
              tx * TILE_SIZE + TILE_SIZE / 2,
              ty * TILE_SIZE + TILE_SIZE / 2,
              key,
            );
            enemy.sprite.setDepth(5);
          }
          this.enemies.push(enemy);
        }
        break;
      case 'powerup': {
        // Remove existing powerup at this tile
        this.removePowerupsAt(tx, ty);
        const isWallTile = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        const pu: PlacedPowerUp = {
          id: this.nextEntityId++,
          type: this.selectedPowerUpType,
          x: tx,
          y: ty,
          hidden: isWallTile,
        };
        const puKey = `powerup_${pu.type}`;
        if (this.textures.exists(puKey)) {
          pu.sprite = this.add.sprite(
            tx * TILE_SIZE + TILE_SIZE / 2,
            ty * TILE_SIZE + TILE_SIZE / 2,
            puKey,
          );
          pu.sprite.setDepth(6);
        }
        this.powerups.push(pu);
        break;
      }
    }
  }

  private updateTileSprite(x: number, y: number, skipOverlay?: boolean): void {
    const texture = this.getTileTexture(this.tiles[y][x], x, y);
    this.tileSprites[y]?.[x]?.setTexture(texture);
    if (!skipOverlay) this.drawSpawnOverlay();
  }

  private removeEntitiesAt(x: number, y: number): void {
    this.removeEnemiesAt(x, y);
    this.removePowerupsAt(x, y);
  }

  private removeEnemiesAt(x: number, y: number): void {
    this.enemies = this.enemies.filter((e) => {
      if (e.x === x && e.y === y) {
        e.sprite?.destroy();
        return false;
      }
      return true;
    });
  }

  private removePowerupsAt(x: number, y: number): void {
    this.powerups = this.powerups.filter((p) => {
      if (p.x === x && p.y === y) {
        p.sprite?.destroy();
        return false;
      }
      return true;
    });
  }

  /** Check if a tile type is a "special" tile that can be covered by a destructible wall */
  private isSpecialTile(tile: TileType): boolean {
    return (
      tile !== 'empty' &&
      tile !== 'wall' &&
      tile !== 'destructible' &&
      tile !== 'destructible_cracked' &&
      tile !== 'spawn'
    );
  }

  /** Store a special tile as covered by the destructible wall at this position */
  private setCoveredTile(x: number, y: number, type: TileType): void {
    const key = `${x},${y}`;
    // Remove existing overlay sprite
    this.coveredTileSprites.get(key)?.destroy();
    this.coveredTiles.set(key, type);
    // Create overlay sprite showing the covered tile on top of the wall
    const texture = this.getTileTexture(type, x, y);
    if (this.textures.exists(texture)) {
      const sprite = this.add.sprite(
        x * TILE_SIZE + TILE_SIZE / 2,
        y * TILE_SIZE + TILE_SIZE / 2,
        texture,
      );
      sprite.setDepth(4); // Above tile (3) but below entities (5+)
      sprite.setAlpha(0.7);
      this.coveredTileSprites.set(key, sprite);
    }
  }

  /** Remove a covered tile and its overlay sprite */
  private removeCoveredTile(x: number, y: number): void {
    const key = `${x},${y}`;
    this.coveredTileSprites.get(key)?.destroy();
    this.coveredTileSprites.delete(key);
    this.coveredTiles.delete(key);
  }

  /** Sync power-up hidden state based on current tile type */
  private syncPowerupHiddenState(x: number, y: number): void {
    const tile = this.tiles[y][x];
    const isWall = tile === 'destructible' || tile === 'destructible_cracked';
    for (const pu of this.powerups) {
      if (pu.x === x && pu.y === y) {
        pu.hidden = isWall;
      }
    }
  }

  private serializeState(): string {
    return JSON.stringify({
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      tiles: this.tiles,
      enemies: this.enemies.map((e) => ({ enemyTypeId: e.enemyTypeId, x: e.x, y: e.y })),
      powerups: this.powerups.map((p) => ({ type: p.type, x: p.x, y: p.y, hidden: p.hidden })),
      coveredTiles: Array.from(this.coveredTiles.entries()).map(([k, type]) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y, type };
      }),
    });
  }

  private saveUndoState(): void {
    this.undoStack.push(this.serializeState());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.serializeState());
    const prev = JSON.parse(this.undoStack.pop()!);
    this.restoreState(prev);
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.serializeState());
    const next = JSON.parse(this.redoStack.pop()!);
    this.restoreState(next);
  }

  private restoreState(state: any): void {
    const dimensionsChanged =
      state.mapWidth !== this.mapWidth || state.mapHeight !== this.mapHeight;
    this.mapWidth = state.mapWidth ?? this.mapWidth;
    this.mapHeight = state.mapHeight ?? this.mapHeight;
    this.tiles = state.tiles;

    // Clear existing entity sprites
    for (const e of this.enemies) e.sprite?.destroy();
    for (const p of this.powerups) p.sprite?.destroy();
    for (const s of this.coveredTileSprites.values()) s.destroy();
    this.enemies = [];
    this.powerups = [];
    this.coveredTiles.clear();
    this.coveredTileSprites.clear();

    if (dimensionsChanged) {
      this.rebuildAfterResize();
    } else {
      for (let y = 0; y < this.mapHeight; y++) {
        for (let x = 0; x < this.mapWidth; x++) {
          this.updateTileSprite(x, y, true);
        }
      }
      this.drawSpawnOverlay();
    }

    // Restore entities
    for (const e of state.enemies) {
      const enemy: PlacedEnemy = { id: this.nextEntityId++, ...e };
      const key = `enemy_${enemy.enemyTypeId}_down`;
      if (this.textures.exists(key)) {
        enemy.sprite = this.add.sprite(
          enemy.x * TILE_SIZE + TILE_SIZE / 2,
          enemy.y * TILE_SIZE + TILE_SIZE / 2,
          key,
        );
        enemy.sprite.setDepth(5);
      }
      this.enemies.push(enemy);
    }
    for (const p of state.powerups) {
      const pu: PlacedPowerUp = { id: this.nextEntityId++, ...p };
      const puKey = `powerup_${pu.type}`;
      if (this.textures.exists(puKey)) {
        pu.sprite = this.add.sprite(
          pu.x * TILE_SIZE + TILE_SIZE / 2,
          pu.y * TILE_SIZE + TILE_SIZE / 2,
          puKey,
        );
        pu.sprite.setDepth(6);
      }
      this.powerups.push(pu);
    }

    // Restore covered tiles
    for (const ct of state.coveredTiles ?? []) {
      this.setCoveredTile(ct.x, ct.y, ct.type);
    }

    // Update dimension inputs if they exist
    if (this.widthInput) this.widthInput.value = String(this.mapWidth);
    if (this.heightInput) this.heightInput.value = String(this.mapHeight);
  }

  private rebuildAfterResize(): void {
    this.buildGrid();
    this.gridOverlay?.destroy();
    this.buildGridOverlay();
    this.drawSpawnOverlay();
    const cam = this.cameras.main;
    const worldW = this.mapWidth * TILE_SIZE;
    const worldH = this.mapHeight * TILE_SIZE;
    cam.setBounds(-TILE_SIZE, -TILE_SIZE, worldW + TILE_SIZE * 2, worldH + TILE_SIZE * 2);
    cam.centerOn(worldW / 2, worldH / 2);
  }

  private resizeMap(newWidth: number, newHeight: number): void {
    // Enforce odd numbers
    if (newWidth % 2 === 0) newWidth++;
    if (newHeight % 2 === 0) newHeight++;
    newWidth = Phaser.Math.Clamp(newWidth, 7, 51);
    newHeight = Phaser.Math.Clamp(newHeight, 7, 51);

    if (newWidth === this.mapWidth && newHeight === this.mapHeight) return;

    this.saveUndoState();

    const oldTiles = this.tiles;
    const oldW = this.mapWidth;
    const oldH = this.mapHeight;
    this.mapWidth = newWidth;
    this.mapHeight = newHeight;

    // Build new tile array, preserving existing content
    this.tiles = [];
    for (let y = 0; y < newHeight; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < newWidth; x++) {
        if (y < oldH && x < oldW) {
          this.tiles[y][x] = oldTiles[y][x];
        } else if (x === 0 || y === 0 || x === newWidth - 1 || y === newHeight - 1) {
          this.tiles[y][x] = 'wall';
        } else if (x % 2 === 0 && y % 2 === 0) {
          this.tiles[y][x] = 'wall';
        } else {
          this.tiles[y][x] = 'empty';
        }
      }
    }

    // Enforce perimeter walls on all edges
    for (let y = 0; y < newHeight; y++) {
      this.tiles[y][0] = 'wall';
      this.tiles[y][newWidth - 1] = 'wall';
    }
    for (let x = 0; x < newWidth; x++) {
      this.tiles[0][x] = 'wall';
      this.tiles[newHeight - 1][x] = 'wall';
    }

    // Remove out-of-bounds entities
    this.enemies = this.enemies.filter((e) => {
      if (e.x >= newWidth || e.y >= newHeight) {
        e.sprite?.destroy();
        return false;
      }
      return true;
    });
    this.powerups = this.powerups.filter((p) => {
      if (p.x >= newWidth || p.y >= newHeight) {
        p.sprite?.destroy();
        return false;
      }
      return true;
    });

    // Remove out-of-bounds covered tiles
    for (const [key] of this.coveredTiles) {
      const [x, y] = key.split(',').map(Number);
      if (x >= newWidth || y >= newHeight) {
        this.removeCoveredTile(x, y);
      }
    }

    this.rebuildAfterResize();

    // Update input values in case odd-rounding changed them
    if (this.widthInput) this.widthInput.value = String(this.mapWidth);
    if (this.heightInput) this.heightInput.value = String(this.mapHeight);
  }

  private buildEditorUI(): void {
    this.editorContainer = document.createElement('div');
    this.editorContainer.id = 'level-editor-ui';
    this.editorContainer.style.cssText =
      'position:fixed;top:0;left:0;width:200px;height:100%;background:var(--bg-base);border-right:1px solid var(--bg-hover);overflow-y:auto;z-index:200;font-family:"DM Sans",sans-serif;color:var(--text);padding:8px;box-sizing:border-box;';

    const title = document.createElement('h3');
    title.textContent = 'Level Editor';
    title.style.cssText =
      'margin:0 0 8px 0;font-family:"Chakra Petch",sans-serif;color:var(--primary);font-size:16px;';
    this.editorContainer.appendChild(title);

    // Tool sections
    this.addToolSection('Tiles', [
      { label: 'Empty', tool: 'empty' },
      { label: 'Wall', tool: 'wall' },
      { label: 'Destructible', tool: 'destructible' },
      { label: 'Spawn', tool: 'spawn' },
      { label: 'Exit', tool: 'exit' },
      { label: 'Goal', tool: 'goal' },
      { label: 'Eraser', tool: 'eraser' },
    ]);

    this.addToolSection('Hazard', [
      { label: 'Teleporter A', tool: 'teleporter_a' },
      { label: 'Teleporter B', tool: 'teleporter_b' },
      { label: 'Conveyor \u2191', tool: 'conveyor_up' },
      { label: 'Conveyor \u2193', tool: 'conveyor_down' },
      { label: 'Conveyor \u2190', tool: 'conveyor_left' },
      { label: 'Conveyor \u2192', tool: 'conveyor_right' },
    ]);

    // Enemy tools
    if (this.enemyTypes.length > 0) {
      const enemySection = document.createElement('div');
      enemySection.style.marginTop = '8px';
      const enemyLabel = document.createElement('div');
      enemyLabel.textContent = 'Enemies';
      enemyLabel.style.cssText =
        'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:4px;';
      enemySection.appendChild(enemyLabel);

      for (const et of this.enemyTypes) {
        const btn = document.createElement('button');
        btn.textContent = `${et.config.isBoss ? '👑 ' : ''}${et.name}`;
        btn.style.cssText =
          'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
        btn.addEventListener('click', () => {
          this.currentTool = 'enemy';
          this.selectedEnemyTypeId = et.id;
          this.highlightActiveTool(btn);
        });
        enemySection.appendChild(btn);
      }
      this.editorContainer.appendChild(enemySection);
    }

    // Power-up tools
    const puTypes = [
      'bomb_up',
      'fire_up',
      'speed_up',
      'shield',
      'kick',
      'pierce_bomb',
      'remote_bomb',
      'line_bomb',
    ];
    const puSection = document.createElement('div');
    puSection.style.marginTop = '8px';
    const puLabel = document.createElement('div');
    puLabel.textContent = 'Power-ups';
    puLabel.style.cssText =
      'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:4px;';
    puSection.appendChild(puLabel);
    for (const type of puTypes) {
      const btn = document.createElement('button');
      btn.textContent = type.replace(/_/g, ' ');
      btn.style.cssText =
        'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
      btn.addEventListener('click', () => {
        this.currentTool = 'powerup';
        this.selectedPowerUpType = type;
        this.highlightActiveTool(btn);
      });
      puSection.appendChild(btn);
    }
    this.editorContainer.appendChild(puSection);

    // Level settings section
    this.addSettingsSection();

    // Action buttons
    const actionSection = document.createElement('div');
    actionSection.style.cssText = 'margin-top:16px;display:flex;flex-direction:column;gap:6px;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn btn-primary';
    saveBtn.style.cssText = 'padding:6px 12px;font-size:13px;';
    saveBtn.addEventListener('click', () => this.saveLevel());
    actionSection.appendChild(saveBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export';
    exportBtn.className = 'btn btn-secondary';
    exportBtn.style.cssText = 'padding:6px 12px;font-size:13px;';
    exportBtn.addEventListener('click', () => this.exportLevel());
    actionSection.appendChild(exportBtn);

    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.className = 'btn btn-ghost';
    backBtn.style.cssText = 'padding:6px 12px;font-size:13px;';
    backBtn.addEventListener('click', () => {
      this.registry.remove('editorLevelId');
      this.scene.start('LobbyScene');
    });
    actionSection.appendChild(backBtn);

    this.editorContainer.appendChild(actionSection);
    document.getElementById('ui-overlay')?.appendChild(this.editorContainer);
  }

  private addToolSection(label: string, tools: { label: string; tool: EditorTool }[]): void {
    const section = document.createElement('div');
    section.style.marginBottom = '4px';
    const sectionLabel = document.createElement('div');
    sectionLabel.textContent = label;
    sectionLabel.style.cssText =
      'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:4px;';
    section.appendChild(sectionLabel);

    for (const t of tools) {
      const btn = document.createElement('button');
      btn.textContent = t.label;
      btn.style.cssText =
        'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
      btn.addEventListener('click', () => {
        this.currentTool = t.tool;
        this.highlightActiveTool(btn);
      });
      section.appendChild(btn);
    }
    this.editorContainer!.appendChild(section);
  }

  private addSettingsSection(): void {
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:12px;border-top:1px solid var(--bg-hover);padding-top:8px;';

    const label = document.createElement('div');
    label.textContent = 'Level Settings';
    label.style.cssText =
      'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:6px;';
    section.appendChild(label);

    const inputStyle =
      'width:100%;padding:3px 5px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);font-size:11px;border-radius:3px;box-sizing:border-box;';
    const labelStyle = 'font-size:10px;color:var(--text-dim);margin:4px 0 2px 0;';

    // Map dimensions
    const dimRow = document.createElement('div');
    dimRow.style.cssText = 'display:flex;gap:6px;';

    const wCol = document.createElement('div');
    wCol.style.cssText = 'flex:1;';
    const wLabel = document.createElement('div');
    wLabel.textContent = 'Width';
    wLabel.style.cssText = labelStyle;
    wCol.appendChild(wLabel);
    this.widthInput = document.createElement('input');
    this.widthInput.type = 'number';
    this.widthInput.min = '7';
    this.widthInput.max = '51';
    this.widthInput.step = '2';
    this.widthInput.value = String(this.mapWidth);
    this.widthInput.style.cssText = inputStyle;
    this.widthInput.addEventListener('change', () => {
      this.resizeMap(parseInt(this.widthInput!.value, 10) || this.mapWidth, this.mapHeight);
    });
    wCol.appendChild(this.widthInput);
    dimRow.appendChild(wCol);

    const hCol = document.createElement('div');
    hCol.style.cssText = 'flex:1;';
    const hLabel = document.createElement('div');
    hLabel.textContent = 'Height';
    hLabel.style.cssText = labelStyle;
    hCol.appendChild(hLabel);
    this.heightInput = document.createElement('input');
    this.heightInput.type = 'number';
    this.heightInput.min = '7';
    this.heightInput.max = '51';
    this.heightInput.step = '2';
    this.heightInput.value = String(this.mapHeight);
    this.heightInput.style.cssText = inputStyle;
    this.heightInput.addEventListener('change', () => {
      this.resizeMap(this.mapWidth, parseInt(this.heightInput!.value, 10) || this.mapHeight);
    });
    hCol.appendChild(this.heightInput);
    dimRow.appendChild(hCol);
    section.appendChild(dimRow);

    const dimHint = document.createElement('div');
    dimHint.textContent = 'Odd numbers, 7-51';
    dimHint.style.cssText = 'font-size:9px;color:var(--text-dim);margin-top:1px;margin-bottom:2px;';
    section.appendChild(dimHint);

    // Name
    const nameLabel = document.createElement('div');
    nameLabel.textContent = 'Name';
    nameLabel.style.cssText = labelStyle;
    section.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = this.levelName;
    nameInput.style.cssText = inputStyle;
    nameInput.addEventListener('change', () => {
      this.levelName = nameInput.value;
    });
    section.appendChild(nameInput);

    // Lives
    const livesLabel = document.createElement('div');
    livesLabel.textContent = 'Lives';
    livesLabel.style.cssText = labelStyle;
    section.appendChild(livesLabel);
    const livesInput = document.createElement('input');
    livesInput.type = 'number';
    livesInput.min = '1';
    livesInput.max = '99';
    livesInput.value = String(this.levelLives);
    livesInput.style.cssText = inputStyle;
    livesInput.addEventListener('change', () => {
      this.levelLives = parseInt(livesInput.value, 10) || 3;
    });
    section.appendChild(livesInput);

    // Time Limit
    const timeLabel = document.createElement('div');
    timeLabel.textContent = 'Time Limit (seconds, 0=none)';
    timeLabel.style.cssText = labelStyle;
    section.appendChild(timeLabel);
    const timeInput = document.createElement('input');
    timeInput.type = 'number';
    timeInput.min = '0';
    timeInput.max = '3600';
    timeInput.value = String(this.levelTimeLimit);
    timeInput.style.cssText = inputStyle;
    timeInput.addEventListener('change', () => {
      this.levelTimeLimit = parseInt(timeInput.value, 10) || 0;
    });
    section.appendChild(timeInput);

    // Par Time
    const parLabel = document.createElement('div');
    parLabel.textContent = 'Par Time (seconds, 0=none)';
    parLabel.style.cssText = labelStyle;
    section.appendChild(parLabel);
    const parInput = document.createElement('input');
    parInput.type = 'number';
    parInput.min = '0';
    parInput.max = '3600';
    parInput.value = String(this.levelParTime);
    parInput.style.cssText = inputStyle;
    parInput.addEventListener('change', () => {
      this.levelParTime = parseInt(parInput.value, 10) || 0;
    });
    section.appendChild(parInput);
    const parHint = document.createElement('div');
    parHint.textContent = '2 stars if completed under par time';
    parHint.style.cssText = 'font-size:9px;color:var(--text-dim);margin-top:1px;';
    section.appendChild(parHint);

    // Win Condition
    const winLabel = document.createElement('div');
    winLabel.textContent = 'Win Condition';
    winLabel.style.cssText = labelStyle;
    section.appendChild(winLabel);
    const winSelect = document.createElement('select');
    winSelect.style.cssText = inputStyle;
    const conditions = [
      { value: 'kill_all', label: 'Kill All Enemies' },
      { value: 'find_exit', label: 'Find Exit' },
      { value: 'reach_goal', label: 'Reach Goal' },
      { value: 'survive_time', label: 'Survive Time' },
    ];
    for (const c of conditions) {
      const opt = document.createElement('option');
      opt.value = c.value;
      opt.textContent = c.label;
      if (c.value === this.levelWinCondition) opt.selected = true;
      winSelect.appendChild(opt);
    }
    winSelect.addEventListener('change', () => {
      this.levelWinCondition = winSelect.value;
    });
    section.appendChild(winSelect);

    // Published toggle
    const pubRow = document.createElement('div');
    pubRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';
    const pubCheck = document.createElement('input');
    pubCheck.type = 'checkbox';
    pubCheck.checked = this.levelIsPublished;
    pubCheck.addEventListener('change', () => {
      this.levelIsPublished = pubCheck.checked;
    });
    pubRow.appendChild(pubCheck);
    const pubLabel = document.createElement('span');
    pubLabel.textContent = 'Published';
    pubLabel.style.cssText = 'font-size:11px;';
    pubRow.appendChild(pubLabel);
    section.appendChild(pubRow);

    this.editorContainer!.appendChild(section);
  }

  private highlightActiveTool(activeBtn: HTMLElement): void {
    // Reset all tool buttons
    const buttons = this.editorContainer?.querySelectorAll('button:not(.btn)');
    buttons?.forEach((btn) => {
      (btn as HTMLElement).style.background = 'var(--bg-surface)';
      (btn as HTMLElement).style.borderColor = 'var(--bg-hover)';
    });
    activeBtn.style.background = 'var(--bg-elevated)';
    activeBtn.style.borderColor = 'var(--primary)';
  }

  private async saveLevel(): Promise<void> {
    const apiClient = ApiClient;

    // Find spawn points
    const playerSpawns: { x: number; y: number }[] = [];
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (this.tiles[y][x] === 'spawn') {
          playerSpawns.push({ x, y });
        }
      }
    }

    const levelData = {
      name: this.levelName,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      tiles: this.tiles,
      playerSpawns,
      enemyPlacements: this.enemies.map((e) => ({
        enemyTypeId: e.enemyTypeId,
        x: e.x,
        y: e.y,
      })),
      powerupPlacements: this.powerups.map((p) => ({
        type: p.type,
        x: p.x,
        y: p.y,
        hidden: p.hidden,
      })),
      coveredTiles: Array.from(this.coveredTiles.entries()).map(([k, type]) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y, type };
      }),
      lives: this.levelLives,
      timeLimit: this.levelTimeLimit,
      parTime: this.levelParTime,
      winCondition: this.levelWinCondition,
      isPublished: this.levelIsPublished,
    };

    try {
      if (this.levelId) {
        await apiClient.put(`/admin/campaign/levels/${this.levelId}`, levelData);
      }
      alert('Level saved!');
    } catch (err) {
      alert('Save failed: ' + (err as Error).message);
    }
  }

  private exportLevel(): void {
    // Collect spawn points from tiles
    const playerSpawns: { x: number; y: number }[] = [];
    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        if (this.tiles[y][x] === 'spawn') {
          playerSpawns.push({ x, y });
        }
      }
    }

    const data = {
      _format: 'blast-arena-level',
      _version: 1,
      name: this.levelName,
      description: this.level?.description || '',
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      tiles: this.tiles,
      fillMode: this.level?.fillMode || 'handcrafted',
      wallDensity: this.level?.wallDensity ?? 0.3,
      playerSpawns,
      enemyPlacements: this.enemies.map((e) => ({
        enemyTypeId: e.enemyTypeId,
        x: e.x,
        y: e.y,
      })),
      powerupPlacements: this.powerups.map((p) => ({
        type: p.type,
        x: p.x,
        y: p.y,
        hidden: p.hidden,
      })),
      winCondition: this.levelWinCondition,
      winConditionConfig: this.level?.winConditionConfig ?? null,
      lives: this.levelLives,
      timeLimit: this.levelTimeLimit,
      parTime: this.levelParTime,
      carryOverPowerups: this.level?.carryOverPowerups ?? false,
      startingPowerups: this.level?.startingPowerups ?? null,
      availablePowerupTypes: this.level?.availablePowerupTypes ?? null,
      powerupDropRate: this.level?.powerupDropRate ?? 0.3,
      reinforcedWalls: this.level?.reinforcedWalls ?? false,
      hazardTiles: this.level?.hazardTiles ?? false,
      coveredTiles: Array.from(this.coveredTiles.entries()).map(([k, type]) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y, type };
      }),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `level-${this.levelName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.setActive(true);
    gpNav.pushContext({
      id: 'level-editor',
      elements: () => {
        if (!this.editorContainer) return [];
        return [...this.editorContainer.querySelectorAll<HTMLElement>('button, input, select')];
      },
      onBack: () => {
        this.registry.remove('editorLevelId');
        this.scene.start('LobbyScene');
      },
    });
  }

  shutdown(): void {
    UIGamepadNavigator.getInstance().popContext('level-editor');
    this.editorContainer?.remove();
    this.editorContainer = null;
    for (const row of this.tileSprites) {
      for (const s of row) s?.destroy();
    }
    for (const e of this.enemies) e.sprite?.destroy();
    for (const p of this.powerups) p.sprite?.destroy();
    for (const s of this.coveredTileSprites.values()) s.destroy();
    this.gridOverlay?.destroy();
    this.spawnOverlay?.destroy();
    for (const label of this.spawnLabels) label.destroy();
    this.spawnLabels = [];
  }
}
