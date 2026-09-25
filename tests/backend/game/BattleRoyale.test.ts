import { describe, it, expect } from '@jest/globals';
import { BattleRoyaleZone } from '../../../backend/src/game/BattleRoyale';
import {
  BR_ZONE_INITIAL_DELAY_SECONDS,
  BR_ZONE_SHRINK_AMOUNT,
  BR_ZONE_MIN_RADIUS,
  TICK_RATE,
} from '@blast-arena/shared';

describe('BattleRoyaleZone', () => {
  it('should start at the half-diagonal, just covering every tile', () => {
    expect(new BattleRoyaleZone(15, 11).toState().currentRadius).toBe(
      Math.ceil(Math.hypot(15, 11) / 2),
    );
    expect(new BattleRoyaleZone(9, 13).toState().currentRadius).toBe(
      Math.ceil(Math.hypot(9, 13) / 2),
    );
    expect(new BattleRoyaleZone(39, 31).toState().currentRadius).toBe(25);
  });

  it('should reach the minimum radius before the round ends', () => {
    for (const [w, h, round] of [
      [39, 31, 300],
      [51, 51, 600],
      [15, 11, 30],
    ]) {
      const zone = new BattleRoyaleZone(w, h, round);
      for (let tick = 1; tick <= round * TICK_RATE; tick++) zone.tick(tick);
      expect(zone.toState().targetRadius).toBe(BR_ZONE_MIN_RADIUS);
    }
  });

  it('should touch the playable corners early in a default round', () => {
    // 39x31 / 300 s: the farthest interior tile is ~22.8 from the centre.
    const zone = new BattleRoyaleZone(39, 31, 300);
    let tick = 0;
    while (zone.toState().currentRadius > 22.8 && tick < 300 * TICK_RATE) zone.tick(++tick);
    expect(tick / TICK_RATE).toBeLessThan(90);
  });

  it('should set center at floor(width/2), floor(height/2)', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const state = zone.toState();
    expect(state.centerX).toBe(7);
    expect(state.centerY).toBe(5);
  });

  it('should report center position as inside zone', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const state = zone.toState();
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('should report positions within radius as inside zone', () => {
    const zone = new BattleRoyaleZone(15, 11);
    // All map corners are within the initial (half-diagonal) radius
    expect(zone.isInsideZone(0, 0)).toBe(true);
    expect(zone.isInsideZone(14, 0)).toBe(true);
    expect(zone.isInsideZone(0, 10)).toBe(true);
    expect(zone.isInsideZone(14, 10)).toBe(true);
  });

  it('should begin shrinking after BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE ticks', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const initialRadius = zone.toState().currentRadius;
    const delayticks = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;

    // Tick up to just before the shrink threshold — target should not change
    for (let t = 0; t < delayticks - 1; t++) {
      zone.tick(t);
    }
    expect(zone.toState().targetRadius).toBe(initialRadius);

    // The tick at the delay threshold triggers shrink
    zone.tick(delayticks);
    expect(zone.toState().targetRadius).toBe(initialRadius - BR_ZONE_SHRINK_AMOUNT);
  });

  it('should make outer positions outside zone after sufficient shrinking', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const delayticks = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;

    // Trigger many shrink phases to reduce the zone substantially
    let tick = delayticks;
    for (let phase = 0; phase < 50; phase++) {
      zone.tick(tick);
      tick++;
    }
    // Keep ticking to let currentRadius converge toward targetRadius
    for (let i = 0; i < 500; i++) {
      zone.tick(tick);
      tick++;
    }

    const state = zone.toState();
    // Far corner (0,0) should now be outside the reduced zone
    const dx = 0 - state.centerX;
    const dy = 0 - state.centerY;
    const distToCorner = Math.sqrt(dx * dx + dy * dy);

    if (state.currentRadius < distToCorner) {
      expect(zone.isInsideZone(0, 0)).toBe(false);
    }
    // Center should always be inside
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('should never shrink radius below BR_ZONE_MIN_RADIUS', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const delayticks = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;

    // Run many ticks to exhaust all shrink phases
    let tick = 0;
    for (let i = 0; i < 5000; i++) {
      zone.tick(tick);
      tick++;
    }

    const state = zone.toState();
    expect(state.currentRadius).toBeGreaterThanOrEqual(BR_ZONE_MIN_RADIUS);
    expect(state.targetRadius).toBeGreaterThanOrEqual(BR_ZONE_MIN_RADIUS);
  });

  it('leaves a far corner outside and the centre inside once shrunk', () => {
    const zone = new BattleRoyaleZone(15, 11);
    // A whole 300 s round: the zone reaches its minimum radius before time-up
    for (let tick = 0; tick <= 300 * TICK_RATE; tick++) zone.tick(tick);

    const state = zone.toState();
    expect(state.currentRadius).toBe(BR_ZONE_MIN_RADIUS);
    // Outside the zone a player dies outright (there is no per-tick zone damage)
    expect(zone.isInsideZone(0, 0)).toBe(false);
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('player at exact zone boundary should be inside', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const state = zone.toState();

    // A point exactly at distance = currentRadius from center should be inside
    // (isInsideZone uses <= comparison)
    // Place a point at exactly currentRadius distance along the X axis
    const boundaryX = state.centerX + state.currentRadius;
    const boundaryY = state.centerY;

    // The distance is exactly currentRadius, which satisfies <= currentRadius
    expect(zone.isInsideZone(boundaryX, boundaryY)).toBe(true);
  });

  it('zone center should not change during shrinking', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const initialState = zone.toState();
    const initialCenterX = initialState.centerX;
    const initialCenterY = initialState.centerY;

    const delayticks = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;

    // Run many ticks through multiple shrink phases
    let tick = 0;
    for (let i = 0; i < 2000; i++) {
      zone.tick(tick);
      tick++;
    }

    const afterState = zone.toState();
    expect(afterState.centerX).toBe(initialCenterX);
    expect(afterState.centerY).toBe(initialCenterY);
  });

  it('should handle very wide map (51x11)', () => {
    const zone = new BattleRoyaleZone(51, 11);
    const state = zone.toState();

    expect(state.centerX).toBe(Math.floor(51 / 2));
    expect(state.centerY).toBe(Math.floor(11 / 2));
    expect(state.currentRadius).toBe(Math.ceil(Math.hypot(51, 11) / 2));
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('should handle very tall map (11x51)', () => {
    const zone = new BattleRoyaleZone(11, 51);
    const state = zone.toState();

    expect(state.centerX).toBe(Math.floor(11 / 2));
    expect(state.centerY).toBe(Math.floor(51 / 2));
    expect(state.currentRadius).toBe(Math.ceil(Math.hypot(11, 51) / 2));
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('toState() should include center, radius, shrinkRate', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const state = zone.toState();

    expect(state).toHaveProperty('centerX');
    expect(state).toHaveProperty('centerY');
    expect(state).toHaveProperty('currentRadius');
    expect(state).toHaveProperty('targetRadius');
    expect(state).toHaveProperty('shrinkRate');
    expect(state).toHaveProperty('nextShrinkTick');

    expect(typeof state.centerX).toBe('number');
    expect(typeof state.centerY).toBe('number');
    expect(typeof state.currentRadius).toBe('number');
    expect(typeof state.targetRadius).toBe('number');
    expect(typeof state.shrinkRate).toBe('number');
    expect(typeof state.nextShrinkTick).toBe('number');
  });
});
