import ivm from 'isolated-vm';
import type { PlayerInput } from '@blast-arena/shared';
import type { EnemyAIContext, EnemyAIResult, IEnemyAI } from '../game/EnemyAI';
import type { Player } from '../game/Player';
import type { GameStateManager } from '../game/GameState';
import type { IBotAI } from '../game/BotAI';
import type { GameLogger } from '../utils/gameLogger';

/**
 * Runs UNTRUSTED (admin-uploaded) bot/enemy AI code inside an `isolated-vm` V8 isolate.
 *
 * Why: the previous `vm.runInContext` sandbox is not a real boundary — passing live host objects
 * (player/state) to the AI at runtime lets it walk `obj.constructor.constructor('return process')()`
 * into the host realm, and a synchronous infinite loop hangs the 20Hz game loop (audit C1). An
 * isolate has its own V8 heap with no `require`/`process`/host realm reachable, and `applySync`
 * enforces a hard per-call CPU timeout + memory limit.
 *
 * The documented live-object bot API (`state.collisionSystem.canMoveTo(...)`, `player.canMove()`,
 * Maps of players/bombs, etc.) is preserved by reconstructing those objects from a plain JSON
 * snapshot inside a "guest runtime" — so execution (including the 40+ `canMoveTo` calls per
 * decision) stays in-isolate with no per-call host boundary crossing. Only the built-in BotAI and
 * the trusted seeded enemy AIs run in-process; this isolate path is only for untrusted uploads.
 */

/** Hard per-call CPU timeout. Generous vs. a normal decision, far below the 50ms tick budget. */
export const AI_INVOKE_TIMEOUT_MS = 20;
/** Per-isolate heap cap (MB). */
export const ISOLATE_MEMORY_LIMIT_MB = 16;
/** Timeout for the one-time bootstrap/instantiation when the runner is created. */
export const AI_COMPILE_TIMEOUT_MS = 5000;

