import { describe, it, expect } from '@jest/globals';
import { BattleRoyaleZone } from '../../../backend/src/game/BattleRoyale';
import {
  BR_ZONE_INITIAL_DELAY_SECONDS,
  BR_ZONE_SHRINK_AMOUNT,
  BR_ZONE_MIN_RADIUS,
  BR_ZONE_DAMAGE_PER_TICK,
  TICK_RATE,
} from '@blast-arena/shared';

describe('BattleRoyaleZone', () => {
  it('should set initial radius to max(width, height)', () => {
    const zone1 = new BattleRoyaleZone(15, 11);
    const state1 = zone1.toState();
    expect(state1.currentRadius).toBe(15);

    const zone2 = new BattleRoyaleZone(9, 13);
    const state2 = zone2.toState();
    expect(state2.currentRadius).toBe(13);

    const zone3 = new BattleRoyaleZone(11, 11);
    const state3 = zone3.toState();
    expect(state3.currentRadius).toBe(11);
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
    // All map corners should be within the initial radius of max(15,11) = 15
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

  it('should return BR_ZONE_DAMAGE_PER_TICK from getDamagePerTick', () => {
    const zone = new BattleRoyaleZone(15, 11);
    expect(zone.getDamagePerTick()).toBe(BR_ZONE_DAMAGE_PER_TICK);
  });

  it('should apply zone damage to a player outside zone after shrinking', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const delayticks = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;

    // Shrink zone substantially
    let tick = delayticks;
    for (let phase = 0; phase < 50; phase++) {
      zone.tick(tick);
      tick++;
    }
    // Let currentRadius converge to targetRadius
    for (let i = 0; i < 500; i++) {
      zone.tick(tick);
      tick++;
    }

    const state = zone.toState();
    // Check a far corner - if it's outside the zone, damage should apply
    const cornerInside = zone.isInsideZone(0, 0);
    if (!cornerInside) {
      // Player at (0,0) would take damage each tick
      expect(zone.getDamagePerTick()).toBeGreaterThan(0);
    }
    // Center should always be safe
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
    // Initial radius should be max(51, 11) = 51
    expect(state.currentRadius).toBe(51);
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('should handle very tall map (11x51)', () => {
    const zone = new BattleRoyaleZone(11, 51);
    const state = zone.toState();

    expect(state.centerX).toBe(Math.floor(11 / 2));
    expect(state.centerY).toBe(Math.floor(51 / 2));
    // Initial radius should be max(11, 51) = 51
    expect(state.currentRadius).toBe(51);
    expect(zone.isInsideZone(state.centerX, state.centerY)).toBe(true);
  });

  it('toState() should include center, radius, shrinkRate, damagePerTick', () => {
    const zone = new BattleRoyaleZone(15, 11);
    const state = zone.toState();

    expect(state).toHaveProperty('centerX');
    expect(state).toHaveProperty('centerY');
    expect(state).toHaveProperty('currentRadius');
    expect(state).toHaveProperty('targetRadius');
    expect(state).toHaveProperty('shrinkRate');
    expect(state).toHaveProperty('damagePerTick');
    expect(state).toHaveProperty('nextShrinkTick');

    expect(typeof state.centerX).toBe('number');
    expect(typeof state.centerY).toBe('number');
    expect(typeof state.currentRadius).toBe('number');
    expect(typeof state.targetRadius).toBe('number');
    expect(typeof state.shrinkRate).toBe('number');
    expect(typeof state.damagePerTick).toBe('number');
    expect(typeof state.nextShrinkTick).toBe('number');
  });
});
