import {
  CampaignLevel,
  CampaignGameState,
  CampaignEnemyState,
  EnemyTypeConfig,
  StartingPowerUps,
  SwitchVariant,
  PlayerInput,
  Position,
  GameMap,
  TileType,
  PowerUpType,
  Direction,
  CampaignReplayMeta,
} from '@blast-arena/shared';
import {
  TICK_RATE,
  CAMPAIGN_RESPAWN_TICKS,
  CAMPAIGN_RESPAWN_INVULNERABILITY,
  MOVE_COOLDOWN_BASE,
} from '@blast-arena/shared';
import {
  isSwitchTile,
  isSwitchActive,
  getSwitchColor,
  getSwitchTile,
  isGateOpen,
  getGateColor,
  getGateTile,
  CRUMBLE_DELAY_TICKS,
} from '@blast-arena/shared';
import {
  CampaignWorldTheme,
  QUICKSAND_KILL_TICKS,
  SPIKE_SAFE_TICKS,
  SPIKE_CYCLE_TICKS,
} from '@blast-arena/shared';
import { GameStateManager, GameConfig } from './GameState';
import { GameLoop } from './GameLoop';
import { Enemy } from './Enemy';
import { Player } from './Player';
import { Bomb } from './Bomb';
import { processEnemyAI, IEnemyAI, EnemyAIContext, EnemyAIResult } from './EnemyAI';
import { getEnemyAIRegistry } from './registry';
import { ReplayRecorder } from '../utils/replayRecorder';
import { GameLogger } from '../utils/gameLogger';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

// Simple seeded random for campaign
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }
}

export interface CampaignSessionCallbacks {
  onStateUpdate: (state: CampaignGameState) => void;
  onPlayerDied: (playerId: number, livesRemaining: number, respawnPosition: Position) => void;
  onEnemyDied: (enemyId: number, position: Position, isBoss: boolean) => void;
  onExitOpened: (position: Position) => void;
  onPlayerLockedIn?: (playerId: number, position: Position) => void;
  onLevelComplete: (timeSeconds: number, deaths: number) => void;
  onGameOver: (reason: string) => void;
}

export class CampaignGame {
  public readonly sessionId: string;
  public readonly userIds: number[];
  public readonly usernames: string[];
  public readonly coopMode: boolean;
  public readonly buddyMode: boolean;
  public readonly level: CampaignLevel;

  /** @deprecated Use userIds[0] instead. Kept for backward compat with CampaignGameManager. */
  public get userId(): number {
    return this.userIds[0];
  }

  public getGameState(): GameStateManager {
    return this.gameState;
  }

  public getEnemies(): Map<number, Enemy> {
    return this.enemies;
  }

  public getLives(): number {
    return this.lives;
  }

  public getMaxLives(): number {
    return this.maxLives;
  }

  public enableReplayRecording(meta: CampaignReplayMeta): void {
    const initialState = this.gameState.toState();
    this.replayRecorder = new ReplayRecorder(this.sessionId, 'campaign', initialState);
    this.replayRecorder.setSessionId(this.sessionId);
    this.replayRecorder.setCampaignMeta(meta);

    // Wire up game logger so replay captures kill/bomb/powerup log entries
    const gameLogger = new GameLogger(this.sessionId, 'campaign', this.userIds.length);
    gameLogger.replayRecorder = this.replayRecorder;
    this.gameState.gameLogger = gameLogger;
  }

  public finalizeReplay(
    result: 'completed' | 'failed',
    _timeSeconds: number,
    _stars: number,
  ): { filename: string; sessionId: string } | null {
    if (!this.replayRecorder) return null;

    const placements = Array.from(this.gameState.players.values()).map((p) => ({
      userId: p.id,
      username: p.username,
      isBot: false,
      placement: p.alive ? 1 : 2,
      kills: p.kills,
      selfKills: p.selfKills,
      team: p.team,
      alive: p.alive,
    }));

    const reason = result === 'completed' ? 'Level completed' : 'Game over';
    const winnerId = result === 'completed' ? this.userIds[0] : null;

    this.gameState.gameLogger?.close();

    this.replayRecorder.finalize({
      winnerId,
      winnerTeam: null,
      reason,
      placements,
    });

    return { filename: this.replayRecorder.getFilename(), sessionId: this.sessionId };
  }

  private gameState: GameStateManager;
  private gameLoop: GameLoop;
  private enemies: Map<number, Enemy> = new Map();
  private enemyTypes: Map<number, EnemyTypeConfig>;
  private lives: number;
  private maxLives: number;
  private exitOpen: boolean = false;
  private rng: SeededRandom;
  private callbacks: CampaignSessionCallbacks;
  private playerDeaths: number = 0;
  private finished: boolean = false;
  private startTick: number = 0;

  // Per-player respawn tracking (co-op: each player has independent respawn)
  private respawnTicks: Map<number, number> = new Map();
  private respawnPositions: Map<number, Position> = new Map();

  // Sequential lock-in: players frozen on exit/goal tile
  private lockedInPlayers: Set<number> = new Set();

  // Hidden power-ups: revealed when the wall at that position is destroyed
  private hiddenPowerups: Map<string, PowerUpType> = new Map();

  // Covered tiles: special tiles hidden under destructible walls, revealed on destruction
  private coveredTiles: Map<string, TileType> = new Map();

  // Puzzle state
  private switchStates: Map<string, boolean> = new Map(); // "x,y" → active/inactive
  private switchVariants: Map<string, SwitchVariant> = new Map(); // "x,y" → variant
  private crumblingVisited: Map<string, number> = new Map(); // "x,y" → tick when entity last stood on it
  private crumblingOccupied: Set<string> = new Set(); // positions currently occupied
  private prevSwitchOccupied: Set<string> = new Set(); // switch positions occupied last tick
  private prevSwitchBlasted: Set<string> = new Set(); // switch positions blasted last tick

  // Hazard tile state
  private worldTheme: CampaignWorldTheme = 'classic';
  private quicksandTimers: Map<number, number> = new Map(); // playerId -> ticks on quicksand
  private enemyQuicksandTimers: Map<number, number> = new Map(); // enemyId -> ticks
  private iceSliding: Map<number, Direction> = new Map(); // playerId -> slide direction
  private enemyIceSliding: Map<number, Direction> = new Map(); // enemyId -> slide direction
  private spikePhase: number = 0; // global cycle counter
  private spikePositions: Array<{ x: number; y: number }> = []; // cached on init
  private prevPlayerPositions: Map<number, string> = new Map(); // "x,y" for movement detection
  private prevEnemyPositions: Map<number, string> = new Map();

  // Enemy bombs tracked separately (they participate in standard bomb mechanics)
  private enemyBombIds: Set<string> = new Set();

  // Custom AI instances per enemy
  private enemyAIs: Map<number, IEnemyAI> = new Map();

  // Replay recording (optional, enabled via enableReplayRecording())
  private replayRecorder: ReplayRecorder | null = null;