// ── Guest runtime ────────────────────────────────────────────────────────────
// Ported, read-only port of CollisionSystem + facade builders, defined INSIDE the isolate. Source
// of truth: backend/src/game/CollisionSystem.ts (isWalkable/canMoveTo/getTileAt), Player.ts
// (canMove/canPlaceBomb), Bomb.ts (isPierce/isRemote), shared/src/utils/wrap.ts (wrapX/wrapY).
// MUST stay behaviourally identical to those — covered by a parity test.
const BOT_GUEST_RUNTIME = `
'use strict';
var __ai = (function () {
  function wrapX(x, w) { return ((x % w) + w) % w; }
  function wrapY(y, h) { return ((y % h) + h) % h; }
  var WALKABLE = new Set([
    'empty','spawn','teleporter_a','teleporter_b',
    'conveyor_up','conveyor_down','conveyor_left','conveyor_right',
    'exit','goal',
    'switch_red','switch_blue','switch_green','switch_yellow',
    'switch_red_active','switch_blue_active','switch_green_active','switch_yellow_active',
    'gate_red_open','gate_blue_open','gate_green_open','gate_yellow_open',
    'crumbling','vine','quicksand','ice','mud','spikes','spikes_active','dark_rift',
  ]);
  function GuestCollision(map) {
    this.tiles = map.tiles; this.width = map.width; this.height = map.height;
    this.wrapping = !!map.wrapping;
  }
  GuestCollision.prototype.isWalkable = function (x, y) {
    if (this.wrapping) { x = wrapX(x, this.width); y = wrapY(y, this.height); }
    else if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return WALKABLE.has(this.tiles[y][x]);
  };
  GuestCollision.prototype.canMoveTo = function (fromX, fromY, direction, bombPositions, playerPositions) {
    var newX = fromX, newY = fromY;
    if (direction === 'up') newY--;
    else if (direction === 'down') newY++;
    else if (direction === 'left') newX--;
    else if (direction === 'right') newX++;
    if (this.wrapping) { newX = wrapX(newX, this.width); newY = wrapY(newY, this.height); }
    if (!this.isWalkable(newX, newY)) return null;
    var bp = bombPositions || [];
    for (var i = 0; i < bp.length; i++) if (bp[i].x === newX && bp[i].y === newY) return null;
    var pp = playerPositions || [];
    for (var j = 0; j < pp.length; j++) if (pp[j].x === newX && pp[j].y === newY) return null;
    return { x: newX, y: newY };
  };
  GuestCollision.prototype.getTileAt = function (x, y) {
    if (this.wrapping) { x = wrapX(x, this.width); y = wrapY(y, this.height); }
    else if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 'wall';
    return this.tiles[y][x];
  };

  function buildPlayer(p) {
    return {
      id: p.id, username: p.username, position: p.position, alive: p.alive, direction: p.direction,
      bombCount: p.bombCount, maxBombs: p.maxBombs, fireRange: p.fireRange, speed: p.speed,
      hasShield: p.hasShield, hasKick: p.hasKick, hasPierceBomb: p.hasPierceBomb,
      hasRemoteBomb: p.hasRemoteBomb, hasLineBomb: p.hasLineBomb, hasBombThrow: p.hasBombThrow,
      team: p.team, invulnerableTicks: p.invulnerableTicks, moveCooldown: p.moveCooldown,
      kills: p.kills, deaths: p.deaths, selfKills: p.selfKills,
      canMove: function () { return p.alive && p.moveCooldown <= 0; },
      canPlaceBomb: function () { return p.alive && p.bombCount < p.maxBombs; },
    };
  }
  function buildBomb(b) {
    return {
      id: b.id, position: b.position, ownerId: b.ownerId, fireRange: b.fireRange,
      ticksRemaining: b.ticksRemaining, sliding: b.sliding, bombType: b.bombType,
      get isPierce() { return b.bombType === 'pierce'; },
      get isRemote() { return b.bombType === 'remote'; },
    };
  }
  function buildExplosion(e) {
    return { id: e.id, cells: e.cells, ownerId: e.ownerId, ticksRemaining: e.ticksRemaining };
  }
  function buildPowerUp(pu) { return { id: pu.id, position: pu.position, type: pu.type }; }

  function toMap(arr, build) {
    var m = new Map();
    for (var i = 0; i < arr.length; i++) { var v = build(arr[i]); m.set(arr[i].id, v); }
    return m;
  }
  function buildState(snap) {
    var st = {
      tick: snap.tick, roundTime: snap.roundTime, status: 'playing',
      hillZone: snap.hillZone, map: snap.map,
      reinforcedWalls: snap.map.reinforcedWalls,
      collisionSystem: new GuestCollision(snap.map),
      players: toMap(snap.players, buildPlayer),
      bombs: toMap(snap.bombs, buildBomb),
      explosions: toMap(snap.explosions, buildExplosion),
      powerUps: toMap(snap.powerUps, buildPowerUp),
    };
    st.getAlivePlayers = function () {
      var out = []; st.players.forEach(function (p) { if (p.alive) out.push(p); }); return out;
    };
    return st;
  }
  var NOOP_LOGGER = { logBotDecision: function () {}, logBotPathfinding: function () {} };
  return { buildState: buildState, buildPlayer: buildPlayer, NOOP_LOGGER: NOOP_LOGGER };
})();
`;

const CLASS_DISCOVERY = (method: string) => `
  var __mod = module.exports;
  var __AIClass = null;
  if (typeof __mod === 'function' && __mod.prototype && typeof __mod.prototype.${method} === 'function') {
    __AIClass = __mod;
  } else if (__mod && typeof __mod.default === 'function' && __mod.default.prototype &&
             typeof __mod.default.prototype.${method} === 'function') {
    __AIClass = __mod.default;
  } else if (__mod) {
    for (var __k in __mod) {
      var __v = __mod[__k];
      if (typeof __v === 'function' && __v.prototype && typeof __v.prototype.${method} === 'function') {
        __AIClass = __v; break;
      }
    }
  }
  if (!__AIClass) throw new Error('No exported class with ${method}()');
`;

// CommonJS module shim created INSIDE the isolate; the user's esbuild-CJS output assigns to it.
const CJS_SHIM = `var module = { exports: {} }; var exports = module.exports;`;

function buildBotBootstrap(compiledCode: string, argsLiteral: string): string {
  return (
    BOT_GUEST_RUNTIME +
    '\n' +
    CJS_SHIM +
    '\n' +
    compiledCode +
    '\n;' +
    CLASS_DISCOVERY('generateInput') +
    `
  var __instance = new __AIClass(${argsLiteral});
  globalThis.__invoke = function (snapshotJson) {
    var snap = JSON.parse(snapshotJson);
    var self = __ai.buildPlayer(snap.self);
    var state = __ai.buildState(snap);
    var out = __instance.generateInput(self, state, __ai.NOOP_LOGGER);
    return out == null ? null : JSON.stringify(out);
  };
`
  );
}

