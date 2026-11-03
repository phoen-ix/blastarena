import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockDispose = vi.fn();
const mockRunFast = vi.fn<AnyFn>();
const mockRunRealtime = vi.fn<AnyFn>();
const mockSetStateCallback = vi.fn();

vi.mock('../../../backend/src/simulation/SimulationGame', () => ({
  SimulationGame: vi.fn().mockImplementation(function () {
    return {
      setStateCallback: mockSetStateCallback,
      runFast: mockRunFast,
      runRealtime: mockRunRealtime,
      dispose: mockDispose,
      cancel: vi.fn(),
      getTick: () => 0,
      getMaxTicks: () => 100,
      getState: () => ({}),
    };
  }),
}));

vi.mock('../../../backend/src/game/registry', () => ({
  getIO: () => {
    throw new Error('no io in tests');
  },
}));

vi.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { SimulationRunner } from '../../../backend/src/simulation/SimulationRunner';
import type { SimulationConfig } from '@blast-arena/shared';

function config(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    gameMode: 'ffa',
    botCount: 4,
    botDifficulty: 'normal',
    mapWidth: 15,
    mapHeight: 13,
    roundTime: 180,
    totalGames: 1,
    speed: 'fast',
    logVerbosity: 'normal',
    ...overrides,
  } as SimulationConfig;
}

const result = (gameIndex: number) => ({
  gameIndex,
  winnerId: null,
  winnerName: null,
  finishReason: 'done',
  durationTicks: 10,
  durationSeconds: 1,
  mapSeed: 1,
  placements: [],
  hasReplay: false,
});

/**
 * SimulationRunner.dispose() is the ONLY thing that releases the isolated-vm isolates holding
 * custom bot AIs, and it used to sit on the success path only. runFast() has no try/catch of its
 * own, so a throw from processTick/recordTick/finalize skipped straight to the batch catch, which
 * nulled currentGame without disposing. isolated-vm isolates are not reclaimed by ordinary GC —
 * that is why disposal is explicit (audit C1) — so every failing batch leaked one isolate per
 * custom bot AI. (audit SIM-DISPOSE-1)
 */
describe('SimulationRunner isolate disposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disposes the game when it completes normally', async () => {
    mockRunFast.mockResolvedValue(result(0));

    await new SimulationRunner(config(), 'batch-ok').run();

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the game when runFast throws', async () => {
    mockRunFast.mockRejectedValue(new Error('simulated tick failure'));

    const runner = new SimulationRunner(config(), 'batch-throw');
    await runner.run();

    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(runner.getStatus().status).toBe('error');
  });

  it('disposes every game when a later one throws mid-batch', async () => {
    mockRunFast
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce(result(1))
      .mockRejectedValueOnce(new Error('boom'));

    // The runner pauses 500 ms between games; fake timers skip the pauses.
    vi.useFakeTimers();
    const run = new SimulationRunner(config({ totalGames: 5 }), 'batch-mid').run();
    await vi.runAllTimersAsync();
    await run;

    // Two successes plus the failing one — no isolate left behind.
    expect(mockDispose).toHaveBeenCalledTimes(3);
  });

  it('disposes for realtime batches too', async () => {
    mockRunRealtime.mockRejectedValue(new Error('boom'));

    await new SimulationRunner(config({ speed: 'realtime' }), 'batch-rt').run();

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