  // Grace period: ticks remaining after win condition before level complete
  private static readonly GRACE_TICKS = 30; // 1.5s at 20 tick/sec
  private completionTick: number | null = null;

  constructor(
    userIds: number[],
    usernames: string[],
    level: CampaignLevel,
    enemyTypes: Map<number, EnemyTypeConfig>,
    callbacks: CampaignSessionCallbacks,
    carriedPowerups?: StartingPowerUps | null,
    buddyMode?: boolean,
    theme?: string,
  ) {
    this.sessionId = uuidv4();
    this.userIds = userIds;
    this.usernames = usernames;
    this.coopMode = !buddyMode && userIds.length > 1;
    this.buddyMode = buddyMode ?? false;
    this.level = level;
    this.enemyTypes = enemyTypes;
    this.callbacks = callbacks;
    this.lives = level.lives;
    this.maxLives = level.lives;
    this.rng = new SeededRandom(Date.now());
    this.worldTheme = (theme as CampaignWorldTheme) || 'classic';

    Enemy.resetIdCounter();

    // Build GameMap from level tiles (includes co-op P2 spawn fallback)
    const gameMap = this.buildGameMap(level);

    // Store per-player respawn positions from spawn points
    for (let i = 0; i < userIds.length; i++) {
      this.respawnPositions.set(
        userIds[i],
        gameMap.spawnPoints[i % gameMap.spawnPoints.length] ?? { x: 1, y: 1 },
      );
    }

    // Derive winConditionConfig from tile data if not explicitly set
    this.deriveWinConditionConfig();

    // Create GameStateManager with custom map
    const gameConfig: GameConfig = {
      mapWidth: level.mapWidth,
      mapHeight: level.mapHeight,
      gameMode: 'campaign',
      roundTime: level.timeLimit > 0 ? level.timeLimit : 99999,
      wallDensity: level.wallDensity,
      enabledPowerUps: level.availablePowerupTypes ?? [],
      powerUpDropRate: level.powerupDropRate,
      reinforcedWalls: level.reinforcedWalls,
      enableMapEvents: false,
      customMap: gameMap,
      // Co-op/Buddy: friendly fire OFF so partner/buddy bombs don't hurt each other
      friendlyFire: this.coopMode || this.buddyMode ? false : true,
    };

    this.gameState = new GameStateManager(gameConfig);

    // Add all human players
    const startPowerups = carriedPowerups ?? level.startingPowerups;
    for (let i = 0; i < userIds.length; i++) {
      const isBuddyPlayer = this.buddyMode && i === 1;
      // In co-op/buddy, assign all players to team 0 (enables FF OFF mechanic)
      const team = this.coopMode || this.buddyMode ? 0 : null;
      const player = this.gameState.addPlayer(
        userIds[i],
        usernames[i],
        team,
        false,
        isBuddyPlayer,
        isBuddyPlayer ? userIds[0] : null,
      );

      // Don't apply starting power-ups to buddy (buddy has fixed stats)
      if (startPowerups && player && !isBuddyPlayer) {
        this.applyStartingPowerups(player, startPowerups);
      }
    }

    // Create enemies
    for (const placement of level.enemyPlacements) {
      const typeId = Number(placement.enemyTypeId);
      const typeConfig = enemyTypes.get(typeId);
      if (!typeConfig) continue;
      // Deep copy config so boss phase mutations don't affect template
      const configCopy = JSON.parse(JSON.stringify(typeConfig)) as EnemyTypeConfig;
      const enemy = new Enemy(
        typeId,
        { x: placement.x, y: placement.y },
        configCopy,
        placement.patrolPath,
      );
      this.enemies.set(enemy.id, enemy);
    }

    // Create custom AI instances for enemies with enemyAiId
    this.initEnemyAIs();

    // Load covered tiles (special tiles hidden under destructible walls)
    for (const ct of level.coveredTiles ?? []) {
      this.coveredTiles.set(`${ct.x},${ct.y}`, ct.type);
    }

    // Load puzzle config (switch variants)
    if (level.puzzleConfig?.switchVariants) {
      for (const [key, variant] of Object.entries(level.puzzleConfig.switchVariants)) {
        this.switchVariants.set(key, variant);
      }
    }

    // Initialize switch states from tile grid (detect pre-placed switches)
    // Also cache spike positions for hazard tile processing
    for (let y = 0; y < level.mapHeight; y++) {
      for (let x = 0; x < level.mapWidth; x++) {
        const tile = this.gameState.map.tiles[y][x];
        if (isSwitchTile(tile)) {
          const key = `${x},${y}`;
          this.switchStates.set(key, isSwitchActive(tile));
        }
        if (tile === 'spikes' || tile === 'spikes_active') {
          this.spikePositions.push({ x, y });
        }
      }
    }

    // Place visible power-ups on the map; hidden ones revealed when wall is destroyed
    for (const pp of level.powerupPlacements) {
      if (pp.hidden) {
        this.hiddenPowerups.set(`${pp.x},${pp.y}`, pp.type);
        this.gameState.reservedPowerUpTiles.add(`${pp.x},${pp.y}`);
      } else {
        this.gameState.spawnPowerUpAt(pp.x, pp.y, pp.type);
      }
    }

    // Create game loop with countdown
    this.gameLoop = new GameLoop(
      this.gameState,
      (state) => this.onTick(state),
      () => this.onTimeUp(),
      TICK_RATE,
    );
  }

  start(): void {
    this.updateEnemyPositions();
    this.gameLoop.start();
  }

  stop(): void {
    this.gameLoop.stop();
    this.finished = true;
  }

  pause(): void {
    if (!this.finished) {
      this.gameLoop.pause();
    }
  }

  resume(): void {
    if (!this.finished) {
      this.gameLoop.resume();
    }
  }

