import { describe, it, expect, vi } from 'vitest';
import { SoundGenerator } from '../../src/game/SoundGenerator';

/** Every explosion allocated and filled a fresh noise buffer — tens of thousands of samples each. */

function param() {
  return {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function node() {
  return { connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
}

function fakeContext() {
  const sources: { buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 3,
    sampleRate: 1000,
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => {
      const data = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => data };
    }),
    createBufferSource: vi.fn(() => {
      const source = { ...node(), buffer: null };
      sources.push(source);
      return source;
    }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    createBiquadFilter: vi.fn(() => ({ ...node(), type: '', frequency: param() })),
    createOscillator: vi.fn(() => ({ ...node(), type: '', frequency: param() })),
  };
  return { ctx, sources };
}

describe('noise bursts', () => {
  it('share one noise buffer and play a slice of it as long as the burst', () => {
    const { ctx, sources } = fakeContext();
    const sound = new SoundGenerator(ctx as never, node() as never);

    for (let i = 0; i < 5; i++) sound.explosion();
    sound.death();

    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(6);
    expect(new Set(sources.map((s) => s.buffer)).size).toBe(1);

    const [when, offset, duration] = sources[0].start.mock.calls[0];
    expect(when).toBe(3);
    expect(duration).toBeCloseTo(0.4);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset + duration).toBeLessThanOrEqual(1);
    const [, , deathDuration] = sources[5].start.mock.calls[0];
    expect(deathDuration).toBeCloseTo(0.15);
  });
});
