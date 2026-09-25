import { GameState, ReplayData } from '@blast-arena/shared';
import { game } from '../../main';
import type { AdminReturn } from './adminReturn';

/**
 * Play a replay full screen; closing it reopens the admin panel at `returnTo`. Shared by the
 * Matches, Campaign and Simulations tabs, which each carried their own copy of this and all
 * returned to the lobby's default view.
 */
export function startReplay(replayData: ReplayData, returnTo: AdminReturn): void {
  // Reconstruct initial GameState from first frame + stored map
  const firstFrame = replayData.frames[0];
  const initialState: GameState = {
    tick: firstFrame.tick,
    players: firstFrame.players,
    bombs: firstFrame.bombs,
    explosions: firstFrame.explosions,
    powerUps: firstFrame.powerUps,
    map: replayData.map,
    status: firstFrame.status,
    winnerId: firstFrame.winnerId,
    winnerTeam: firstFrame.winnerTeam,
    roundTime: firstFrame.roundTime,
    timeElapsed: firstFrame.timeElapsed,
  };
  if (firstFrame.zone) initialState.zone = firstFrame.zone;
  if (firstFrame.hillZone) initialState.hillZone = firstFrame.hillZone;
  if (firstFrame.kothScores) initialState.kothScores = firstFrame.kothScores;

  // Clear all DOM overlays (admin panel, lobby, etc.)
  const uiOverlay = document.getElementById('ui-overlay');
  if (uiOverlay) {
    while (uiOverlay.firstChild) {
      uiOverlay.removeChild(uiOverlay.firstChild);
    }
  }

  // Set registry values for GameScene
  const registry = game.registry;
  registry.set('initialGameState', initialState);
  registry.set('replayMode', true);
  registry.set('replayData', replayData);
  registry.set('replayReturnTo', returnTo);
  if (replayData.campaign) {
    registry.set('campaignMode', true);
  }

  // Start GameScene and HUDScene
  const activeScene = game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
  if (activeScene) {
    activeScene.scene.start('GameScene');
    activeScene.scene.launch('HUDScene');
  }
}