  isPaused(): boolean {
    return this.gameLoop.isPaused();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getPlayer(userId: number): Player | undefined {
    return this.gameState.players.get(userId);
  }

  handleInput(userId: number, input: PlayerInput): void {
    // Don't process input for locked-in (frozen) players
    if (this.lockedInPlayers.has(userId)) return;
    this.gameState.inputBuffer.addInput(userId, input);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private buildGameMap(level: CampaignLevel): GameMap {
    // Deep copy tiles, generate default if empty
    let tiles: TileType[][];
    if (!level.tiles || level.tiles.length === 0) {
      tiles = [];
      for (let y = 0; y < level.mapHeight; y++) {
        tiles[y] = [];
        for (let x = 0; x < level.mapWidth; x++) {
          if (x === 0 || y === 0 || x === level.mapWidth - 1 || y === level.mapHeight - 1) {
            tiles[y][x] = 'wall';
          } else if (x % 2 === 0 && y % 2 === 0) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      // Place spawn at (1,1)
      tiles[1][1] = 'spawn';
    } else {
      tiles = level.tiles.map((row) => [...row]);
    }

    // Use level spawns, or derive from tiles, or fall back to (1,1)
    const spawnPoints = [...level.playerSpawns];
    if (spawnPoints.length === 0) {
      // Scan tiles for spawn markers
      for (let y = 0; y < level.mapHeight; y++) {
        for (let x = 0; x < level.mapWidth; x++) {
          if (tiles[y]?.[x] === 'spawn') {
            spawnPoints.push({ x, y });
          }
        }
      }
    }
    if (spawnPoints.length === 0) {
      // Last resort: find first empty tile
      for (let y = 1; y < level.mapHeight - 1 && spawnPoints.length === 0; y++) {
        for (let x = 1; x < level.mapWidth - 1 && spawnPoints.length === 0; x++) {
          if (tiles[y]?.[x] === 'empty') {
            spawnPoints.push({ x, y });
          }
        }
      }
    }
    if (spawnPoints.length === 0) {
      spawnPoints.push({ x: 1, y: 1 });
    }

    // Co-op: auto-generate P2 spawn if level has only 1 spawn point
    if (this.coopMode && spawnPoints.length < 2) {
      const s1 = spawnPoints[0];
      // Spiral search for nearest empty tile
      const directions = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      let found = false;
      for (let dist = 1; dist < Math.max(level.mapWidth, level.mapHeight) && !found; dist++) {
        for (const [dx, dy] of directions) {
          const nx = s1.x + dx * dist;
          const ny = s1.y + dy * dist;
          if (
            nx > 0 &&
            ny > 0 &&
            nx < level.mapWidth - 1 &&
            ny < level.mapHeight - 1 &&
            (tiles[ny][nx] === 'empty' || tiles[ny][nx] === 'spawn')
          ) {
            spawnPoints.push({ x: nx, y: ny });
            found = true;
            break;
          }
        }
      }
    }

    return {
      width: level.mapWidth,
      height: level.mapHeight,
      tiles,
      spawnPoints,
      seed: Date.now(),
    };
  }

  private deriveWinConditionConfig(): void {
    if (!this.level.winConditionConfig) {
      this.level.winConditionConfig = {};
    }
    const config = this.level.winConditionConfig;

    // Scan tiles to find goal and exit positions if not already set
    if (!config.goalPosition || !config.exitPosition) {
      for (let y = 0; y < this.level.mapHeight; y++) {
        for (let x = 0; x < this.level.mapWidth; x++) {
          const tile = this.level.tiles[y]?.[x];
          if (tile === 'goal' && !config.goalPosition) {
            config.goalPosition = { x, y };
          }
          if (tile === 'exit' && !config.exitPosition) {
            config.exitPosition = { x, y };
          }
        }
      }
    }

    // Derive surviveTimeTicks from timeLimit if not set
    if (
      this.level.winCondition === 'survive_time' &&
      config.surviveTimeTicks == null &&
      this.level.timeLimit > 0
    ) {
      config.surviveTimeTicks = this.level.timeLimit * TICK_RATE;
    }
  }

  private applyStartingPowerups(player: Player, powerups: StartingPowerUps): void {
    if (powerups.bombUp) {
      for (let i = 0; i < powerups.bombUp; i++) player.applyPowerUp('bomb_up');
    }
    if (powerups.fireUp) {
      for (let i = 0; i < powerups.fireUp; i++) player.applyPowerUp('fire_up');
    }
    if (powerups.speedUp) {
      for (let i = 0; i < powerups.speedUp; i++) player.applyPowerUp('speed_up');
    }
    if (powerups.shield) player.applyPowerUp('shield');
    if (powerups.kick) player.applyPowerUp('kick');
    if (powerups.pierceBomb) player.applyPowerUp('pierce_bomb');
    if (powerups.remoteBomb) player.applyPowerUp('remote_bomb');
    if (powerups.lineBomb) player.applyPowerUp('line_bomb');
  }

  private onTick(_tickState: unknown): void {
    if (this.finished) return;
    if (this.gameState.status !== 'playing') {
      // Still broadcast state during countdown so frontend shows the countdown overlay
      const state = this.toCampaignState();
      this.callbacks.onStateUpdate(state);
      // Skip recording during countdown — tick stays at 0 and would create duplicate frames
      return;
    }

    // Record start tick on first playing tick (after countdown)
    if (this.startTick === 0) {
      this.startTick = this.gameState.tick;
    }

    this.campaignTick();

    // Broadcast combined state
    const state = this.toCampaignState();
    this.callbacks.onStateUpdate(state);
    this.recordReplayTick(state);
  }

  private recordReplayTick(state: CampaignGameState): void {
    if (!this.replayRecorder) return;
    // Record standard game state + tile diffs
    const gameState = state.gameState;
    // Override timeElapsed with campaign-adjusted time (excludes countdown ticks)
    const campaignElapsed = (this.gameState.tick - this.startTick) / TICK_RATE;
    const replayState = {
      ...gameState,
      map: { ...gameState.map, tiles: this.gameState.map.tiles },
      timeElapsed: campaignElapsed,
    };
    this.replayRecorder.recordTick(replayState, this.gameState.tickEvents);
    // Attach campaign-specific data to the frame
    this.replayRecorder.recordCampaignData({
      enemies: state.enemies,
      lives: state.lives,
      exitOpen: state.exitOpen,
    });
  }

  private onTimeUp(): void {
    if (this.finished) return;
    if (this.level.winCondition === 'survive_time') {
      this.completeLevelInternal();
    } else {
      this.gameOverInternal("Time's up!");
    }
  }

  private campaignTick(): void {
    const tick = this.gameState.tick;

    // Safety cap: terminate campaign games that exceed 60 minutes
    const elapsedSeconds = (tick - this.startTick) / TICK_RATE;
    if (this.startTick > 0 && elapsedSeconds >= 3600) {
      this.gameOverInternal('Time limit reached (60 minutes)');
      return;
    }

    // Apply speed modifiers for players on slowing tiles (processTick already applied normal cooldown)
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.moveCooldown <= 0) continue;
      const tile = this.gameState.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile === 'vine' || tile === 'quicksand' || tile === 'mud') {
        player.moveCooldown = Math.max(player.moveCooldown, MOVE_COOLDOWN_BASE * 2);
      }
    }

    // 1. Handle per-player respawn
    for (const [playerId, respawnTick] of this.respawnTicks) {
      if (tick >= respawnTick) {
        const player = this.gameState.players.get(playerId);
        if (player) {
          const spawnPos = this.respawnPositions.get(playerId) ?? { x: 1, y: 1 };
          player.respawn(spawnPos);
          player.invulnerableTicks = CAMPAIGN_RESPAWN_INVULNERABILITY;

          // Re-apply starting powerups on respawn
          const startPowerups = this.level.startingPowerups;
          if (startPowerups) this.applyStartingPowerups(player, startPowerups);
        }
        this.respawnTicks.delete(playerId);
      }
    }

    // 2. Enemy tick + conveyor + AI movement
    const bombPositions = Array.from(this.gameState.bombs.values()).map((b) => b.position);
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive) continue;
      enemy.tick();

      // Conveyor belts push enemies before AI (skip wall-passers — they float above)
      if (enemy.canMove() && !enemy.typeConfig.canPassWalls) {
        const convTile = this.gameState.collisionSystem.getTileAt(
          enemy.position.x,
          enemy.position.y,
        );
        let convDir: Direction | null = null;
        switch (convTile) {
          case 'conveyor_up':
            convDir = 'up';
            break;
          case 'conveyor_down':
            convDir = 'down';
            break;
          case 'conveyor_left':
            convDir = 'left';
            break;
          case 'conveyor_right':
            convDir = 'right';
            break;
        }
        if (convDir) {
          const convPos = this.gameState.collisionSystem.canMoveTo(
            enemy.position.x,
            enemy.position.y,
            convDir,
            enemy.typeConfig.canPassBombs ? [] : bombPositions,
          );
          if (convPos) {
            enemy.position = convPos;
            enemy.direction = convDir;
            enemy.applyMoveCooldown();
            this.gameState.applyTeleporter(enemy);
          }
        }
      }

      if (enemy.canMove()) {
        let result: EnemyAIResult;
        const customAI = this.enemyAIs.get(enemy.id);

        if (customAI) {
          try {
            const context = this.buildEnemyAIContext(enemy, bombPositions);
            result = customAI.decide(context);
          } catch (err: unknown) {
            // Crash recovery: fall back to built-in pattern for this enemy
            this.enemyAIs.delete(enemy.id);
            logger.warn(
              { enemyId: enemy.id, error: err instanceof Error ? err.message : String(err) },
              'Custom enemy AI crashed, falling back to built-in',
            );
            result = processEnemyAI(
              enemy,
              Array.from(this.gameState.players.values()),
              this.gameState.collisionSystem,
              bombPositions,
              this.gameState.map.tiles,
              () => this.rng.next(),
            );
          }
        } else {
          result = processEnemyAI(
            enemy,
            Array.from(this.gameState.players.values()),
            this.gameState.collisionSystem,
            bombPositions,
            this.gameState.map.tiles,
            () => this.rng.next(),
          );
        }

        if (result.direction) {
          this.moveEnemy(enemy, result.direction, bombPositions);
        }

        if (result.placeBomb && enemy.canPlaceBomb()) {
          this.placeEnemyBomb(enemy);
        }
      }
    }

