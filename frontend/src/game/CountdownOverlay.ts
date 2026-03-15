import Phaser from 'phaser';
import { getSettings } from './Settings';

export class CountdownOverlay {
  private scene: Phaser.Scene;
  private active: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Call when game status transitions to 'playing' */
  show(): void {
    if (this.active) return;
    this.active = true;

    const settings = getSettings();
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;

    const items = ['3', '2', '1', 'GO!'];
    const colors = ['#ff6b35', '#ff6b35', '#ff6b35', '#00e676'];

    items.forEach((label, i) => {
      this.scene.time.delayedCall(i * 600, () => {
        const text = this.scene.add.text(cx, cy, label, {
          fontSize: '72px',
          color: colors[i],
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(100).setScrollFactor(0);

        if (settings.animations) {
          text.setScale(3);
          this.scene.tweens.add({
            targets: text,
            scale: 1,
            duration: 400,
            ease: 'Back.Out',
          });
        }

        this.scene.tweens.add({
          targets: text,
          alpha: 0,
          delay: 400,
          duration: 200,
          onComplete: () => {
            text.destroy();
            if (i === items.length - 1) this.active = false;
          },
        });
      });
    });
  }

  destroy(): void {
    this.active = false;
  }
}
