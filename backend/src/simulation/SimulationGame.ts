import { GAME_MODES, TICK_RATE, MAX_SPEED, SimulationConfig, SimulationGameResult } from '@blast-arena/shared';
import { GameStateManager } from '../game/GameState';
import { GameLogger } from '../utils/gameLogger';
import { ReplayRecorder } from '../utils/replayRecorder';
import { logger } from '../utils/logger';

const TICKS_PER_BATCH = 100;
const SPECTATE_INTERVAL_MS = 50; // ~20fps

const BOT_NAMES = [
  'AlphaBot',
  'BlazeBot',
  'CrushBot',
  'DynBot',
  'EchoBot',
  'FluxBot',
  'GridBot',
  'HexBot',
  'IronBot',
  'JetBot',
  'KiloBot',
  'LuxBot',
  'MagBot',
  'NeonBot',
  'OmniBot',
  'PulseBot',
];

export class SimulationGame {
  private gameState: GameStateManager;
  private gameLogger: GameLogger;
  private replayRecorder: ReplayRecorder | null = null;
  private config: SimulationConfig;
  private gameIndex: number;
  private logDir: string;
  private mapSeed: number;
  private cancelled: boolean = false;
  private onStateUpdate: ((state: ReturnType<GameStateManager['toState']>) => void) | null = null;

  constructor(config: SimulationConfig, gameIndex: number, logDir: string, mapSeed: number) {
    this.config = config;
    this.gameIndex = gameIndex;
    this.logDir = logDir;
    this.mapSeed = mapSeed;

    const modeConfig = GAME_MODES[config.gameMode];

    this.gameState = new GameStateManager({
      mapWidth: config.mapWidth,
      mapHeight: config.mapHeight,
      mapSeed: mapSeed,
      gameMode: config.gameMode,
      hasZone: modeConfig.hasZone || false,
      roundTime: config.roundTime,
      wallDensity: config.wallDensity,
      enabledPowerUps: config.enabledPowerUps,
      powerUpDropRate: config.powerUpDropRate,
      friendlyFire: config.friendlyFire,
      botDifficulty: config.botDifficulty,
      reinforcedWalls: config.reinforcedWalls,
      enableMapEvents: config.enableMapEvents,
    });

    // Add bots
    const botTeams = config.botTeams || [];
    let playerIndex = 0;
    for (let i = 0; i < config.botCount; i++) {
      const botId = -(i + 1);
      const botName = BOT_NAMES[i % BOT_NAMES.length];
      const team = modeConfig.teamsCount
        ? botTeams[i] !== null && botTeams[i] !== undefined
          ? botTeams[i]!
          : playerIndex % modeConfig.teamsCount
        : null;
      this.gameState.addPlayer(botId, botName, team, true);
      playerIndex++;
    }

    // Sudden Death: boost all players with max stats
    if (config.gameMode === 'sudden_death') {
      for (const player of this.gameState.players.values()) {
        player.maxBombs = 8;
        player.fireRange = 8;
        player.speed = MAX_SPEED;
        player.hasKick = true;
      }
    }

    // Create logger
    const simNum = String(gameIndex + 1).padStart(3, '0');
    this.gameLogger = new GameLogger(`sim_${simNum}`, config.gameMode, config.botCount, {
      logDir,
      filename: `sim_${simNum}.jsonl`,
      verbosity: config.logVerbosity,
    });
    this.gameState.gameLogger = this.gameLogger;

    // Log player roster
    for (const p of this.gameState.players.values()) {
      this.gameLogger.log('player', {
        id: p.id,
        name: p.username,
        isBot: p.isBot,
        team: p.team,
        spawn: p.position,
      });
    }
    this.gameLogger.log('config', {
      mapSize: `${this.gameState.map.width}x${this.gameState.map.height}`,
      seed: this.gameState.map.seed,
      botDifficulty: config.botDifficulty,
      wallDensity: config.wallDensity,
      roundTime: config.roundTime,
      friendlyFire: config.friendlyFire,
      powerUpDropRate: config.powerUpDropRate,
      reinforcedWalls: config.reinforcedWalls,
      enableMapEvents: config.enableMapEvents,
      logVerbosity: config.logVerbosity,
    });

    // Set up replay recorder (conditional on config)
    if (config.recordReplays !== false) {
      this.replayRecorder = new ReplayRecorder(`sim_${simNum}`, config.gameMode, this.gameState.toState());
      this.replayRecorder.setMatchId(gameIndex);
      this.gameLogger.replayRecorder = this.replayRecorder;
    }
  }

