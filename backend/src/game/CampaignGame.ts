import {
  CampaignLevel,
  CampaignGameState,
  CampaignEnemyState,
  EnemyTypeConfig,
  StartingPowerUps,
  PlayerInput,
  Position,
  GameMap,
  TileType,
  PowerUpType,
  Direction,
} from '@blast-arena/shared';
import {
  TICK_RATE,
  CAMPAIGN_RESPAWN_TICKS,
  CAMPAIGN_RESPAWN_INVULNERABILITY,
} from '@blast-arena/shared';
import { GameStateManager, GameConfig } from './GameState';
import { GameLoop } from './GameLoop';
import { Enemy } from './Enemy';
import { Player } from './Player';
import { Bomb } from './Bomb';
import { processEnemyAI, IEnemyAI, EnemyAIContext, EnemyAIResult } from './EnemyAI';
import { getEnemyAIRegistry } from './registry';
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
  onPlayerDied: (livesRemaining: number, respawnPosition: Position) => void;
  onEnemyDied: (enemyId: number, position: Position, isBoss: boolean) => void;
  onExitOpened: (position: Position) => void;
  onLevelComplete: (timeSeconds: number, deaths: number) => void;
  onGameOver: (reason: string) => void;
}

export class CampaignGame {
  public readonly sessionId: string;
  public readonly userId: number;
  public readonly level: CampaignLevel;

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
  private respawnTick: number | null = null;
  private respawnPosition: Position;
  private finished: boolean = false;
  private startTick: number = 0;

  // Hidden power-ups: revealed when the wall at that position is destroyed
  private hiddenPowerups: Map<string, PowerUpType> = new Map();

  // Enemy bombs tracked separately (they participate in standard bomb mechanics)
  private enemyBombIds: Set<string> = new Set();

  // Custom AI instances per enemy
  private enemyAIs: Map<number, IEnemyAI> = new Map();

  // Grace period: ticks remaining after win condition before level complete
  private static readonly GRACE_TICKS = 30; // 1.5s at 20 tick/sec
  private completionTick: number | null = null;

  constructor(
    userId: number,
    level: CampaignLevel,
    enemyTypes: Map<number, EnemyTypeConfig>,
    callbacks: CampaignSessionCallbacks,
    carriedPowerups?: StartingPowerUps | null,
  ) {
    this.sessionId = uuidv4();
    this.userId = userId;
    this.level = level;
    this.enemyTypes = enemyTypes;
    this.callbacks = callbacks;
    this.lives = level.lives;
    this.maxLives = level.lives;
    this.respawnPosition = level.playerSpawns[0] ?? { x: 1, y: 1 };
    this.rng = new SeededRandom(Date.now());

    Enemy.resetIdCounter();

    // Build GameMap from level tiles
    const gameMap = this.buildGameMap(level);

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
    };

    this.gameState = new GameStateManager(gameConfig);

    // Add human player
    const player = this.gameState.addPlayer(userId, 'Player', null);

    // Apply starting power-ups (level-defined or carried over)
    const startPowerups = carriedPowerups ?? level.startingPowerups;
    if (startPowerups && player) {
      this.applyStartingPowerups(player, startPowerups);
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

    // Place visible power-ups on the map
    for (const pp of level.powerupPlacements) {
      if (pp.hidden) {
        this.hiddenPowerups.set(`${pp.x},${pp.y}`, pp.type);
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

  handleInput(input: PlayerInput): void {
    this.gameState.inputBuffer.addInput(this.userId, input);
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
    let spawnPoints = [...level.playerSpawns];
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
      spawnPoints = [{ x: 1, y: 1 }];
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
    const player = this.gameState.players.get(this.userId);
    if (!player) return;

    const tick = this.gameState.tick;

    // 1. Handle player respawn
    if (this.respawnTick != null && tick >= this.respawnTick) {
      player.respawn(this.respawnPosition);
      player.invulnerableTicks = CAMPAIGN_RESPAWN_INVULNERABILITY;
      this.respawnTick = null;

      // Re-apply carried/starting powerups on respawn
      const startPowerups = this.level.startingPowerups;
      if (startPowerups) this.applyStartingPowerups(player, startPowerups);
    }

    // 2. Enemy AI + movement
    const bombPositions = Array.from(this.gameState.bombs.values()).map((b) => b.position);
    for (const enemy of this.enemies.values()) {
      if (!enemy.alive) continue;
      enemy.tick();

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

    // 4. Player-enemy contact collision
    if (player.alive && player.invulnerableTicks <= 0) {
      for (const enemy of this.enemies.values()) {
        if (!enemy.alive || !enemy.typeConfig.contactDamage) continue;
        if (enemy.position.x === player.position.x && enemy.position.y === player.position.y) {
          this.onPlayerDied();
          break;
        }
      }
    }

    // 5. Check if player was killed by explosion (handled by gameState.processTick)
    if (!player.alive && this.respawnTick == null) {
      this.onPlayerDied();
    }

    // 6. Hidden power-up reveals
    for (const [key, type] of this.hiddenPowerups) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      const tile = this.gameState.collisionSystem.getTileAt(x, y);
      if (tile === 'empty' || tile === 'spawn') {
        this.gameState.spawnPowerUpAt(x, y, type);
        this.hiddenPowerups.delete(key);
      }
    }

    // 7. Boss phase transitions
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
    this.checkWinCondition(player);

    // 9. Grace period after win — let final explosions/effects play out
    if (this.completionTick !== null) {
      if (tick >= this.completionTick + CampaignGame.GRACE_TICKS) {
        this.completeLevelInternal();
      }
    }
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
        }
      } else if (newPos) {
        enemy.position = newPos;
        enemy.direction = direction;
        enemy.applyMoveCooldown();
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

  private onPlayerDied(): void {
    const player = this.gameState.players.get(this.userId);
    if (!player) return;

    // Player might already be handled
    if (!player.alive && this.respawnTick != null) return;

    if (player.alive) {
      player.die();
    }
    this.playerDeaths++;
    this.lives--;

    if (this.lives <= 0) {
      this.gameOverInternal('No lives remaining!');
      return;
    }

    this.respawnTick = this.gameState.tick + CAMPAIGN_RESPAWN_TICKS;
    this.callbacks.onPlayerDied(this.lives, this.respawnPosition);
  }

  private triggerCompletion(): void {
    if (this.completionTick === null) {
      this.completionTick = this.gameState.tick;
    }
  }

  private checkWinCondition(player: Player): void {
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

        // Check if player is on exit
        if (this.exitOpen && player.alive && this.level.winConditionConfig?.exitPosition) {
          const ep = this.level.winConditionConfig.exitPosition;
          if (player.position.x === ep.x && player.position.y === ep.y) {
            this.triggerCompletion();
          }
        }
        break;
      }
      case 'reach_goal': {
        if (player.alive && this.level.winConditionConfig?.goalPosition) {
          const gp = this.level.winConditionConfig.goalPosition;
          if (player.position.x === gp.x && player.position.y === gp.y) {
            this.triggerCompletion();
          }
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

    return {
      gameState: state,
      enemies,
      lives: this.lives,
      maxLives: this.maxLives,
      levelId: this.level.id,
      exitOpen: this.exitOpen,
    };
  }
}
