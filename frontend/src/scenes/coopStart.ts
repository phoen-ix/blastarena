import type Phaser from 'phaser';
import type { CoopStartData } from '@blast-arena/shared';
import type { LocalCoopP2Identity } from '../game/LocalCoopInput';
import { ApiClient } from '../network/ApiClient';
import { t } from '../i18n';

/** Registry keys that describe a campaign run. Leaving the run clears all of them. */
const CAMPAIGN_RUN_KEYS = [
  'campaignMode',
  'campaignCoopMode',
  'localCoopMode',
  'localCoopConfig',
  'buddyMode',
  'buddyConfig',
  'campaignTheme',
];

/**
 * Forget the current campaign run. Paths that cleared only some of the keys let `buddyMode`
 * survive into the next solo level, whose Retry then started a buddy session.
 */
export function clearCampaignRun(registry: Phaser.Data.DataManager): void {
  for (const key of CAMPAIGN_RUN_KEYS) registry.remove(key);
}

/**
 * Player 2 for a local co-op `campaign:start`. A logged-in P2 proves who they are with a
 * short-lived token, fetched for every start: Retry, Next Level and Restart sent none, so the
 * server played P2 as a guest from the second level on.
 */
export async function localP2StartData(
  identity: LocalCoopP2Identity | undefined,
): Promise<{ userId?: number; username: string; guestColor?: number; token?: string }> {
  const fallbackName = t('campaign:localCoopModal.defaultPlayerName');
  if (identity?.mode === 'loggedIn' && identity.loggedInUserId) {
    let token: string | undefined;
    try {
      token = (await ApiClient.get<{ token: string }>('/local-coop/socket-token')).token;
    } catch {
      // Without a token the server falls back to a guest P2
    }
    return {
      userId: identity.loggedInUserId,
      username: identity.loggedInUsername || fallbackName,
      token,
    };
  }
  return { username: identity?.guestName || fallbackName, guestColor: identity?.guestColor };
}

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
