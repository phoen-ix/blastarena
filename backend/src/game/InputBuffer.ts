import { PlayerInput } from '@blast-arena/shared';

export class InputBuffer {
  private buffers: Map<number, PlayerInput[]> = new Map();
  private maxBufferSize: number = 60; // 3 seconds worth at 20 tps

  addInput(playerId: number, input: PlayerInput): void {
    if (!this.buffers.has(playerId)) {
      this.buffers.set(playerId, []);
    }

    const buffer = this.buffers.get(playerId)!;
    buffer.push(input);

    // Prevent buffer overflow
    if (buffer.length > this.maxBufferSize) {
      buffer.shift();
    }
  }

  getInputs(playerId: number): PlayerInput[] {
    const buffer = this.buffers.get(playerId);
    if (!buffer) return [];
    const inputs = [...buffer];
    buffer.length = 0;
    return inputs;
  }

  /**
   * The input to apply this tick: the newest direction plus the oldest pending action.
   *
   * Clients send about one input per 50 ms, so normal network jitter delivers two inside one tick.
   * Taking only the newest silently dropped an earlier bomb/detonate/throw. Further actions stay
   * buffered (without a direction) for the following ticks, so each is applied once, in order.
   */
  getLatestInput(playerId: number): PlayerInput | null {
    const buffer = this.buffers.get(playerId);
    if (!buffer || buffer.length === 0) return null;
    const latest = buffer[buffer.length - 1];
    const firstAction = buffer.findIndex((i) => i.action != null);
    const action = firstAction === -1 ? null : buffer[firstAction].action;
    const pending: PlayerInput[] = [];
    if (firstAction !== -1) {
      for (let i = firstAction + 1; i < buffer.length; i++) {
        if (buffer[i].action != null) pending.push({ ...buffer[i], direction: null });
      }
    }
    buffer.length = 0;
    buffer.push(...pending);
    return action === latest.action ? latest : { ...latest, action };
  }

  clear(playerId: number): void {
    this.buffers.delete(playerId);
  }

  clearAll(): void {
    this.buffers.clear();
  }
}
