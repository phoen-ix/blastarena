import {
  GameState,
  TileType,
  ReplayData,
  ReplayFrame,
  ReplayTickEvents,
  TICK_RATE,
} from '@blast-arena/shared';

const TICK_MS = 1000 / TICK_RATE; // 50ms

export interface ReplayCallbacks {
  onFrame: (state: GameState) => void;
  onTickEvents: (events: ReplayTickEvents) => void;
  onLogUpdate: (tick: number) => void;
  onComplete: () => void;
  onStateChange: (playing: boolean, speed: number) => void;
}

export class ReplayPlayer {
  private replayData: ReplayData;
  private currentFrame: number = 0;
  private _isPlaying: boolean = false;
  private _speed: number = 1;
  private playbackInterval: number | null = null;
  private callbacks: ReplayCallbacks;

  // Tile state for reconstruction
  private initialTiles: TileType[][];
  private currentTiles: TileType[][];

  // Precomputed frame-to-index for tile diffs
  private tileDiffFrames: Set<number>;

  constructor(replayData: ReplayData, callbacks: ReplayCallbacks) {
    this.replayData = replayData;
    this.callbacks = callbacks;

    // Deep copy initial tiles
    this.initialTiles = replayData.map.tiles.map((row) => [...row]);
    this.currentTiles = replayData.map.tiles.map((row) => [...row]);

    // Index which frames have tile diffs for seek optimization
    this.tileDiffFrames = new Set();
    for (let i = 0; i < replayData.frames.length; i++) {
      if (replayData.frames[i].tileDiffs) {
        this.tileDiffFrames.add(i);
      }
    }
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get speed(): number {
    return this._speed;
  }

  play(): void {
    if (this._isPlaying) return;
    if (this.currentFrame >= this.getTotalFrames() - 1) return;

    this._isPlaying = true;
    this.startInterval();
    this.callbacks.onStateChange(true, this._speed);
  }

  pause(): void {
    if (!this._isPlaying) return;
    this._isPlaying = false;
    this.stopInterval();
    this.callbacks.onStateChange(false, this._speed);
  }

  togglePlayPause(): void {
    if (this._isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setSpeed(speed: number): void {
    this._speed = speed;
    if (this._isPlaying) {
      this.stopInterval();
      this.startInterval();
    }
    this.callbacks.onStateChange(this._isPlaying, this._speed);
  }

  seekTo(frame: number): void {
    const target = Math.max(0, Math.min(frame, this.getTotalFrames() - 1));

    if (target < this.currentFrame) {
      // Seeking backward: rebuild tiles from scratch
      this.currentTiles = this.initialTiles.map((row) => [...row]);
      for (let i = 0; i <= target; i++) {
        this.applyTileDiffs(i);
      }
    } else if (target > this.currentFrame) {
      // Seeking forward: apply diffs from current to target
      for (let i = this.currentFrame + 1; i <= target; i++) {
        this.applyTileDiffs(i);
      }
    }

    this.currentFrame = target;
    this.emitCurrentFrame();
  }

  stepForward(): void {
    if (this.currentFrame < this.getTotalFrames() - 1) {
      this.seekTo(this.currentFrame + 1);
    }
  }

  stepBackward(): void {
    if (this.currentFrame > 0) {
      this.seekTo(this.currentFrame - 1);
    }
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  getTotalFrames(): number {
    return this.replayData.frames.length;
  }

  getCurrentTime(): number {
    if (this.replayData.frames.length === 0) return 0;
    return this.replayData.frames[this.currentFrame].timeElapsed;
  }

  getTotalTime(): number {
    if (this.replayData.frames.length === 0) return 0;
    return this.replayData.frames[this.replayData.frames.length - 1].timeElapsed;
  }

  getReplayData(): ReplayData {
    return this.replayData;
  }

  destroy(): void {
    this.stopInterval();
  }

  private startInterval(): void {
    const intervalMs = TICK_MS / this._speed;
    this.playbackInterval = window.setInterval(() => {
      this.advanceFrame();
    }, intervalMs);
  }

  private stopInterval(): void {
    if (this.playbackInterval !== null) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  private advanceFrame(): void {
    if (this.currentFrame >= this.getTotalFrames() - 1) {
      this.pause();
      this.callbacks.onComplete();
      return;
    }

    this.currentFrame++;
    this.applyTileDiffs(this.currentFrame);
    this.emitCurrentFrame();
  }

  private applyTileDiffs(frameIndex: number): void {
    if (!this.tileDiffFrames.has(frameIndex)) return;
    const diffs = this.replayData.frames[frameIndex].tileDiffs;
    if (!diffs) return;
    for (const diff of diffs) {
      this.currentTiles[diff.y][diff.x] = diff.type;
    }
  }

  private emitCurrentFrame(): void {
    const frame = this.replayData.frames[this.currentFrame];

    // Reconstruct full GameState by injecting current tiles into stored map
    const state: GameState = {
      tick: frame.tick,
      players: frame.players,
      bombs: frame.bombs,
      explosions: frame.explosions,
      powerUps: frame.powerUps,
      map: {
        ...this.replayData.map,
        tiles: this.currentTiles,
      },
      status: frame.status,
      winnerId: frame.winnerId,
      winnerTeam: frame.winnerTeam,
      roundTime: frame.roundTime,
      timeElapsed: frame.timeElapsed,
    };

    if (frame.zone) state.zone = frame.zone;
    if (frame.hillZone) state.hillZone = frame.hillZone;
    if (frame.kothScores) state.kothScores = frame.kothScores;
    if (frame.mapEvents) state.mapEvents = frame.mapEvents;

    this.callbacks.onFrame(state);
    this.callbacks.onLogUpdate(frame.tick);

    // Emit tick events for effects
    if (frame.events) {
      this.callbacks.onTickEvents(frame.events);
    }
  }
}
