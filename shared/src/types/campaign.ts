import { Position, Direction, TileType, PowerUpType, GameState } from './game';

// --- Enemy Configuration ---

export type EnemyMovementPattern =
  | 'random_walk'
  | 'chase_player'
  | 'patrol_path'
  | 'wall_follow'
  | 'stationary';

export type EnemyBodyShape = 'blob' | 'spiky' | 'ghost' | 'robot' | 'bug' | 'skull';
export type EnemyEyeStyle = 'round' | 'angry' | 'sleepy' | 'crazy';

export interface EnemySpriteConfig {
  bodyShape: EnemyBodyShape;
  primaryColor: string;
  secondaryColor: string;
  eyeStyle: EnemyEyeStyle;
  hasTeeth: boolean;
  hasHorns: boolean;
}

export interface EnemyBombConfig {
  fireRange: number;
  cooldownTicks: number;
  trigger: 'timer' | 'proximity' | 'random';
  proximityRange?: number;
}

export interface BossPhaseConfig {
  hpThreshold: number;
  speedMultiplier?: number;
  movementPattern?: EnemyMovementPattern;
  canBomb?: boolean;
  bombConfig?: EnemyBombConfig;
  spawnEnemies?: { enemyTypeId: number; count: number }[];
}

export interface EnemyTypeConfig {
  speed: number;
  movementPattern: EnemyMovementPattern;
  canPassWalls: boolean;
  canPassBombs: boolean;
  canBomb: boolean;
  bombConfig?: EnemyBombConfig;
  hp: number;
  contactDamage: boolean;
  sprite: EnemySpriteConfig;
  dropChance: number;
  dropTable: PowerUpType[];
  isBoss: boolean;
  sizeMultiplier: number;
  bossPhases?: BossPhaseConfig[];
  enemyAiId?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
}

export interface EnemyTypeEntry {
  id: number;
  name: string;
  description: string;
  config: EnemyTypeConfig;
  isBoss: boolean;
  createdAt: string;
}

// --- Level Configuration ---

export type CampaignWinCondition = 'kill_all' | 'find_exit' | 'reach_goal' | 'survive_time';

export interface WinConditionConfig {
  exitPosition?: Position;
  goalPosition?: Position;
  surviveTimeTicks?: number;
  killTarget?: number;
}

export interface EnemyPlacement {
  enemyTypeId: number;
  x: number;
  y: number;
  patrolPath?: Position[];
}

export interface PowerUpPlacement {
  type: PowerUpType;
  x: number;
  y: number;
  hidden: boolean;
}

export interface StartingPowerUps {
  bombUp?: number;
  fireUp?: number;
  speedUp?: number;
  shield?: boolean;
  kick?: boolean;
  pierceBomb?: boolean;
  remoteBomb?: boolean;
  lineBomb?: boolean;
}

export interface CampaignLevel {
  id: number;
  worldId: number;
  name: string;
  description: string;
  sortOrder: number;
  mapWidth: number;
  mapHeight: number;
  tiles: TileType[][];
  fillMode: 'handcrafted' | 'hybrid';
  wallDensity: number;
  playerSpawns: Position[];
  enemyPlacements: EnemyPlacement[];
  powerupPlacements: PowerUpPlacement[];
  winCondition: CampaignWinCondition;
  winConditionConfig: WinConditionConfig | null;
  lives: number;
  timeLimit: number;
  parTime: number; // seconds, 0 = no par time; star calc: 3=zero deaths, 2=under par, 1=completed
  carryOverPowerups: boolean;
  startingPowerups: StartingPowerUps | null;
  availablePowerupTypes: PowerUpType[] | null;
  powerupDropRate: number;
  reinforcedWalls: boolean;
  hazardTiles: boolean;
  isPublished: boolean;
}

// --- World ---

export interface CampaignWorld {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  theme: string;
  isPublished: boolean;
  levelCount?: number;
  completedCount?: number;
}

export interface CampaignLevelSummary {
  id: number;
  worldId: number;
  name: string;
  description: string;
  sortOrder: number;
  mapWidth: number;
  mapHeight: number;
  winCondition: CampaignWinCondition;
  lives: number;
  timeLimit: number;
  parTime: number;
  enemyCount: number;
  isPublished: boolean;
  progress?: LevelProgress;
}

// --- Player Progress ---

export interface LevelProgress {
  levelId: number;
  completed: boolean;
  bestTimeSeconds: number | null;
  stars: number;
  attempts: number;
}

export interface CampaignUserState {
  currentWorldId: number | null;
  currentLevelId: number | null;
  carriedPowerups: StartingPowerUps | null;
  totalLevelsCompleted: number;
  totalStars: number;
}

// --- Runtime State (sent via socket each tick) ---

export interface CampaignEnemyState {
  id: number;
  enemyTypeId: number;
  position: Position;
  hp: number;
  maxHp: number;
  alive: boolean;
  direction: Direction;
  isBoss: boolean;
  currentPhase?: number;
}

export interface CampaignGameState {
  gameState: GameState;
  enemies: CampaignEnemyState[];
  lives: number;
  maxLives: number;
  levelId: number;
  exitOpen: boolean;
  coopMode: boolean;
  buddyMode?: boolean;
  respawnTimers?: Record<number, number>; // playerId → ticks remaining until respawn
  lockedInPlayers?: number[]; // playerIds frozen on exit/goal tile
}

// --- Export/Import Formats ---

export interface LevelExportData {
  _format: 'blast-arena-level';
  _version: 1;
  name: string;
  description: string;
  mapWidth: number;
  mapHeight: number;
  tiles: TileType[][];
  fillMode: string;
  wallDensity: number;
  playerSpawns: Position[];
  enemyPlacements: EnemyPlacement[];
  powerupPlacements: PowerUpPlacement[];
  winCondition: CampaignWinCondition;
  winConditionConfig: WinConditionConfig | null;
  lives: number;
  timeLimit: number;
  parTime: number;
  carryOverPowerups: boolean;
  startingPowerups: StartingPowerUps | null;
  availablePowerupTypes: PowerUpType[] | null;
  powerupDropRate: number;
  reinforcedWalls: boolean;
  hazardTiles: boolean;
}

export interface EnemyTypeExportData {
  _format: 'blast-arena-enemy-type';
  _version: 1 | 2;
  name: string;
  description: string;
  config: EnemyTypeConfig;
  enemyAiSource?: string;
  enemyAiName?: string;
}

export interface LevelBundleExportData {
  _format: 'blast-arena-level-bundle';
  _version: 1 | 2;
  level: Omit<LevelExportData, '_format' | '_version'>;
  enemyTypes: {
    originalId: number;
    name: string;
    description: string;
    config: EnemyTypeConfig;
    enemyAiSource?: string;
    enemyAiName?: string;
  }[];
}

export interface ImportConflict {
  originalId: number;
  name: string;
  existingId?: number;
  existingName?: string;
}

export interface EnemyAIImportConflict {
  aiName: string;
  existingId?: string;
  existingName?: string;
}

// --- Co-Op Types ---

export interface CoopStartData {
  state: CampaignGameState;
  level: CampaignLevelSummary;
  enemyTypes: EnemyTypeConfig[];
}

// --- Buddy Mode ---

export interface BuddySettings {
  name: string; // max 20 chars
  color: string; // hex '#rrggbb'
  size: number; // 0.40 to 0.80
}
