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
import { processEnemyAI } from './EnemyAI';
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
      const enemy = new Enemy(typeId, { x: placement.x, y: placement.y }, configCopy, placement.patrolPath);
      this.enemies.set(enemy.id, enemy);
    }

    // Place visible power-ups on the map
    for (const pp of level.powerupPlacements) {
      if (pp.hidden) {
        this.hiddenPowerups.set(`${pp.x},${pp.y}`, pp.type);
      } else {
        this.gameState.spawnPowerUpAt(pp.x, pp.y, pp.type);
      }
    }

    // Create game loop
    this.gameLoop = new GameLoop(
      this.gameState,
      (state) => this.onTick(state),
      () => this.onTimeUp(),
      TICK_RATE,
    );
  }

  start(): void {
    this.startTick = this.gameState.tick;
    this.gameLoop.start();
  }

  stop(): void {
    this.gameLoop.stop();
    this.finished = true;
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
    // Deep copy tiles
    const tiles: TileType[][] = level.tiles.map((row) => [...row]);

    return {
      width: level.mapWidth,
      height: level.mapHeight,
      tiles,
      spawnPoints: [...level.playerSpawns],
      seed: Date.now(),
    };
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
        const result = processEnemyAI(
          enemy,
          Array.from(this.gameState.players.values()),
          this.gameState.collisionSystem,
          bombPositions,
          this.gameState.map.tiles,
          () => this.rng.next(),
        );

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
          }
        }
      }
    }

    // 8. Win condition check
    this.checkWinCondition(player);
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

  private checkWinCondition(player: Player): void {
    switch (this.level.winCondition) {
      case 'kill_all': {
        if (this.enemies.size === 0) break; // No enemies to kill
        const allDead = Array.from(this.enemies.values()).every((e) => !e.alive);
        if (allDead) this.completeLevelInternal();
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
            this.completeLevelInternal();
          }
        }
        break;
      }
      case 'reach_goal': {
        if (player.alive && this.level.winConditionConfig?.goalPosition) {
          const gp = this.level.winConditionConfig.goalPosition;
          if (player.position.x === gp.x && player.position.y === gp.y) {
            this.completeLevelInternal();
          }
        }
        break;
      }
      case 'survive_time': {
        const targetTicks = this.level.winConditionConfig?.surviveTimeTicks;
        if (targetTicks != null && this.gameState.tick - this.startTick >= targetTicks) {
          this.completeLevelInternal();
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
