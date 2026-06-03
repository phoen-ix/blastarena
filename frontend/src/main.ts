import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import { HUDScene } from './scenes/HUDScene';
import { GameOverScene } from './scenes/GameOverScene';
import { LevelEditorScene } from './scenes/LevelEditorScene';
import { themeManager } from './themes/ThemeManager';
import { initI18n } from './i18n';
import { audioManager } from './game/AudioManager';

let game: Phaser.Game;

async function boot(): Promise<Phaser.Game> {
  // Initialize i18n before anything else
  await initI18n();

  // Read background color from CSS variable (set by flash prevention script)
  const computedStyle = getComputedStyle(document.documentElement);
  const bgColor = computedStyle.getPropertyValue('--bg-deep').trim() || '#080810';

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: bgColor,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
      },
    },
    audio: {
      noAudio: true, // Phaser audio unused — we use Web Audio API via AudioManager
    },
    input: {
      gamepad: true,
    },
    scene: [BootScene, MenuScene, LobbyScene, GameScene, HUDScene, GameOverScene, LevelEditorScene],
  };

  game = new Phaser.Game(config);

  // Initialize audio on first user interaction (required by browser autoplay policy)
  const initAudio = () => {
    audioManager.init();
    document.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
  };
  document.addEventListener('click', initAudio);
  document.addEventListener('keydown', initAudio);

  // Initialize theme manager (async, fetches admin default if no user preference)
  themeManager.initialize();

  // Update canvas background when theme changes
  themeManager.onChange(() => {
    const newBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim();
    if (newBg && game.canvas) {
      game.canvas.style.backgroundColor = newBg;
    }
  });

  return game;
}

boot();

// Named export of the `let` so importers get a LIVE binding to the instance assigned inside the
// async boot(). A `export default game` would snapshot `undefined` (boot() runs after this line),
// which is why non-scene modules (e.g. OpenWorldView) previously saw `game` as undefined.
export { game };
