import {
  EnemyBodyShape,
  EnemyEyeStyle,
  EnemyAccessory,
  EnemyMovementPattern,
  CampaignWinCondition,
} from '../types/campaign';

export const CAMPAIGN_RESPAWN_TICKS = 40; // 2 seconds
export const CAMPAIGN_RESPAWN_INVULNERABILITY = 40; // 2 seconds after respawn
/**
 * Base for campaign enemy IDs; enemies count DOWN from here (-1000000, -1000001, …).
 *
 * This used to be +1000, i.e. enemies occupied the positive id space that real user accounts are
 * allocated from. Enemy bombs carry `ownerId = enemy.id` and GameState.detonateBomb resolves bomb
 * owners against `players`, which is keyed by real user id — so once accounts reached id 1000, an
 * enemy's bomb would decrement that player's bombCount and be attributed to them (and in co-op
 * with friendly fire off, be rendered harmless to their whole team).
 *
 * Negative ids are this codebase's convention for players that are not DB rows. This range is
 * chosen to clear all the others: bots -1..-8, buddy -2000..-11999, open-world guests
 * -3000..-9999. (audit ENEMY-ID-1)
 */
export const ENEMY_ID_OFFSET = -1000000;

export const ENEMY_BODY_SHAPES: EnemyBodyShape[] = [
  'blob',
  'spiky',
  'ghost',
  'robot',
  'bug',
  'skull',
];

export const ENEMY_EYE_STYLES: EnemyEyeStyle[] = ['round', 'angry', 'sleepy', 'crazy'];

export const ENEMY_ACCESSORIES: EnemyAccessory[] = ['none', 'bow_tie', 'monocle', 'bandana'];

export const MOVEMENT_PATTERNS: EnemyMovementPattern[] = [
  'random_walk',
  'chase_player',
  'patrol_path',
  'wall_follow',
  'stationary',
];

export const WIN_CONDITIONS: CampaignWinCondition[] = [
  'kill_all',
  'find_exit',
  'reach_goal',
  'survive_time',
];