function buildEnemyBootstrap(compiledCode: string, argsLiteral: string): string {
  // Enemy context is already plain data; only `rng` is a function. It is re-attached inside the
  // isolate as a call back to the host's seeded RNG (Reference) so replays stay deterministic.
  return (
    "'use strict';\n" +
    CJS_SHIM +
    '\n' +
    compiledCode +
    '\n;' +
    CLASS_DISCOVERY('decide') +
    `
  var __instance = new __AIClass(${argsLiteral});
  globalThis.__invoke = function (contextJson) {
    var ctx = JSON.parse(contextJson);
    ctx.rng = function () { return globalThis.__hostRng(); };
    var out = __instance.decide(ctx);
    return JSON.stringify(out);
  };
`
  );
}

function argsToLiteral(args: unknown[]): string {
  // ctorArgs are OUR trusted values (difficulty enum, mapSize/typeConfig) — JSON-encode them.
  // `undefined` must stay `undefined` (not the string) to match the in-process constructor call.
  return args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(', ');
}

/**
 * Owns one isolate for one untrusted AI instance. The user code is compiled and the AI class is
 * instantiated once (in the constructor); each `invoke` only copies a snapshot in and the result
 * out, with a hard timeout. On timeout/error the isolate is disposed and the error rethrown so the
 * caller's existing crash-fallback (→ built-in AI) fires.
 */
export class IsolatedAIRunner {
  private isolate: ivm.Isolate;
  private context: ivm.Context;
  private invokeRef: ivm.Reference;
  private rngRef: ivm.Reference | null = null;
  private disposed = false;

  constructor(
    kind: 'bot' | 'enemy',
    compiledCode: string,
    ctorArgs: unknown[],
    rng?: () => number,
  ) {
    this.isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_LIMIT_MB });
    this.context = this.isolate.createContextSync();

    if (rng) {
      this.rngRef = new ivm.Reference(rng);
      // Expose the host seeded RNG to the guest as globalThis.__hostRng() returning a number.
      this.context.evalClosureSync(
        'globalThis.__hostRng = function () { return $0.applySync(undefined, [], { result: { copy: true } }); };',
        [this.rngRef],
      );
    }

    const argsLiteral = argsToLiteral(ctorArgs);
    const bootstrap =
      kind === 'bot'
        ? buildBotBootstrap(compiledCode, argsLiteral)
        : buildEnemyBootstrap(compiledCode, argsLiteral);

    this.context.evalSync(bootstrap, { timeout: AI_COMPILE_TIMEOUT_MS });
    this.invokeRef = this.context.global.getSync('__invoke', { reference: true });
  }

  /** Invoke the AI with a JSON argument; returns the guest's JSON result string or null. Throws on timeout/error (and disposes). */
  invoke(argJson: string): string | null {
    if (this.disposed) throw new Error('AI isolate already disposed');
    try {
      const result = this.invokeRef.applySync(undefined, [argJson], {
        arguments: { copy: true },
        result: { copy: true },
        timeout: AI_INVOKE_TIMEOUT_MS,
      });
      return result == null ? null : (result as string);
    } catch (err) {
      // A timed-out/crashed isolate may be in an inconsistent state — dispose it and let the
      // caller fall back to the built-in AI.
      this.dispose();
      throw err;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.invokeRef?.release();
      this.rngRef?.release();
      this.context?.release();
      if (!this.isolate.isDisposed) this.isolate.dispose();
    } catch {
      // best-effort cleanup
    }
  }
}

/** Dispose an AI instance's isolate if it has one. Built-in AIs have no `dispose` — no-op. */
export function disposeAI(ai: unknown): void {
  const dispose = (ai as { dispose?: () => void } | null | undefined)?.dispose;
  if (typeof dispose === 'function') {
    try {
      dispose.call(ai);
    } catch {
      // best-effort
    }
  }
}

// ── Host-side snapshot builder (bot) ─────────────────────────────────────────

