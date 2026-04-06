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

  getLatestInput(playerId: number): PlayerInput | null {
    const buffer = this.buffers.get(playerId);
    if (!buffer || buffer.length === 0) return null;
    const input = buffer[buffer.length - 1];
    buffer.length = 0;
    return input;
  }

  clear(playerId: number): void {
    this.buffers.delete(playerId);
  }

  clearAll(): void {
    this.buffers.clear();
  }

  /** Check if any player has pending inputs */
  hasInputs(): boolean {
    for (const buffer of this.buffers.values()) {
      if (buffer.length > 0) return true;
    }
    return false;
  }
}
