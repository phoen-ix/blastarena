import Phaser from 'phaser';
import {
  TileType,
  TILE_SIZE,
  CampaignLevel,
  EnemyTypeEntry,
  PuzzleColor,
  SwitchVariant,
  PUZZLE_COLORS,
  PUZZLE_COLOR_VALUES,
  isSwitchTile,
  isGateTile,
  getSwitchColor,
  getGateColor,
  CampaignWorldTheme,
  HAZARD_TILES_BY_THEME,
  HAZARD_TILE_NAMES,
} from '@blast-arena/shared';
import { EnemyTextureGenerator } from '../game/EnemyTextureGenerator';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { ApiClient } from '../network/ApiClient';
import { generateThemedTileTextures, generateHazardTileTextures } from '../utils/campaignThemes';

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
  | 'puzzle_switch'
  | 'puzzle_gate'
  | 'crumbling'
  | 'vine'
  | 'quicksand'
  | 'ice'
  | 'lava'
  | 'mud'
  | 'spikes'
  | 'dark_rift'
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

  // Puzzle tools
  private puzzleColor: PuzzleColor = 'red';
  private switchVariant: SwitchVariant = 'toggle';
  private puzzleSwitchVariants: Map<string, SwitchVariant> = new Map();
  private puzzleLinkGraphics: Phaser.GameObjects.Graphics | null = null;
  private worldTheme: CampaignWorldTheme = 'classic';

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

  // Dirty state tracking
  private isDirty = false;
  private savedState: string = '';
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

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
    this.puzzleSwitchVariants = new Map();
    this.puzzleLinkGraphics = null;
    this.worldTheme = 'classic';

    this.events.once('shutdown', this.shutdown, this);

    this.isDirty = false;

    // Load enemy types
    this.loadData().then(() => {
      this.buildGrid();
      this.buildGridOverlay();
      this.drawSpawnOverlay();
      this.setupCamera();
      this.setupInput();
      this.buildEditorUI();
      this.savedState = this.serializeState();
      this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
        if (this.isDirty) {
          e.preventDefault();
        }
      };
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
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

          // Restore puzzle config
          if (this.level.puzzleConfig?.switchVariants) {
            for (const [key, variant] of Object.entries(this.level.puzzleConfig.switchVariants)) {
              this.puzzleSwitchVariants.set(key, variant);
            }
          }
        }
      } catch {
        this.level = null;
      }
    }

    // Read world theme from registry (set by CampaignTab when launching editor)
    const registryTheme = this.registry.get('editorWorldTheme') as string | undefined;
    if (registryTheme && registryTheme !== 'classic') {
      this.worldTheme = registryTheme as CampaignWorldTheme;
    }

    // Generate themed textures for the editor
    if (this.worldTheme !== 'classic') {
      generateThemedTileTextures(this, this.worldTheme);
    }
    generateHazardTileTextures(this);

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
        if (this.isConveyorType(this.tiles[y][x])) {
          const prefix = this.worldTheme && this.worldTheme !== 'classic' ? 'themed_' : '';
          const animKey = `${prefix}${this.tiles[y][x]}_anim`;
          if (this.anims.exists(animKey)) sprite.play(animKey);
        }
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

    this.drawPuzzleLinks();
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

  private drawPuzzleLinks(): void {
    if (!this.puzzleLinkGraphics) {
      this.puzzleLinkGraphics = this.add.graphics();
      this.puzzleLinkGraphics.setDepth(3);
    }
    this.puzzleLinkGraphics.clear();

    // Collect switch and gate positions by color
    const switches: Record<string, { x: number; y: number }[]> = {};
    const gates: Record<string, { x: number; y: number }[]> = {};

    for (let y = 0; y < this.mapHeight; y++) {
      for (let x = 0; x < this.mapWidth; x++) {
        const tile = this.tiles[y]?.[x];
        if (!tile) continue;
        if (isSwitchTile(tile)) {
          const color = getSwitchColor(tile);
          if (color) {
            if (!switches[color]) switches[color] = [];
            switches[color].push({ x, y });
          }
        } else if (isGateTile(tile)) {
          const color = getGateColor(tile);
          if (color) {
            if (!gates[color]) gates[color] = [];
            gates[color].push({ x, y });
          }
        }
      }
    }

    // Also check covered tiles for switches/gates
    for (const [key, type] of this.coveredTiles) {
      const [x, y] = key.split(',').map(Number);
      if (isSwitchTile(type)) {
        const color = getSwitchColor(type);
        if (color) {
          if (!switches[color]) switches[color] = [];
          switches[color].push({ x, y });
        }
      } else if (isGateTile(type)) {
        const color = getGateColor(type);
        if (color) {
          if (!gates[color]) gates[color] = [];
          gates[color].push({ x, y });
        }
      }
    }

    // Draw lines from each switch to each gate of same color
    for (const color of PUZZLE_COLORS) {
      const sw = switches[color];
      const gt = gates[color];
      if (!sw || !gt) continue;

      const hexColor = PUZZLE_COLOR_VALUES[color as PuzzleColor];
      this.puzzleLinkGraphics.lineStyle(2, hexColor, 0.4);

      for (const s of sw) {
        for (const g of gt) {
          const sx = s.x * TILE_SIZE + TILE_SIZE / 2;
          const sy = s.y * TILE_SIZE + TILE_SIZE / 2;
          const gx = g.x * TILE_SIZE + TILE_SIZE / 2;
          const gy = g.y * TILE_SIZE + TILE_SIZE / 2;
          this.puzzleLinkGraphics.lineBetween(sx, sy, gx, gy);
        }
      }
    }
  }

  private getTileTexture(type: TileType, x: number, y: number): string {
    const themed = this.worldTheme && this.worldTheme !== 'classic';
    switch (type) {
      case 'wall':
        return themed ? 'themed_wall' : 'wall';
      case 'destructible':
        return themed ? 'themed_destructible' : 'destructible';
      case 'destructible_cracked':
        return themed ? 'themed_destructible_cracked' : 'destructible_cracked';
      case 'exit':
        return themed ? 'themed_exit' : 'exit';
      case 'goal':
        return themed ? 'themed_goal' : 'goal';
      case 'teleporter_a':
      case 'teleporter_b':
        return themed ? `themed_${type}` : type;
      case 'conveyor_up':
      case 'conveyor_down':
      case 'conveyor_left':
      case 'conveyor_right':
        return themed ? `themed_${type}` : type;
      case 'switch_red':
      case 'switch_blue':
      case 'switch_green':
      case 'switch_yellow':
      case 'switch_red_active':
      case 'switch_blue_active':
      case 'switch_green_active':
      case 'switch_yellow_active':
      case 'gate_red':
      case 'gate_blue':
      case 'gate_green':
      case 'gate_yellow':
      case 'gate_red_open':
      case 'gate_blue_open':
      case 'gate_green_open':
      case 'gate_yellow_open':
        return themed ? `themed_${type}` : type;
      case 'crumbling':
        return themed ? 'themed_crumbling' : 'crumbling';
      case 'pit':
        return type;
      // Hazard tiles — texture key matches tile type name
      case 'vine':
      case 'quicksand':
      case 'ice':
      case 'lava':
      case 'mud':
      case 'spikes':
      case 'spikes_active':
      case 'dark_rift':
        return type;
      case 'spawn':
        return themed ? `themed_floor_${(x + y) % 4}` : `floor_${(x + y) % 4}`;
      default:
        return themed ? `themed_floor_${(x + y) % 4}` : `floor_${(x + y) % 4}`;
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
      case 'puzzle_switch': {
        const switchTile = `switch_${this.puzzleColor}` as TileType;
        const isWallSw = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        if (isWallSw) {
          this.setCoveredTile(tx, ty, switchTile);
        } else {
          this.removeCoveredTile(tx, ty);
          this.tiles[ty][tx] = switchTile;
          this.updateTileSprite(tx, ty);
        }
        this.puzzleSwitchVariants.set(posKey, this.switchVariant);
        this.drawPuzzleLinks();
        break;
      }
      case 'puzzle_gate': {
        const gateTile = `gate_${this.puzzleColor}` as TileType;
        const isWallGt = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        if (isWallGt) {
          this.setCoveredTile(tx, ty, gateTile);
        } else {
          this.removeCoveredTile(tx, ty);
          this.tiles[ty][tx] = gateTile;
          this.updateTileSprite(tx, ty);
        }
        this.drawPuzzleLinks();
        break;
      }
      case 'crumbling': {
        const isWallCr = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        if (isWallCr) {
          this.setCoveredTile(tx, ty, 'crumbling' as TileType);
        } else {
          this.removeCoveredTile(tx, ty);
          this.tiles[ty][tx] = 'crumbling' as TileType;
          this.updateTileSprite(tx, ty);
        }
        break;
      }
      case 'vine':
      case 'quicksand':
      case 'ice':
      case 'lava':
      case 'mud':
      case 'spikes':
      case 'dark_rift': {
        const isWallHz = currentTile === 'destructible' || currentTile === 'destructible_cracked';
        if (isWallHz) {
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
        this.puzzleSwitchVariants.delete(posKey);
        this.tiles[ty][tx] = 'empty';
        this.updateTileSprite(tx, ty);
        // Remove entities at this position
        this.removeEntitiesAt(tx, ty);
        this.drawPuzzleLinks();
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
    const tileType = this.tiles[y][x];
    const texture = this.getTileTexture(tileType, x, y);
    const sprite = this.tileSprites[y]?.[x];
    if (sprite) {
      sprite.stop();
      sprite.setTexture(texture);
      if (this.isConveyorType(tileType)) {
        const prefix = this.worldTheme && this.worldTheme !== 'classic' ? 'themed_' : '';
        const animKey = `${prefix}${tileType}_anim`;
        if (this.anims.exists(animKey)) sprite.play(animKey);
      }
    }
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

  private isConveyorType(type: TileType | string): boolean {
    return (
      type === 'conveyor_up' ||
      type === 'conveyor_down' ||
      type === 'conveyor_left' ||
      type === 'conveyor_right'
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
      if (this.isConveyorType(type)) {
        const prefix = this.worldTheme && this.worldTheme !== 'classic' ? 'themed_' : '';
        const animKey = `${prefix}${type}_anim`;
        if (this.anims.exists(animKey)) sprite.play(animKey);
      }
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
      puzzleSwitchVariants: Array.from(this.puzzleSwitchVariants.entries()),
    });
  }

  private markDirty(): void {
    this.isDirty = true;
  }

  private navigateBack(): void {
    if (this.isDirty) {
      this.showUnsavedModal();
    } else {
      this.doNavigateBack();
    }
  }

  private doNavigateBack(): void {
    this.registry.remove('editorLevelId');
    this.registry.remove('editorWorldId');
    this.scene.start('LobbyScene');
  }

  private showUnsavedModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Unsaved Changes');
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h2>Unsaved Changes</h2>
        </div>
        <div class="modal-body">
          <p style="color:var(--text-dim);margin:0;">You have unsaved changes. Do you want to save before leaving?</p>
        </div>
        <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" id="unsaved-cancel">Cancel</button>
          <button class="btn btn-secondary" id="unsaved-discard">Discard</button>
          <button class="btn btn-primary" id="unsaved-save">Save &amp; Exit</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        window.removeEventListener('keydown', onKeydown);
      }
    };
    window.addEventListener('keydown', onKeydown);

    overlay.querySelector('#unsaved-cancel')!.addEventListener('click', () => {
      overlay.remove();
      window.removeEventListener('keydown', onKeydown);
    });

    overlay.querySelector('#unsaved-discard')!.addEventListener('click', () => {
      overlay.remove();
      window.removeEventListener('keydown', onKeydown);
      this.isDirty = false;
      this.doNavigateBack();
    });

    overlay.querySelector('#unsaved-save')!.addEventListener('click', async () => {
      overlay.remove();
      window.removeEventListener('keydown', onKeydown);
      await this.saveLevel();
      if (!this.isDirty) {
        this.doNavigateBack();
      }
    });
  }

  private saveUndoState(): void {
    this.undoStack.push(this.serializeState());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.markDirty();
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.serializeState());
    const prev = JSON.parse(this.undoStack.pop()!);
    this.restoreState(prev);
    this.isDirty = this.serializeState() !== this.savedState;
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.serializeState());
    const next = JSON.parse(this.redoStack.pop()!);
    this.restoreState(next);
    this.isDirty = this.serializeState() !== this.savedState;
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

    // Restore puzzle switch variants
    this.puzzleSwitchVariants.clear();
    for (const [key, variant] of state.puzzleSwitchVariants ?? []) {
      this.puzzleSwitchVariants.set(key, variant);
    }
    this.drawPuzzleLinks();

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

    // Clear old perimeter walls that are now interior (when map grows)
    if (newWidth > oldW) {
      for (let y = 0; y < oldH; y++) {
        if (this.tiles[y][oldW - 1] === 'wall') {
          this.tiles[y][oldW - 1] = 'empty';
        }
      }
    }
    if (newHeight > oldH) {
      for (let x = 0; x < oldW; x++) {
        if (this.tiles[oldH - 1][x] === 'wall') {
          this.tiles[oldH - 1][x] = 'empty';
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

    // Remove out-of-bounds puzzle switch variants
    for (const [key] of this.puzzleSwitchVariants) {
      const [x, y] = key.split(',').map(Number);
      if (x >= newWidth || y >= newHeight) {
        this.puzzleSwitchVariants.delete(key);
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

    // Puzzle tools section
    const puzzleSection = document.createElement('div');
    puzzleSection.style.marginTop = '8px';
    const puzzleLabel = document.createElement('div');
    puzzleLabel.textContent = 'Puzzle';
    puzzleLabel.style.cssText =
      'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:4px;';
    puzzleSection.appendChild(puzzleLabel);

    // Color selector (4 color buttons in a row)
    const colorRow = document.createElement('div');
    colorRow.style.cssText = 'display:flex;gap:3px;margin-bottom:4px;';
    const colorNames: PuzzleColor[] = ['red', 'blue', 'green', 'yellow'];
    const colorHex: Record<PuzzleColor, string> = {
      red: '#ff4444',
      blue: '#4488ff',
      green: '#44cc66',
      yellow: '#ffcc44',
    };
    for (const color of colorNames) {
      const btn = document.createElement('button');
      btn.style.cssText = `flex:1;height:22px;border:2px solid ${this.puzzleColor === color ? '#fff' : 'transparent'};background:${colorHex[color]};border-radius:3px;cursor:pointer;`;
      btn.title = color;
      btn.classList.add('puzzle-color-btn');
      btn.addEventListener('click', () => {
        this.puzzleColor = color;
        // Update button borders
        colorRow.querySelectorAll('button').forEach((b, i) => {
          (b as HTMLElement).style.borderColor = colorNames[i] === color ? '#fff' : 'transparent';
        });
      });
      colorRow.appendChild(btn);
    }
    puzzleSection.appendChild(colorRow);

    // Switch variant selector
    const variantRow = document.createElement('div');
    variantRow.style.cssText = 'display:flex;gap:2px;margin-bottom:4px;';
    const variants: SwitchVariant[] = ['toggle', 'pressure', 'oneshot'];
    for (const v of variants) {
      const btn = document.createElement('button');
      btn.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      btn.style.cssText = `flex:1;padding:2px 4px;font-size:10px;background:${this.switchVariant === v ? 'var(--bg-elevated)' : 'var(--bg-surface)'};border:1px solid ${this.switchVariant === v ? 'var(--primary)' : 'var(--bg-hover)'};color:var(--text);cursor:pointer;border-radius:3px;`;
      btn.classList.add('puzzle-variant-btn');
      btn.addEventListener('click', () => {
        this.switchVariant = v;
        variantRow.querySelectorAll('button').forEach((b, i) => {
          (b as HTMLElement).style.background =
            variants[i] === v ? 'var(--bg-elevated)' : 'var(--bg-surface)';
          (b as HTMLElement).style.borderColor =
            variants[i] === v ? 'var(--primary)' : 'var(--bg-hover)';
        });
      });
      variantRow.appendChild(btn);
    }
    puzzleSection.appendChild(variantRow);

    // Puzzle tile buttons
    const switchBtn = document.createElement('button');
    switchBtn.textContent = 'Switch';
    switchBtn.style.cssText =
      'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
    switchBtn.addEventListener('click', () => {
      this.currentTool = 'puzzle_switch';
      this.highlightActiveTool(switchBtn);
    });
    puzzleSection.appendChild(switchBtn);

    const gateBtn = document.createElement('button');
    gateBtn.textContent = 'Gate';
    gateBtn.style.cssText =
      'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
    gateBtn.addEventListener('click', () => {
      this.currentTool = 'puzzle_gate';
      this.highlightActiveTool(gateBtn);
    });
    puzzleSection.appendChild(gateBtn);

    const crumbleBtn = document.createElement('button');
    crumbleBtn.textContent = 'Crumbling Floor';
    crumbleBtn.style.cssText =
      'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
    crumbleBtn.addEventListener('click', () => {
      this.currentTool = 'crumbling';
      this.highlightActiveTool(crumbleBtn);
    });
    puzzleSection.appendChild(crumbleBtn);

    this.editorContainer.appendChild(puzzleSection);

    // Hazard tile tools section (theme-filtered)
    const themeHazards = HAZARD_TILES_BY_THEME[this.worldTheme] || [];
    const allHazardTiles = Object.keys(HAZARD_TILE_NAMES);
    if (allHazardTiles.length > 0) {
      const hazardSection = document.createElement('div');
      hazardSection.style.marginTop = '8px';
      const hazardLabel = document.createElement('div');
      hazardLabel.textContent = 'Theme Hazards';
      hazardLabel.style.cssText =
        'font-weight:bold;font-size:12px;color:var(--text-dim);margin-bottom:4px;';
      hazardSection.appendChild(hazardLabel);

      let showAll = false;
      const hazardBtnsContainer = document.createElement('div');

      const renderHazardButtons = () => {
        hazardBtnsContainer.innerHTML = '';
        const tilesToShow = showAll ? allHazardTiles : themeHazards;
        if (tilesToShow.length === 0) {
          const noTiles = document.createElement('div');
          noTiles.textContent =
            this.worldTheme === 'classic' || this.worldTheme === 'sky'
              ? 'No hazard tiles for this theme'
              : 'No hazard tiles available';
          noTiles.style.cssText = 'font-size:10px;color:var(--text-dim);padding:2px 0;';
          hazardBtnsContainer.appendChild(noTiles);
          return;
        }
        for (const tile of tilesToShow) {
          const btn = document.createElement('button');
          btn.textContent = HAZARD_TILE_NAMES[tile] || tile;
          btn.style.cssText =
            'display:block;width:100%;padding:4px 6px;margin-bottom:2px;background:var(--bg-surface);border:1px solid var(--bg-hover);color:var(--text);cursor:pointer;text-align:left;font-size:11px;border-radius:3px;';
          btn.addEventListener('click', () => {
            this.currentTool = tile as EditorTool;
            this.highlightActiveTool(btn);
          });
          hazardBtnsContainer.appendChild(btn);
        }
      };

      renderHazardButtons();
      hazardSection.appendChild(hazardBtnsContainer);

      // "Show All" toggle
      if (themeHazards.length < allHazardTiles.length) {
        const toggleRow = document.createElement('div');
        toggleRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'hazard-show-all';
        checkbox.style.cssText = 'margin:0;cursor:pointer;';
        checkbox.addEventListener('change', () => {
          showAll = checkbox.checked;
          renderHazardButtons();
        });
        const lbl = document.createElement('label');
        lbl.htmlFor = 'hazard-show-all';
        lbl.textContent = 'Show all themes';
        lbl.style.cssText = 'font-size:10px;color:var(--text-dim);cursor:pointer;';
        toggleRow.appendChild(checkbox);
        toggleRow.appendChild(lbl);
        hazardSection.appendChild(toggleRow);
      }

      this.editorContainer.appendChild(hazardSection);
    }

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
    backBtn.addEventListener('click', () => this.navigateBack());
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
      this.markDirty();
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
    const buttons = this.editorContainer?.querySelectorAll(
      'button:not(.btn):not(.puzzle-color-btn):not(.puzzle-variant-btn)',
    );
    buttons?.forEach((btn) => {
      (btn as HTMLElement).style.background = 'var(--bg-surface)';
      (btn as HTMLElement).style.borderColor = 'var(--bg-hover)';
    });
    // Re-apply puzzle color button styles (colored backgrounds)
    this.editorContainer?.querySelectorAll('.puzzle-color-btn').forEach((btn) => {
      const color = (btn as HTMLElement).title as PuzzleColor;
      const hex: Record<string, string> = {
        red: '#ff4444',
        blue: '#4488ff',
        green: '#44cc66',
        yellow: '#ffcc44',
      };
      (btn as HTMLElement).style.background = hex[color] || 'var(--bg-surface)';
      (btn as HTMLElement).style.borderColor = color === this.puzzleColor ? '#fff' : 'transparent';
    });
    // Re-apply puzzle variant button styles
    const variants: SwitchVariant[] = ['toggle', 'pressure', 'oneshot'];
    this.editorContainer?.querySelectorAll('.puzzle-variant-btn').forEach((btn, i) => {
      const v = variants[i];
      (btn as HTMLElement).style.background =
        v === this.switchVariant ? 'var(--bg-elevated)' : 'var(--bg-surface)';
      (btn as HTMLElement).style.borderColor =
        v === this.switchVariant ? 'var(--primary)' : 'var(--bg-hover)';
    });
    activeBtn.style.background = 'var(--bg-elevated)';
    activeBtn.style.borderColor = 'var(--primary)';
  }

  private showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.createElement('div');
    const bg = type === 'success' ? 'var(--primary)' : '#d94444';
    toast.textContent = message;
    toast.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:8px 20px;border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;z-index:10000;opacity:0;transition:opacity 0.3s;pointer-events:none;`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
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
      puzzleConfig:
        this.puzzleSwitchVariants.size > 0
          ? { switchVariants: Object.fromEntries(this.puzzleSwitchVariants) }
          : null,
    };

    try {
      if (this.levelId) {
        await apiClient.put(`/admin/campaign/levels/${this.levelId}`, levelData);
      }
      this.savedState = this.serializeState();
      this.isDirty = false;
      this.showToast('Level saved!', 'success');
    } catch (err) {
      this.showToast('Save failed: ' + (err as Error).message, 'error');
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
      puzzleConfig:
        this.puzzleSwitchVariants.size > 0
          ? { switchVariants: Object.fromEntries(this.puzzleSwitchVariants) }
          : null,
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
      onBack: () => this.navigateBack(),
    });
  }

  shutdown(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
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
    this.puzzleLinkGraphics?.destroy();
    for (const label of this.spawnLabels) label.destroy();
    this.spawnLabels = [];
  }
}