function playerSnap(p: Player) {
  return {
    id: p.id,
    username: p.username,
    position: { x: p.position.x, y: p.position.y },
    alive: p.alive,
    direction: p.direction,
    bombCount: p.bombCount,
    maxBombs: p.maxBombs,
    fireRange: p.fireRange,
    speed: p.speed,
    hasShield: p.hasShield,
    hasKick: p.hasKick,
    hasPierceBomb: p.hasPierceBomb,
    hasRemoteBomb: p.hasRemoteBomb,
    hasLineBomb: p.hasLineBomb,
    hasBombThrow: p.hasBombThrow,
    team: p.team,
    invulnerableTicks: p.invulnerableTicks,
    moveCooldown: p.moveCooldown,
    kills: p.kills,
    deaths: p.deaths,
    selfKills: p.selfKills,
  };
}

export function buildBotSnapshotJson(self: Player, state: GameStateManager): string {
  const players = [];
  for (const p of state.players.values()) players.push(playerSnap(p));
  const bombs = [];
  for (const b of state.bombs.values()) {
    bombs.push({
      id: b.id,
      position: { x: b.position.x, y: b.position.y },
      ownerId: b.ownerId,
      fireRange: b.fireRange,
      ticksRemaining: b.ticksRemaining,
      sliding: b.sliding,
      bombType: b.bombType,
    });
  }
  const explosions = [];
  for (const e of state.explosions.values()) {
    explosions.push({
      id: e.id,
      cells: e.cells,
      ownerId: e.ownerId,
      ticksRemaining: e.ticksRemaining,
    });
  }
  const powerUps = [];
  for (const pu of state.powerUps.values()) {
    powerUps.push({ id: pu.id, position: { x: pu.position.x, y: pu.position.y }, type: pu.type });
  }
  const map = state.map as { width: number; height: number; tiles: unknown; wrapping?: boolean };
  return JSON.stringify({
    tick: state.tick,
    roundTime: state.roundTime,
    hillZone: state.hillZone,
    map: {
      width: map.width,
      height: map.height,
      tiles: map.tiles,
      wrapping: !!map.wrapping,
      reinforcedWalls: state.reinforcedWalls,
    },
    self: playerSnap(self),
    players,
    bombs,
    explosions,
    powerUps,
  });
}

// ── Wrappers implementing the in-process AI interfaces ───────────────────────

/** Untrusted bot AI: implements IBotAI by running generateInput inside an isolate. */
export class IsolatedBotAI implements IBotAI {
  private runner: IsolatedAIRunner;

  constructor(
    compiledCode: string,
    difficulty: 'easy' | 'normal' | 'hard',
    mapSize?: { width: number; height: number },
  ) {
    this.runner = new IsolatedAIRunner('bot', compiledCode, [difficulty, mapSize]);
  }

  generateInput(
    self: Player,
    state: GameStateManager,
    _logger?: GameLogger | null,
  ): PlayerInput | null {
    const out = this.runner.invoke(buildBotSnapshotJson(self, state)); // throws on timeout/error → caller fallback
    return out ? (JSON.parse(out) as PlayerInput) : null;
  }

  dispose(): void {
    this.runner.dispose();
  }
}

/** Untrusted enemy AI: implements IEnemyAI by running decide inside an isolate. */
export class IsolatedEnemyAI implements IEnemyAI {
  private runner: IsolatedAIRunner;
  /** Updated each decide() so the isolate's rng Reference always draws from the current game's seeded RNG. */
  private currentRng: () => number = () => 0;

  constructor(
    compiledCode: string,
    difficulty: 'easy' | 'normal' | 'hard',
    typeConfig: EnemyAIContext['self']['typeConfig'],
  ) {
    this.runner = new IsolatedAIRunner('enemy', compiledCode, [difficulty, typeConfig], () =>
      this.currentRng(),
    );
  }

  decide(context: EnemyAIContext): EnemyAIResult {
    this.currentRng = context.rng;
    // Strip the rng function (not serializable); the isolate re-attaches it via the host Reference.
    const { rng: _rng, ...plain } = context;
    const out = this.runner.invoke(JSON.stringify(plain)); // throws on timeout/error → caller fallback
    return JSON.parse(out as string) as EnemyAIResult;
  }

  dispose(): void {
    this.runner.dispose();
  }
}
