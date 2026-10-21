/**
 * Accent colour per power-up type: the classic texture tint, the pickup burst in EffectSystem and
 * the HUD's stat icons. Kept free of Phaser so DOM code can use it.
 */
export const POWERUP_COLORS: Record<string, number> = {
  bomb_up: 0xff4444,
  fire_up: 0xff8800,
  speed_up: 0x44aaff,
  shield: 0x44ff44,
  kick: 0xcc44ff,
  pierce_bomb: 0xff2222,
  remote_bomb: 0x4488ff,
  line_bomb: 0xffaa44,
  bomb_throw: 0xff66ff,
};