    // 2b. Apply speed modifiers for enemies on slowing tiles
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || enemy.moveCooldown <= 0 || enemy.typeConfig.canPassWalls) continue;
      const tile = this.gameState.collisionSystem.getTileAt(enemy.position.x, enemy.position.y);
      if (tile === 'vine' || tile === 'quicksand' || tile === 'mud') {
        const baseCooldown = Math.max(
          1,
          Math.round(MOVE_COOLDOWN_BASE / Math.max(0.01, enemy.typeConfig.speed)),
        );
        enemy.moveCooldown = Math.max(enemy.moveCooldown, baseCooldown * 2);
      }
    }

    // 3. Enemy-explosion collision
    for (const explosion of this.gameState.explosions.values()) {
      for (const enemy of this.enemies.values()) {
        if (!enemy.alive) continue;
        if (explosion.containsCell(enemy.position.x, enemy.position.y)) {
          const died = enemy.takeDamage(1);
          if (died) {
            this.onEnemyDied(enemy);
          }
        }
      }
    }

    // 4. Player-enemy contact collision (check ALL alive players)
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.invulnerableTicks > 0 || player.frozen) continue;
      if (player.isBuddy) continue; // Buddy is immune to enemy contact
      for (const enemy of this.enemies.values()) {
        if (!enemy.alive || !enemy.typeConfig.contactDamage) continue;
        if (enemy.position.x === player.position.x && enemy.position.y === player.position.y) {
          this.handlePlayerDeath(player.id);
          break;
        }
      }
    }

    // 5. Check if any player was killed by explosion (handled by gameState.processTick)
    for (const player of this.gameState.players.values()) {
      if (!player.alive && !this.respawnTicks.has(player.id)) {
        this.handlePlayerDeath(player.id);
      }
    }

    // 6. Covered tile reveals (special tiles hidden under destructible walls)
    for (const [key, type] of this.coveredTiles) {
      const [x, y] = key.split(',').map(Number);
      const tile = this.gameState.collisionSystem.getTileAt(x, y);
      if (tile === 'empty') {
        this.gameState.map.tiles[y][x] = type;
        this.gameState.collisionSystem.updateTiles(this.gameState.map.tiles);
        this.coveredTiles.delete(key);
      }
    }

    // 7. Hidden power-up reveals
    for (const [key, type] of this.hiddenPowerups) {
      const [x, y] = key.split(',').map(Number);
      const tile = this.gameState.collisionSystem.getTileAt(x, y);
      if (tile !== 'wall' && tile !== 'destructible' && tile !== 'destructible_cracked') {
        this.gameState.spawnPowerUpAt(x, y, type);
        this.hiddenPowerups.delete(key);
        this.gameState.reservedPowerUpTiles.delete(key);
      }
    }

    // 7.5. Puzzle tile processing (switches, gates, crumbling floors)
    this.processPuzzleTiles();

    // 7.6. Hazard tile processing (theme-specific tiles)
    this.processHazardTiles();

    // 8. Boss phase transitions
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || !enemy.typeConfig.isBoss) continue;
      const phase = enemy.checkBossPhaseTransition();
      if (phase?.spawnEnemies) {
        for (const spawn of phase.spawnEnemies) {
          const spawnConfig = this.enemyTypes.get(spawn.enemyTypeId);
          if (!spawnConfig) continue;
          for (let i = 0; i < spawn.count; i++) {
            const configCopy = JSON.parse(JSON.stringify(spawnConfig)) as EnemyTypeConfig;
            const minion = new Enemy(spawn.enemyTypeId, { ...enemy.position }, configCopy);
            this.enemies.set(minion.id, minion);
            // Init custom AI for spawned minion if applicable
            this.initEnemyAIForEnemy(minion);
          }
        }
      }
    }

    // 8. Win condition check
    this.checkWinCondition();

    // 9. Grace period after win — let final explosions/effects play out
    if (this.completionTick !== null) {
      if (tick >= this.completionTick + CampaignGame.GRACE_TICKS) {
        this.completeLevelInternal();
      }
    }

    // 10. Cache positions for next tick's hazard tile movement detection
    for (const player of this.gameState.players.values()) {
      this.prevPlayerPositions.set(player.id, `${player.position.x},${player.position.y}`);
    }
    for (const enemy of this.enemies.values()) {
      if (enemy.alive) {
        this.prevEnemyPositions.set(enemy.id, `${enemy.position.x},${enemy.position.y}`);
      }
    }

    // 11. Update enemy positions for next tick's bomb slide collision checks
    this.updateEnemyPositions();
  }

  private updateEnemyPositions(): void {
    const positions = new Set<string>();
    for (const enemy of this.enemies.values()) {
      if (enemy.alive) {
        positions.add(`${enemy.position.x},${enemy.position.y}`);
      }
    }
    this.gameState.campaignEnemyPositions = positions;
  }

  private initEnemyAIs(): void {
    const registry = getEnemyAIRegistry();
    for (const enemy of this.enemies.values()) {
      this.initEnemyAIForEnemy(enemy, registry);
    }
  }

  private initEnemyAIForEnemy(enemy: Enemy, registry = getEnemyAIRegistry()): void {
    const config = enemy.typeConfig;
    if (!config.enemyAiId || !registry.isLoaded(config.enemyAiId)) return;
    try {
      const ai = registry.createInstance(config.enemyAiId, config.difficulty || 'normal', {
        speed: config.speed,
        canPassWalls: config.canPassWalls,
        canPassBombs: config.canPassBombs,
        canBomb: config.canBomb,
        contactDamage: config.contactDamage,
        isBoss: config.isBoss,
        sizeMultiplier: config.sizeMultiplier,
      });
      if (ai) this.enemyAIs.set(enemy.id, ai);
    } catch (err: unknown) {
      logger.warn(
        {
          enemyId: enemy.id,
          aiId: config.enemyAiId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to create enemy AI instance, using built-in pattern',
      );
    }
  }

  private buildEnemyAIContext(enemy: Enemy, bombPositions: Position[]): EnemyAIContext {
    const alivePlayers = Array.from(this.gameState.players.values())
      .filter((p) => p.alive)
      .map((p) => ({ position: { ...p.position }, alive: true }));

    const otherEnemies = Array.from(this.enemies.values())
      .filter((e) => e.alive && e.id !== enemy.id)
      .map((e) => ({ position: { ...e.position }, enemyTypeId: e.enemyTypeId, alive: true }));

    return {
      self: {
        position: { ...enemy.position },
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        direction: enemy.direction,
        alive: enemy.alive,
        typeConfig: {
          speed: enemy.typeConfig.speed,
          canPassWalls: enemy.typeConfig.canPassWalls,
          canPassBombs: enemy.typeConfig.canPassBombs,
          canBomb: enemy.typeConfig.canBomb,
          contactDamage: enemy.typeConfig.contactDamage,
          isBoss: enemy.typeConfig.isBoss,
          sizeMultiplier: enemy.typeConfig.sizeMultiplier,
        },
        patrolPath: [...enemy.patrolPath],
        patrolIndex: enemy.patrolIndex,
      },
      players: alivePlayers,
      tiles: this.gameState.map.tiles,
      mapWidth: this.gameState.map.width,
      mapHeight: this.gameState.map.height,
      bombPositions: bombPositions.map((p) => ({ ...p })),
      otherEnemies,
      tick: this.gameState.tick,
      rng: () => this.rng.next(),
    };
  }

  private moveEnemy(enemy: Enemy, direction: Direction, bombPositions: Position[]): void {
    const newPos = this.gameState.collisionSystem.canMoveTo(
      enemy.position.x,
      enemy.position.y,
      direction,
      enemy.typeConfig.canPassBombs ? [] : bombPositions,
    );

    if (newPos || enemy.typeConfig.canPassWalls) {
      // Ghost enemies can walk through walls
      if (!newPos && enemy.typeConfig.canPassWalls) {
        const dx = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
        const dy = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
        const nx = enemy.position.x + dx;
        const ny = enemy.position.y + dy;
        const tile = this.gameState.collisionSystem.getTileAt(nx, ny);
        if (tile !== 'wall') {
          enemy.position = { x: nx, y: ny };
          enemy.direction = direction;
          enemy.applyMoveCooldown();
          this.gameState.applyTeleporter(enemy);
        }
      } else if (newPos) {
        enemy.position = newPos;
        enemy.direction = direction;
        enemy.applyMoveCooldown();
        this.gameState.applyTeleporter(enemy);
      }
    }
  }

  private placeEnemyBomb(enemy: Enemy): void {
    if (!enemy.typeConfig.bombConfig) return;

    const bomb = new Bomb(
      { ...enemy.position },
      enemy.id,
      enemy.typeConfig.bombConfig.fireRange,
      'normal',
    );
    this.gameState.bombs.set(bomb.id, bomb);
    this.enemyBombIds.add(bomb.id);
    enemy.applyBombCooldown();
  }

  private onEnemyDied(enemy: Enemy): void {
    // Drop power-up
    if (this.rng.next() < enemy.typeConfig.dropChance && enemy.typeConfig.dropTable.length > 0) {
      const dropType =
        enemy.typeConfig.dropTable[Math.floor(this.rng.next() * enemy.typeConfig.dropTable.length)];
      this.gameState.spawnPowerUpAt(enemy.position.x, enemy.position.y, dropType);
    }

    this.callbacks.onEnemyDied(enemy.id, { ...enemy.position }, enemy.typeConfig.isBoss);
  }

  private handlePlayerDeath(playerId: number): void {
    const player = this.gameState.players.get(playerId);
    if (!player) return;
    if (player.isBuddy) return; // Buddy cannot die

    // Player might already be handled (pending respawn)
    if (!player.alive && this.respawnTicks.has(playerId)) return;

    if (player.alive) {
      player.die();
    }

    // If player was locked in on exit/goal, remove lock-in
    if (this.lockedInPlayers.has(playerId)) {
      this.lockedInPlayers.delete(playerId);
      player.frozen = false;
    }

    this.playerDeaths++;
    this.lives--;

    if (this.lives <= 0) {
      this.gameOverInternal('No lives remaining!');
      return;
    }

    const respawnPos = this.respawnPositions.get(playerId) ?? { x: 1, y: 1 };
    this.respawnTicks.set(playerId, this.gameState.tick + CAMPAIGN_RESPAWN_TICKS);
    this.callbacks.onPlayerDied(playerId, this.lives, respawnPos);
  }

  private triggerCompletion(): void {
    if (this.completionTick === null) {
      this.completionTick = this.gameState.tick;
    }
  }

  /**
   * Process puzzle tile mechanics: switches, gates, and crumbling floors.
   * Called each tick after hidden power-up reveals, before boss phase transitions.
   */
  private processPuzzleTiles(): void {
    // Skip if no puzzle state to process
    if (this.switchStates.size === 0 && this.crumblingVisited.size === 0) {
      // Still check for crumbling tiles that entities might be standing on
      this.processCrumblingFloors();
      return;
    }

    this.processSwitchesAndGates();
    this.processCrumblingFloors();
  }

  private processSwitchesAndGates(): void {
    if (this.switchStates.size === 0) return;

    // Build set of positions currently occupied by players or bombs
    const currentOccupied = new Set<string>();
    for (const player of this.gameState.players.values()) {
      if (!player.alive) continue;
      currentOccupied.add(`${player.position.x},${player.position.y}`);
    }
    for (const bomb of this.gameState.bombs.values()) {
      currentOccupied.add(`${bomb.position.x},${bomb.position.y}`);
    }

    // Build set of positions covered by active explosions
    const explodedPositions = new Set<string>();
    for (const explosion of this.gameState.explosions.values()) {
      for (const cell of explosion.cells) {
        explodedPositions.add(`${cell.x},${cell.y}`);
      }
    }

    // Track which colors changed state (for gate toggling)
    const colorStateChanged = new Map<string, boolean>(); // color → new gate-open state

    for (const [key, wasActive] of this.switchStates) {
      const variant = this.switchVariants.get(key) ?? 'toggle';
      const isOccupied = currentOccupied.has(key);
      const wasOccupied = this.prevSwitchOccupied.has(key);
      const isBlasted = explodedPositions.has(key);
      const wasBlasted = this.prevSwitchBlasted.has(key);
      const blastHit = isBlasted && !wasBlasted; // rising edge — first tick of explosion
      const color = getSwitchColor(
        this.gameState.map.tiles[Number(key.split(',')[1])][Number(key.split(',')[0])],
      );
      if (!color) continue;

      let newActive = wasActive;

      switch (variant) {
        case 'toggle': {
          // Flip on step-on (transition) or blast hit (first tick only)
          const steppedOn = isOccupied && !wasOccupied;
          if (steppedOn || blastHit) {
            newActive = !wasActive;
          }
          break;
        }
        case 'pressure': {
          // Active while occupied; blast activates only on first tick
          newActive = isOccupied || blastHit;
          break;
        }
        case 'oneshot': {
          // Once activated, stays active forever
          if (!wasActive) {
            const steppedOn = isOccupied && !wasOccupied;
            if (steppedOn || blastHit) {
              newActive = true;
            }
          }
          break;
        }
      }

      if (newActive !== wasActive) {
        this.switchStates.set(key, newActive);
        const [sx, sy] = key.split(',').map(Number);
        this.gameState.setTileTracked(sx, sy, getSwitchTile(color, newActive));
        // Mark this color as needing gate update
        colorStateChanged.set(color, newActive);
      }
    }

    // Update gates for colors whose switch state changed
    if (colorStateChanged.size > 0) {
      for (const [color] of colorStateChanged) {
        // OR logic: gates are open if ANY switch of that color is active
        let anyActive = false;
        for (const [switchKey, active] of this.switchStates) {
          const switchColor = getSwitchColor(
            this.gameState.map.tiles[Number(switchKey.split(',')[1])][
              Number(switchKey.split(',')[0])
            ],
          );
          if (switchColor === color && active) {
            anyActive = true;
            break;
          }
        }

        // Toggle all gates of this color
        for (let y = 0; y < this.gameState.map.height; y++) {
          for (let x = 0; x < this.gameState.map.width; x++) {
            const tile = this.gameState.map.tiles[y][x];
            const gateColor = getGateColor(tile);
            if (gateColor === color) {
              const shouldBeOpen = anyActive;
              const isOpen = isGateOpen(tile);
              if (shouldBeOpen !== isOpen) {
                this.gameState.setTileTracked(x, y, getGateTile(gateColor, shouldBeOpen));
              }
            }
          }
        }
      }
    }

    // Update previous occupied/blasted sets for next tick
    this.prevSwitchOccupied = new Set<string>();
    this.prevSwitchBlasted = new Set<string>();
    for (const key of this.switchStates.keys()) {
      if (currentOccupied.has(key)) {
        this.prevSwitchOccupied.add(key);
      }
      if (explodedPositions.has(key)) {
        this.prevSwitchBlasted.add(key);
      }
    }
  }

  private processCrumblingFloors(): void {
    const tick = this.gameState.tick;

    // Build set of currently occupied crumbling positions
    // (alive players except buddies, alive enemies except those with canPassWalls)
    const currentCrumbling = new Set<string>();
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.isBuddy) continue;
      const key = `${player.position.x},${player.position.y}`;
      if (this.gameState.map.tiles[player.position.y]?.[player.position.x] === 'crumbling') {
        currentCrumbling.add(key);
      }
    }
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || enemy.typeConfig.canPassWalls) continue;
      const key = `${enemy.position.x},${enemy.position.y}`;
      if (this.gameState.map.tiles[enemy.position.y]?.[enemy.position.x] === 'crumbling') {
        currentCrumbling.add(key);
      }
    }

    // Check previously visited crumbling tiles that are no longer occupied
    for (const [key, visitedTick] of this.crumblingVisited) {
      if (!currentCrumbling.has(key) && !this.crumblingOccupied.has(key)) {
        // Already stepped off — waiting for crumble delay
        if (tick - visitedTick >= CRUMBLE_DELAY_TICKS) {
          const [cx, cy] = key.split(',').map(Number);
          this.gameState.setTileTracked(cx, cy, 'pit');
          this.crumblingVisited.delete(key);
        }
      } else if (!currentCrumbling.has(key) && this.crumblingOccupied.has(key)) {
        // Entity just stepped off this tick — record the step-off tick
        this.crumblingVisited.set(key, tick);
      }
    }

    // Track currently occupied crumbling positions
    for (const key of currentCrumbling) {
      if (!this.crumblingVisited.has(key)) {
        this.crumblingVisited.set(key, tick);
      }
    }

    // Update occupied set for next tick comparison
    this.crumblingOccupied = currentCrumbling;
  }

  private checkWinCondition(): void {
    // Already triggered — waiting for grace period
    if (this.completionTick !== null) return;

    switch (this.level.winCondition) {
      case 'kill_all': {
        if (this.enemies.size === 0) break; // No enemies to kill
        const allDead = Array.from(this.enemies.values()).every((e) => !e.alive);
        if (allDead) this.triggerCompletion();
        break;
      }
      case 'find_exit': {
        // Check prerequisite (e.g., kill N enemies)
        if (!this.exitOpen) {
          const killTarget = this.level.winConditionConfig?.killTarget;
          if (killTarget != null) {
            const deadCount = Array.from(this.enemies.values()).filter((e) => !e.alive).length;
            if (deadCount >= killTarget) {
              this.openExit();
            }
          } else {
            // No kill target — all enemies must die
            const allDead = Array.from(this.enemies.values()).every((e) => !e.alive);
            if (allDead) this.openExit();
          }
        }

        // Sequential lock-in: check each alive player on exit tile
        if (this.exitOpen && this.level.winConditionConfig?.exitPosition) {
          const ep = this.level.winConditionConfig.exitPosition;
          this.checkLockIn(ep);
        }
        break;
      }
      case 'reach_goal': {
        if (this.level.winConditionConfig?.goalPosition) {
          const gp = this.level.winConditionConfig.goalPosition;
          this.checkLockIn(gp);
        }
        break;
      }
      case 'survive_time': {
        const targetTicks = this.level.winConditionConfig?.surviveTimeTicks;
        if (targetTicks != null && this.gameState.tick - this.startTick >= targetTicks) {
          this.triggerCompletion();
        }
        break;
      }
    }
  }

  /**
   * Sequential lock-in mechanic for exit/goal tiles.
   * First player steps on tile → frozen in place (removed from collision).
   * Second player then walks onto the same tile.
   * When all alive players are locked in → level complete.
   */
  private checkLockIn(targetPos: Position): void {
    for (const player of this.gameState.players.values()) {
      if (player.isBuddy) continue; // Buddy doesn't participate in lock-in
      if (
        player.alive &&
        !player.frozen &&
        !this.lockedInPlayers.has(player.id) &&
        player.position.x === targetPos.x &&
        player.position.y === targetPos.y
      ) {
        this.lockedInPlayers.add(player.id);
        player.frozen = true;
        this.callbacks.onPlayerLockedIn?.(player.id, targetPos);
      }
    }

    // Check if all alive non-buddy players are locked in
    const alivePlayers = Array.from(this.gameState.players.values()).filter(
      (p) => p.alive && !p.isBuddy,
    );
    if (alivePlayers.length > 0 && alivePlayers.every((p) => this.lockedInPlayers.has(p.id))) {
      this.triggerCompletion();
    }
  }

  private openExit(): void {
    this.exitOpen = true;
    const exitPos = this.level.winConditionConfig?.exitPosition;
    if (exitPos) {
      // Swap exit tile to walkable
      this.gameState.map.tiles[exitPos.y][exitPos.x] = 'exit';
      this.gameState.collisionSystem.updateTiles(this.gameState.map.tiles);
      this.callbacks.onExitOpened(exitPos);
    }
  }

  private completeLevelInternal(): void {
    if (this.finished) return;
    this.finished = true;
    this.gameLoop.stop();

    const elapsedTicks = this.gameState.tick - this.startTick;
    const timeSeconds = Math.round(elapsedTicks / TICK_RATE);

    this.callbacks.onLevelComplete(timeSeconds, this.playerDeaths);
  }

  private gameOverInternal(reason: string): void {
    if (this.finished) return;
    this.finished = true;
    this.gameLoop.stop();
    this.callbacks.onGameOver(reason);
  }

  private toCampaignState(): CampaignGameState {
    const state = this.gameState.toState();
    const enemies: CampaignEnemyState[] = [];
    for (const enemy of this.enemies.values()) {
      enemies.push(enemy.toState());
    }

    // Build respawn timers: playerId → ticks remaining
    const respawnTimers: Record<number, number> = {};
    for (const [playerId, respawnTick] of this.respawnTicks) {
      respawnTimers[playerId] = Math.max(0, respawnTick - this.gameState.tick);
    }

    return {
      gameState: state,
      enemies,
      lives: this.lives,
      maxLives: this.maxLives,
      levelId: this.level.id,
      exitOpen: this.exitOpen,
      coopMode: this.coopMode,
      buddyMode: this.buddyMode || undefined,
      theme: this.worldTheme !== 'classic' ? this.worldTheme : undefined,
      respawnTimers: Object.keys(respawnTimers).length > 0 ? respawnTimers : undefined,
      lockedInPlayers: this.lockedInPlayers.size > 0 ? Array.from(this.lockedInPlayers) : undefined,
    };
  }

  // ==================== Hazard Tile Processing ====================

  private processHazardTiles(): void {
    this.processQuicksandTiles();
    this.processIceSliding();
    this.processLavaDetonation();
    this.processSpikeTiles();
    this.processDarkRiftTiles();
    // Vine: speed effect handled in campaignTick speed modifiers, destruction via CollisionSystem.destroyTile
    // Mud: speed effect handled in campaignTick speed modifiers, no other logic
  }

  private processQuicksandTiles(): void {
    // Players
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.isBuddy) continue;
      const tile = this.gameState.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile === 'quicksand') {
        const timer = (this.quicksandTimers.get(player.id) ?? 0) + 1;
        this.quicksandTimers.set(player.id, timer);
        if (timer >= QUICKSAND_KILL_TICKS) {
          if (player.hasShield) {
            // Shield absorbs the kill, reset timer
            player.hasShield = false;
            player.invulnerableTicks = 10;
            this.quicksandTimers.set(player.id, 0);
          } else if (player.invulnerableTicks <= 0) {
            this.handlePlayerDeath(player.id);
            this.quicksandTimers.delete(player.id);
          }
        }
      } else {
        this.quicksandTimers.delete(player.id);
      }
    }

    // Enemies
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || enemy.typeConfig.canPassWalls) continue;
      const tile = this.gameState.collisionSystem.getTileAt(enemy.position.x, enemy.position.y);
      if (tile === 'quicksand') {
        const timer = (this.enemyQuicksandTimers.get(enemy.id) ?? 0) + 1;
        this.enemyQuicksandTimers.set(enemy.id, timer);
        if (timer >= QUICKSAND_KILL_TICKS) {
          const died = enemy.takeDamage(enemy.hp);
          if (died) this.onEnemyDied(enemy);
          this.enemyQuicksandTimers.delete(enemy.id);
        }
      } else {
        this.enemyQuicksandTimers.delete(enemy.id);
      }
    }
  }

  private processIceSliding(): void {
    const bombPositions = Array.from(this.gameState.bombs.values()).map((b) => b.position);

    // Detect players who just moved onto ice
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.frozen) continue;
      if (this.iceSliding.has(player.id)) continue; // Already sliding
      const tile = this.gameState.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile !== 'ice') continue;
      const prevKey = this.prevPlayerPositions.get(player.id);
      const curKey = `${player.position.x},${player.position.y}`;
      if (prevKey !== curKey) {
        // Player just moved onto ice — start sliding in their current direction
        this.iceSliding.set(player.id, player.direction);
      }
    }

    // Process player ice sliding
    for (const [playerId, direction] of this.iceSliding) {
      const player = this.gameState.players.get(playerId);
      if (!player || !player.alive) {
        this.iceSliding.delete(playerId);
        continue;
      }

      // Filter out self and own buddy from player positions
      const playerPositions = Array.from(this.gameState.players.values())
        .filter((p) => p.alive && p.id !== playerId && p.buddyOwnerId !== playerId)
        .map((p) => p.position);

      const newPos = player.isBuddy
        ? this.gameState.collisionSystem.canBuddyMoveTo(
            player.position.x,
            player.position.y,
            direction,
          )
        : this.gameState.collisionSystem.canMoveTo(
            player.position.x,
            player.position.y,
            direction,
            bombPositions,
            playerPositions,
          );

      if (newPos) {
        player.position = newPos;
        player.applyMoveCooldown();
        const newTile = this.gameState.collisionSystem.getTileAt(newPos.x, newPos.y);
        if (newTile !== 'ice') {
          this.iceSliding.delete(playerId); // Reached non-ice tile, stop sliding
        }
        // Apply teleporter if landed on one
        this.gameState.applyTeleporter(player);
      } else {
        this.iceSliding.delete(playerId); // Blocked, stop sliding
      }
    }

    // Detect enemies who just moved onto ice
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || enemy.typeConfig.canPassWalls) continue;
      if (this.enemyIceSliding.has(enemy.id)) continue;
      const tile = this.gameState.collisionSystem.getTileAt(enemy.position.x, enemy.position.y);
      if (tile !== 'ice') continue;
      const prevKey = this.prevEnemyPositions.get(enemy.id);
      const curKey = `${enemy.position.x},${enemy.position.y}`;
      if (prevKey !== curKey) {
        this.enemyIceSliding.set(enemy.id, enemy.direction);
      }
    }

    // Process enemy ice sliding
    for (const [enemyId, direction] of this.enemyIceSliding) {
      const enemy = this.enemies.get(enemyId);
      if (!enemy || !enemy.alive) {
        this.enemyIceSliding.delete(enemyId);
        continue;
      }

      const newPos = this.gameState.collisionSystem.canMoveTo(
        enemy.position.x,
        enemy.position.y,
        direction,
        enemy.typeConfig.canPassBombs ? [] : bombPositions,
      );

      if (newPos) {
        enemy.position = newPos;
        enemy.applyMoveCooldown();
        const newTile = this.gameState.collisionSystem.getTileAt(newPos.x, newPos.y);
        if (newTile !== 'ice') {
          this.enemyIceSliding.delete(enemyId);
        }
      } else {
        this.enemyIceSliding.delete(enemyId);
      }
    }

    // Ice affects kicked bombs: sliding bombs on ice move an extra tile
    for (const bomb of this.gameState.bombs.values()) {
      if (!bomb.sliding) continue;
      const tile = this.gameState.collisionSystem.getTileAt(bomb.position.x, bomb.position.y);
      if (tile !== 'ice') continue;

      // Advance bomb one extra tile in sliding direction
      const dx = bomb.sliding === 'left' ? -1 : bomb.sliding === 'right' ? 1 : 0;
      const dy = bomb.sliding === 'up' ? -1 : bomb.sliding === 'down' ? 1 : 0;
      const nextX = bomb.position.x + dx;
      const nextY = bomb.position.y + dy;
      if (this.gameState.collisionSystem.isWalkable(nextX, nextY)) {
        // Check for other bombs blocking
        let blocked = false;
        for (const other of this.gameState.bombs.values()) {
          if (other.id !== bomb.id && other.position.x === nextX && other.position.y === nextY) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          bomb.position = { x: nextX, y: nextY };
        }
      }
    }
  }

  private processLavaDetonation(): void {
    for (const bomb of this.gameState.bombs.values()) {
      const { x, y } = bomb.position;
      const adjacent: TileType[] = [
        this.gameState.collisionSystem.getTileAt(x - 1, y),
        this.gameState.collisionSystem.getTileAt(x + 1, y),
        this.gameState.collisionSystem.getTileAt(x, y - 1),
        this.gameState.collisionSystem.getTileAt(x, y + 1),
      ];
      if (adjacent.some((t) => t === 'lava')) {
        // Force immediate detonation on next tick's bomb processing
        bomb.ticksRemaining = Math.min(bomb.ticksRemaining, 1);
      }
    }
  }

  private processSpikeTiles(): void {
    if (this.spikePositions.length === 0) return;

    const prevPhase = this.spikePhase;
    this.spikePhase = (this.spikePhase + 1) % SPIKE_CYCLE_TICKS;

    // Transition from safe to lethal
    if (prevPhase < SPIKE_SAFE_TICKS && this.spikePhase >= SPIKE_SAFE_TICKS) {
      for (const pos of this.spikePositions) {
        this.gameState.setTileTracked(pos.x, pos.y, 'spikes_active');
      }
    }

    // Transition from lethal to safe (wrap around)
    if (prevPhase >= SPIKE_SAFE_TICKS && this.spikePhase < SPIKE_SAFE_TICKS) {
      for (const pos of this.spikePositions) {
        this.gameState.setTileTracked(pos.x, pos.y, 'spikes');
      }
    }

    // Kill entities on active spikes
    if (this.spikePhase >= SPIKE_SAFE_TICKS) {
      for (const player of this.gameState.players.values()) {
        if (!player.alive || player.isBuddy || player.invulnerableTicks > 0 || player.frozen)
          continue;
        const tile = this.gameState.collisionSystem.getTileAt(player.position.x, player.position.y);
        if (tile === 'spikes_active') {
          if (player.hasShield) {
            player.hasShield = false;
            player.invulnerableTicks = 10;
          } else {
            this.handlePlayerDeath(player.id);
          }
        }
      }

      for (const enemy of this.enemies.values()) {
        if (!enemy.alive || enemy.typeConfig.canPassWalls) continue;
        const tile = this.gameState.collisionSystem.getTileAt(enemy.position.x, enemy.position.y);
        if (tile === 'spikes_active') {
          const died = enemy.takeDamage(1);
          if (died) this.onEnemyDied(enemy);
        }
      }
    }
  }

  private processDarkRiftTiles(): void {
    // Players
    for (const player of this.gameState.players.values()) {
      if (!player.alive || player.frozen) continue;
      const tile = this.gameState.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile !== 'dark_rift') continue;

      // Only teleport if player just moved here (not standing still)
      const prevKey = this.prevPlayerPositions.get(player.id);
      const curKey = `${player.position.x},${player.position.y}`;
      if (prevKey === curKey) continue;

      // Find all empty tiles for random teleport destination
      const emptyTiles: Position[] = [];
      for (let y = 0; y < this.gameState.map.height; y++) {
        for (let x = 0; x < this.gameState.map.width; x++) {
          const t = this.gameState.collisionSystem.getTileAt(x, y);
          if (
            (t === 'empty' || t === 'spawn') &&
            !(x === player.position.x && y === player.position.y)
          ) {
            emptyTiles.push({ x, y });
          }
        }
      }
      if (emptyTiles.length > 0) {
        const dest = emptyTiles[Math.floor(this.rng.next() * emptyTiles.length)];
        player.position = { x: dest.x, y: dest.y };
        player.applyMoveCooldown();
      }
    }

    // Enemies
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive || enemy.typeConfig.canPassWalls) continue;
      const tile = this.gameState.collisionSystem.getTileAt(enemy.position.x, enemy.position.y);
      if (tile !== 'dark_rift') continue;

      const prevKey = this.prevEnemyPositions.get(enemy.id);
      const curKey = `${enemy.position.x},${enemy.position.y}`;
      if (prevKey === curKey) continue;

      const emptyTiles: Position[] = [];
      for (let y = 0; y < this.gameState.map.height; y++) {
        for (let x = 0; x < this.gameState.map.width; x++) {
          const t = this.gameState.collisionSystem.getTileAt(x, y);
          if (
            (t === 'empty' || t === 'spawn') &&
            !(x === enemy.position.x && y === enemy.position.y)
          ) {
            emptyTiles.push({ x, y });
          }
        }
      }
      if (emptyTiles.length > 0) {
        const dest = emptyTiles[Math.floor(this.rng.next() * emptyTiles.length)];
        enemy.position = { x: dest.x, y: dest.y };
        enemy.applyMoveCooldown();
      }
    }
  }
}
