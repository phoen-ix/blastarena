import { PowerUpType } from '../types/game';

export const POWERUP_DROP_CHANCE = 0.3;

export interface PowerUpDefinition {
  type: PowerUpType;
  name: string;
  description: string;
  weight: number; // Relative probability
  color: string;
}

export const POWERUP_DEFINITIONS: Record<PowerUpType, PowerUpDefinition> = {
  bomb_up: {
    type: 'bomb_up',
    name: 'Bomb Up',
    description: 'Increases max bombs by 1',
    weight: 30,
    color: '#FF4444',
  },
  fire_up: {
    type: 'fire_up',
    name: 'Fire Up',
    description: 'Increases explosion range by 1',
    weight: 30,
    color: '#FF8800',
  },
  speed_up: {
    type: 'speed_up',
    name: 'Speed Up',
    description: 'Increases movement speed',
    weight: 25,
    color: '#44AAFF',
  },
  shield: {
    type: 'shield',
    name: 'Shield',
    description: 'Absorbs one explosion hit',
    weight: 10,
    color: '#44FF44',
  },
  kick: {
    type: 'kick',
    name: 'Bomb Kick',
    description: 'Kick bombs by walking into them',
    weight: 5,
    color: '#CC44FF',
  },
  pierce_bomb: {
    type: 'pierce_bomb',
    name: 'Pierce Bomb',
    description: 'Explosions pass through destructible walls',
    weight: 4,
    color: '#FF2222',
  },
  remote_bomb: {
    type: 'remote_bomb',
    name: 'Remote Bomb',
    description: 'Press E to detonate your bombs manually',
    weight: 3,
    color: '#4488FF',
  },
  line_bomb: {
    type: 'line_bomb',
    name: 'Line Bomb',
    description: 'Place a line of bombs in your facing direction',
    weight: 3,
    color: '#FFAA44',
  },
  bomb_throw: {
    type: 'bomb_throw',
    name: 'Bomb Throw',
    description: 'Press Q to throw a bomb over walls',
    weight: 4,
    color: '#FF66FF',
  },
};

export function getRandomPowerUpType(
  random: () => number,
  enabledTypes?: PowerUpType[],
): PowerUpType {
  const defs = enabledTypes
    ? Object.values(POWERUP_DEFINITIONS).filter((d) => enabledTypes.includes(d.type))
    : Object.values(POWERUP_DEFINITIONS);

  const totalWeight = defs.reduce((sum, def) => sum + def.weight, 0);
  let roll = random() * totalWeight;
  for (const def of defs) {
    roll -= def.weight;
    if (roll <= 0) return def.type;
  }
  return 'bomb_up'; // fallback
}
