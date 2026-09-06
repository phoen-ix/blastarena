import type Phaser from 'phaser';
import { i18n } from '../i18n';

/**
 * Lazy registration of LevelEditorScene.
 *
 * The editor (2,000+ lines, plus EnemyTextureGenerator and the campaign theme rasterisers) is
 * reachable only from views that are themselves lazy chunks — the maps view, room creation and
 * the admin campaign tab — yet it was listed in the Phaser config and so shipped in the main
 * bundle for every visitor. It is now a separate chunk, added to the scene manager the first
 * time something needs it. Callers `await` this before `scene.start('LevelEditorScene')`.
 * (audit F9)
 */

const SCENE_KEY = 'LevelEditorScene';

let pending: Promise<void> | null = null;

export async function ensureLevelEditorScene(game: Phaser.Game): Promise<void> {
  if (game.scene.getScene(SCENE_KEY)) return;
  if (!pending) {
    // The editor's own locale namespace is fetched alongside its chunk rather than at boot for
    // every visitor. (audit I18N-LOAD-1)
    pending = Promise.all([import('./LevelEditorScene'), i18n.loadNamespaces('editor')])
      .then(([{ LevelEditorScene }]) => {
        // Re-check: a parallel caller may have registered it while the chunk loaded
        if (!game.scene.getScene(SCENE_KEY)) {
          game.scene.add(SCENE_KEY, LevelEditorScene);
        }
      })
      .finally(() => {
        pending = null;
      });
  }
  await pending;
}
