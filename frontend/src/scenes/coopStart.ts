import type Phaser from 'phaser';
import type { CoopStartData } from '@blast-arena/shared';

/**
 * Enter a co-op campaign level that the party leader started. The partner can be in the lobby, in
 * a level (leader restarted it) or on the results screen (leader picked the next level), so every
 * one of those scenes routes `campaign:coopStart` here.
 */
export function enterCoopLevel(scene: Phaser.Scene, data: CoopStartData): void {
  const registry = scene.registry;
  registry.set('campaignMode', true);
  registry.set('campaignCoopMode', true);
  registry.remove('localCoopMode');
  registry.remove('buddyMode');
  registry.set('initialGameState', data.state.gameState);
  registry.set('campaignEnemyTypes', data.enemyTypes || []);
  if (data.state.theme) registry.set('campaignTheme', data.state.theme);
  else registry.remove('campaignTheme');
  scene.scene.stop('HUDScene');
  scene.scene.start('GameScene');
  scene.scene.launch('HUDScene');
}