  setStateCallback(cb: (state: ReturnType<GameStateManager['toState']>) => void): void {
    this.onStateUpdate = cb;
  }

  private isFinished(): boolean {
    return this.gameState.status === 'finished';
  }

  async runFast(): Promise<SimulationGameResult> {
    // Skip countdown for fast mode (bots don't need it)
    this.gameState.status = 'playing';

    let lastBroadcast = Date.now();

    while (!this.isFinished() && !this.cancelled) {
      for (let i = 0; i < TICKS_PER_BATCH; i++) {
        this.gameState.processTick();
        this.replayRecorder?.recordTick(this.gameState.toState(), this.gameState.tickEvents);
        if (this.isFinished()) break;
      }

      // Stream state at capped framerate for spectators
      if (this.onStateUpdate) {
        const now = Date.now();
        if (now - lastBroadcast >= SPECTATE_INTERVAL_MS) {
          this.onStateUpdate(this.gameState.toState());
          lastBroadcast = now;
        }
      }

      // Yield to event loop
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    // Final state broadcast
    if (this.onStateUpdate) {
      this.onStateUpdate(this.gameState.toState());
    }

    return this.finalize();
  }

  async runRealtime(): Promise<SimulationGameResult> {
    const tickMs = 1000 / TICK_RATE;
    const countdownTicks = Math.round(1.8 * TICK_RATE); // 36 ticks
    let countdownRemaining = countdownTicks;

    return new Promise<SimulationGameResult>((resolve) => {
      const interval = setInterval(() => {
        try {
          if (this.cancelled) {
            clearInterval(interval);
            resolve(this.finalize());
            return;
          }

          // Countdown phase
          if (countdownRemaining > 0) {
            countdownRemaining--;
            if (countdownRemaining <= 0) {
              this.gameState.status = 'playing';
            }
            const state = this.gameState.toState();
            this.replayRecorder?.recordTick(state, this.gameState.tickEvents);
            this.onStateUpdate?.(state);
            return;
          }

          this.gameState.processTick();
          const state = this.gameState.toState();
          this.replayRecorder?.recordTick(state, this.gameState.tickEvents);
          this.onStateUpdate?.(state);

          if (this.gameState.status === 'finished') {
            clearInterval(interval);
            resolve(this.finalize());
          }
        } catch (err) {
          logger.error({ err }, 'Simulation game tick error');
          clearInterval(interval);
          resolve(this.finalize());
        }
      }, tickMs);
    });
  }

  getState(): ReturnType<GameStateManager['toState']> {
    return this.gameState.toState();
  }

  getTick(): number {
    return this.gameState.tick;
  }

  getMaxTicks(): number {
    return (this.config.roundTime || 180) * TICK_RATE;
  }

  cancel(): void {
    this.cancelled = true;
  }

  private finalize(): SimulationGameResult {
    const placements = Array.from(this.gameState.players.values())
      .map((p) => ({
        id: p.id,
        name: p.username,
        kills: p.kills,
        selfKills: p.selfKills,
        deaths: p.deaths,
        placement: p.placement || 0,
        alive: p.alive,
        team: p.team,
        bombsPlaced: p.bombsPlaced,
        powerupsCollected: p.powerupsCollected,
      }))
      .sort((a, b) => b.kills - a.kills || a.placement - b.placement);

    const winner = this.gameState.winnerId
      ? this.gameState.players.get(this.gameState.winnerId)
      : null;

    const result: SimulationGameResult = {
      gameIndex: this.gameIndex,
      winnerId: this.gameState.winnerId,
      winnerName: winner?.username || null,
      finishReason: this.gameState.finishReason || (this.cancelled ? 'Cancelled' : 'Unknown'),
      durationTicks: this.gameState.tick,
      durationSeconds: Math.floor(this.gameState.tick / TICK_RATE),
      mapSeed: this.mapSeed,
      placements,
      hasReplay: this.replayRecorder !== null,
    };

    this.gameLogger.logGameOver(this.gameState.winnerId, placements);

    // Save replay to batch log directory
    if (this.replayRecorder) {
      this.replayRecorder.finalize(
        {
          winnerId: this.gameState.winnerId,
          winnerTeam: this.gameState.winnerTeam,
          reason: result.finishReason,
          placements,
        },
        { saveDir: this.logDir },
      );
    }

    return result;
  }
}
