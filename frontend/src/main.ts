import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import { HUDScene } from './scenes/HUDScene';
import { GameOverScene } from './scenes/GameOverScene';
import { LevelEditorScene } from './scenes/LevelEditorScene';
import { themeManager } from './themes/ThemeManager';

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
    noAudio: true,
  },
  render: {
    premultipliedAlpha: false,
    mipmapFilter: 'NEAREST',
  },
  input: {
    gamepad: true,
  },
  scene: [BootScene, MenuScene, LobbyScene, GameScene, HUDScene, GameOverScene, LevelEditorScene],
};

const game = new Phaser.Game(config);

// Initialize theme manager (async, fetches admin default if no user preference)
themeManager.initialize();

// Update canvas background when theme changes
themeManager.onChange(() => {
  const newBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim();
  if (newBg && game.canvas) {
    game.canvas.style.backgroundColor = newBg;
  }
});

export default game;
