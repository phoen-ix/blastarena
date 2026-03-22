import { MapEvent, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';

interface TrackedMeteor {
  /** The target tile position */
  tileX: number;
  tileY: number;
  /** Tick when the meteor impacts */
  impactTick: number;
  /** Tick when the warning started */
  warningTick: number;
  /** Pulsing target reticle on the ground */
  targetGraphics: Phaser.GameObjects.Graphics;
  /** Growing shadow beneath the incoming meteor */
  shadowGraphics: Phaser.GameObjects.Graphics;
  /** Exclamation warning text */
  warningText: Phaser.GameObjects.Text;
  /** Whether the impact animation has been triggered */
  impacted: boolean;
}

export class MapEventRenderer {
  private scene: Phaser.Scene;
  private tracked: Map<string, TrackedMeteor> = new Map();
  /** Reusable set to detect removed events */
  private activeKeys = new Set<string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(mapEvents: MapEvent[] | undefined, currentTick: number): void {
    const events = mapEvents ?? [];
    this.activeKeys.clear();

    for (const event of events) {
      if (event.type !== 'meteor' || !event.position || event.warningTick == null) continue;

      const key = `meteor_${event.position.x}_${event.position.y}_${event.tick}`;
      this.activeKeys.add(key);

      const existing = this.tracked.get(key);
      if (!existing) {
        this.createMeteorWarning(key, event);
      }

      // Update warning animation based on progress
      const tracked = this.tracked.get(key);
      if (tracked && !tracked.impacted) {
        this.updateWarningPhase(tracked, currentTick);
      }
    }

    // Clean up meteors that are no longer in mapEvents (they've impacted)
    for (const [key, tracked] of this.tracked) {
      if (!this.activeKeys.has(key)) {
        if (!tracked.impacted) {
          this.triggerImpact(tracked);
        }
        // Give impact animation time to play, then clean up
        this.scene.time.delayedCall(1200, () => {
          this.destroyTracked(tracked);
          this.tracked.delete(key);
        });
        // Remove from tracked iteration but keep reference for cleanup
        // We mark it so we don't re-trigger
        tracked.impacted = true;
      }
    }
  }

  private createMeteorWarning(key: string, event: MapEvent): void {
    const pos = event.position!;
    const px = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = pos.y * TILE_SIZE + TILE_SIZE / 2;

    // Target reticle graphics
    const targetGraphics = this.scene.add.graphics();
    targetGraphics.setDepth(7); // Above powerups, below explosions

    // Shadow (grows as meteor approaches)
    const shadowGraphics = this.scene.add.graphics();
    shadowGraphics.setDepth(1); // Just above floor

    // Warning exclamation
    const warningText = this.scene.add.text(px, py - TILE_SIZE * 0.8, '!', {
      fontSize: '28px',
      fontFamily: 'Chakra Petch, sans-serif',
      color: '#ff4444',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(16); // Above most things

    const settings = getSettings();
    if (settings.animations) {
      // Pulsing exclamation
      this.scene.tweens.add({
        targets: warningText,
        scale: { from: 0.8, to: 1.3 },
        alpha: { from: 0.7, to: 1 },
        duration: 300,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this.tracked.set(key, {
      tileX: pos.x,
      tileY: pos.y,
      impactTick: event.tick,
      warningTick: event.warningTick!,
      targetGraphics,
      shadowGraphics,
      warningText,
      impacted: false,
    });
  }

  private updateWarningPhase(tracked: TrackedMeteor, currentTick: number): void {
    const totalWarning = tracked.impactTick - tracked.warningTick;
    const remaining = Math.max(0, tracked.impactTick - currentTick);
    const progress = 1 - remaining / totalWarning; // 0 → 1 as impact approaches

    const px = tracked.tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tracked.tileY * TILE_SIZE + TILE_SIZE / 2;
    const halfTile = TILE_SIZE / 2;

    // Redraw target reticle — intensifies as impact approaches
    const gfx = tracked.targetGraphics;
    gfx.clear();

    const pulsePhase = Math.sin(currentTick * 0.4) * 0.5 + 0.5;
    const baseAlpha = 0.3 + progress * 0.5;
    const alpha = baseAlpha + pulsePhase * 0.2;

    // Outer danger zone ring
    const ringRadius = halfTile * (1.5 - progress * 0.3);
    gfx.lineStyle(2, 0xff2200, alpha * 0.6);
    gfx.strokeCircle(px, py, ringRadius);

    // Inner target circle
    gfx.lineStyle(2 + progress * 2, 0xff4400, alpha);
    gfx.strokeCircle(px, py, halfTile * 0.6);

    // Crosshair lines
    const crossLen = halfTile * 0.9;
    gfx.lineStyle(1.5 + progress, 0xff4400, alpha * 0.8);
    gfx.lineBetween(px - crossLen, py, px - crossLen * 0.3, py);
    gfx.lineBetween(px + crossLen * 0.3, py, px + crossLen, py);
    gfx.lineBetween(px, py - crossLen, px, py - crossLen * 0.3);
    gfx.lineBetween(px, py + crossLen * 0.3, px, py + crossLen);

    // Fill danger zone with pulsing red
    gfx.fillStyle(0xff2200, alpha * 0.15 + pulsePhase * 0.1);
    gfx.fillCircle(px, py, halfTile * 0.8);

    // Center dot
    gfx.fillStyle(0xff0000, alpha);
    gfx.fillCircle(px, py, 3);

    // Shadow — grows and darkens as meteor approaches
    const shadowGfx = tracked.shadowGraphics;
    shadowGfx.clear();
    const shadowScale = 0.2 + progress * 0.8;
    const shadowAlpha = 0.05 + progress * 0.25;
    shadowGfx.fillStyle(0x000000, shadowAlpha);
    shadowGfx.fillEllipse(px, py, TILE_SIZE * shadowScale, TILE_SIZE * shadowScale * 0.6);

    // Warning text gets more urgent — move up slightly and intensify color
    if (progress > 0.7) {
      tracked.warningText.setColor('#ff0000');
      tracked.warningText.setFontSize(32);
    }
  }

  private triggerImpact(tracked: TrackedMeteor): void {
    const px = tracked.tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tracked.tileY * TILE_SIZE + TILE_SIZE / 2;
    const settings = getSettings();

    // Hide warning elements
    tracked.targetGraphics.setVisible(false);
    tracked.warningText.setVisible(false);
    tracked.shadowGraphics.setVisible(false);

    if (settings.animations) {
      // Falling meteor sprite
      const meteorSprite = this.scene.add.sprite(px, py - 400, 'meteor');
      meteorSprite.setDepth(20);
      meteorSprite.setScale(1.5);
      meteorSprite.setAngle(-30);

      // Falling tween
      this.scene.tweens.add({
        targets: meteorSprite,
        x: px,
        y: py,
        scale: 1,
        angle: 15,
        duration: 250,
        ease: 'Quad.In',
        onComplete: () => {
          // Impact flash
          const flash = this.scene.add.graphics();
          flash.setDepth(18);
          flash.fillStyle(0xffaa00, 0.6);
          flash.fillCircle(px, py, TILE_SIZE * 2.5);
          flash.fillStyle(0xffffff, 0.4);
          flash.fillCircle(px, py, TILE_SIZE);

          this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 400,
            ease: 'Power2',
            onComplete: () => flash.destroy(),
          });

          // Remove meteor sprite after brief linger
          this.scene.tweens.add({
            targets: meteorSprite,
            alpha: 0,
            scale: 0.3,
            duration: 200,
            delay: 100,
            onComplete: () => meteorSprite.destroy(),
          });
        },
      });
    }

    if (settings.particles) {
      // Debris burst
      const debrisEmitter = this.scene.add.particles(px, py, 'particle_debris', {
        speed: { min: 80, max: 200 },
        lifespan: 600,
        scale: { start: 1.5, end: 0 },
        gravityY: 200,
        emitting: false,
      });
      debrisEmitter.setDepth(18);
      debrisEmitter.explode(12);

      this.scene.time.delayedCall(700, () => {
        if (debrisEmitter?.active) debrisEmitter.destroy();
      });

      // Fire burst
      const fireEmitter = this.scene.add.particles(px, py, 'particle_fire', {
        speed: { min: 60, max: 160 },
        lifespan: 500,
        scale: { start: 2, end: 0 },
        tint: [0xff4400, 0xff6600, 0xffaa00],
        emitting: false,
      });
      fireEmitter.setDepth(18);
      fireEmitter.explode(10);

      this.scene.time.delayedCall(600, () => {
        if (fireEmitter?.active) fireEmitter.destroy();
      });

      // Sparks
      const sparkEmitter = this.scene.add.particles(px, py, 'particle_spark', {
        speed: { min: 100, max: 250 },
        lifespan: 400,
        scale: { start: 1.5, end: 0 },
        emitting: false,
      });
      sparkEmitter.setDepth(18);
      sparkEmitter.explode(8);

      this.scene.time.delayedCall(500, () => {
        if (sparkEmitter?.active) sparkEmitter.destroy();
      });
    }

    // Screen shake
    if (settings.screenShake) {
      this.scene.cameras.main.shake(350, 0.025);
    }
  }

  private destroyTracked(tracked: TrackedMeteor): void {
    this.scene.tweens.killTweensOf(tracked.warningText);
    if (tracked.targetGraphics?.active) tracked.targetGraphics.destroy();
    if (tracked.shadowGraphics?.active) tracked.shadowGraphics.destroy();
    if (tracked.warningText?.active) tracked.warningText.destroy();
  }

  destroy(): void {
    for (const tracked of this.tracked.values()) {
      this.destroyTracked(tracked);
    }
    this.tracked.clear();
  }
}
