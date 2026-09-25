import { MapEvent, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';

interface TrackedWarning {
  type: 'wall_collapse' | 'freeze_wave';
  graphics: Phaser.GameObjects.Graphics;
  warningText: Phaser.GameObjects.Text;
  impactTick: number;
  warningTick: number;
  /** For wall_collapse: top-left position. For freeze_wave: row/column index */
  position: { x: number; y: number };
  direction?: 'row' | 'column';
  index?: number;
  impacted: boolean;
}

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

interface TrackedUfo {
  tileX: number;
  tileY: number;
  targetPlayerId: number;
  impactTick: number;
  warningTick: number;
  ufoGraphics: Phaser.GameObjects.Graphics;
  beamGraphics: Phaser.GameObjects.Graphics;
  warningText: Phaser.GameObjects.Text;
  impacted: boolean;
}

export class MapEventRenderer {
  private scene: Phaser.Scene;
  private tracked: Map<string, TrackedMeteor> = new Map();
  private trackedWarnings: Map<string, TrackedWarning> = new Map();
  private trackedUfos: Map<string, TrackedUfo> = new Map();
  /**
   * Spectator action flashes, tracked apart from the meteors. They used to be stored as fake
   * TrackedMeteor entries padded with a dummy Graphics and a dummy Text — neither of which the
   * flash tween destroyed, so every spectator action leaked two game objects. (audit C5)
   */
  private flashes: Map<string, Phaser.GameObjects.Graphics> = new Map();
  /** Reusable set to detect removed events */
  private activeKeys = new Set<string>();
  private lastBombSurgeTick: number = -1;
  /**
   * Map size in pixels, for effects that span a whole row/column. Set by the scene; falls back to
   * the viewport size when unknown. (audit C10)
   */
  private worldWidth: number = 0;
  private worldHeight: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Tell the renderer how large the map is (tiles). Call again when the map changes. */
  setMapSize(width: number, height: number): void {
    this.worldWidth = width * TILE_SIZE;
    this.worldHeight = height * TILE_SIZE;
  }

  update(mapEvents: MapEvent[] | undefined, currentTick: number): void {
    const events = mapEvents ?? [];
    this.activeKeys.clear();

    for (const event of events) {
      // Meteor warnings
      if (event.type === 'meteor' && event.position && event.warningTick != null) {
        const key = `meteor_${event.position.x}_${event.position.y}_${event.tick}`;
        this.activeKeys.add(key);

        if (!this.tracked.has(key)) {
          this.createMeteorWarning(key, event);
        }
        const tracked = this.tracked.get(key);
        if (tracked && !tracked.impacted) {
          this.updateWarningPhase(tracked, currentTick);
        }
      }

      // Wall collapse warnings (reuse meteor-like pattern)
      if (event.type === 'wall_collapse' && event.position && event.warningTick != null) {
        const key = `collapse_${event.position.x}_${event.position.y}_${event.tick}`;
        this.activeKeys.add(key);
        if (!this.trackedWarnings.has(key)) {
          this.createAreaWarning(key, event, 'wall_collapse');
        }
        const tw = this.trackedWarnings.get(key);
        if (tw && !tw.impacted) {
          this.updateAreaWarning(tw, currentTick);
        }
      }

      // Freeze wave warnings
      if (event.type === 'freeze_wave' && event.warningTick != null) {
        const key = `freeze_${event.direction}_${event.index}_${event.tick}`;
        this.activeKeys.add(key);
        if (!this.trackedWarnings.has(key)) {
          this.createAreaWarning(key, event, 'freeze_wave');
        }
        const tw = this.trackedWarnings.get(key);
        if (tw && !tw.impacted) {
          this.updateAreaWarning(tw, currentTick);
        }
      }

      // Bomb surge — instant visual effect
      if (event.type === 'bomb_surge' && event.tick !== this.lastBombSurgeTick) {
        this.lastBombSurgeTick = event.tick;
        this.triggerBombSurge();
      }

      // UFO abduction warnings
      if (event.type === 'ufo_abduction' && event.position && event.warningTick != null) {
        const key = `ufo_${event.targetPlayerId}_${event.tick}`;
        this.activeKeys.add(key);

        if (!this.trackedUfos.has(key)) {
          this.createUfoWarning(key, event);
        }
        const ufo = this.trackedUfos.get(key);
        if (ufo && !ufo.impacted) {
          this.updateUfoWarning(ufo, currentTick);
        }
      }

      // Spectator wall placement — brief flash
      if (event.type === 'spectator_wall' && event.position) {
        const key = `specwall_${event.position.x}_${event.position.y}_${event.tick}`;
        this.activeKeys.add(key);
        if (!this.flashes.has(key)) {
          this.createSpectatorFlash(key, event.position, 0x8888ff);
        }
      }

      // Spectator power-up drop — sparkle
      if (event.type === 'spectator_powerup' && event.position) {
        const key = `specpu_${event.position.x}_${event.position.y}_${event.tick}`;
        this.activeKeys.add(key);
        if (!this.flashes.has(key)) {
          this.createSpectatorFlash(key, event.position, 0xffdd00);
        }
      }

      // Spectator speed zone — pulsing circle
      if (event.type === 'spectator_speed_zone' && event.position) {
        const key = `speczone_${event.position.x}_${event.position.y}_${event.tick}`;
        this.activeKeys.add(key);
        if (!this.flashes.has(key)) {
          this.createSpectatorFlash(key, event.position, 0x44aaff);
        }
      }
    }

    // Clean up meteors that are no longer in mapEvents (they've impacted).
    //
    // The impact is flagged on the first tick the event is missing, and the delayed teardown is
    // armed in that same branch. It used to sit outside the `impacted` check, so every tick of the
    // 1.2s grace window re-armed another timer — ~24 duplicate delayedCalls per meteor, each
    // running destroyTracked() on already-destroyed objects. Same for the warnings and UFOs
    // below. (audit C5)
    for (const [key, tracked] of this.tracked) {
      if (!this.activeKeys.has(key) && !tracked.impacted) {
        tracked.impacted = true;
        this.triggerImpact(tracked);
        this.scene.time.delayedCall(1200, () => {
          this.destroyTracked(tracked);
          this.tracked.delete(key);
        });
      }
    }

    // Clean up area warnings that have resolved
    for (const [key, tw] of this.trackedWarnings) {
      if (!this.activeKeys.has(key) && !tw.impacted) {
        tw.impacted = true;
        // Flash effect on impact
        const settings = getSettings();
        if (settings.screenShake && tw.type === 'wall_collapse') {
          this.scene.cameras.main.shake(250, 0.015);
        }
        this.scene.time.delayedCall(500, () => {
          if (tw.graphics?.active) tw.graphics.destroy();
          if (tw.warningText?.active) {
            this.scene.tweens.killTweensOf(tw.warningText);
            tw.warningText.destroy();
          }
          this.trackedWarnings.delete(key);
        });
      }
    }

    // Clean up UFO abductions that have resolved
    for (const [key, ufo] of this.trackedUfos) {
      if (!this.activeKeys.has(key) && !ufo.impacted) {
        ufo.impacted = true;
        this.triggerUfoImpact(ufo);
        this.scene.time.delayedCall(800, () => {
          this.destroyUfo(ufo);
          this.trackedUfos.delete(key);
        });
      }
    }

    // Spectator flashes whose event has left the state: the tween owns the Graphics' lifetime,
    // so just make sure nothing lingers once the event is gone.
    for (const [key, gfx] of this.flashes) {
      if (!this.activeKeys.has(key)) {
        this.destroyFlash(gfx);
        this.flashes.delete(key);
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

  private createAreaWarning(
    key: string,
    event: MapEvent,
    type: 'wall_collapse' | 'freeze_wave',
  ): void {
    const graphics = this.scene.add.graphics();
    graphics.setDepth(7);

    let labelX: number, labelY: number;
    if (type === 'wall_collapse' && event.position) {
      // 3x3 area warning
      labelX = (event.position.x + 1.5) * TILE_SIZE;
      labelY = (event.position.y + 1.5) * TILE_SIZE;
    } else {
      // Freeze wave — row or column
      const isRow = event.direction === 'row';
      labelX = isRow ? 3 * TILE_SIZE : (event.index ?? 0) * TILE_SIZE + TILE_SIZE / 2;
      labelY = isRow ? (event.index ?? 0) * TILE_SIZE + TILE_SIZE / 2 : 3 * TILE_SIZE;
    }

    const label = type === 'wall_collapse' ? '💥' : '❄';
    const warningText = this.scene.add.text(labelX, labelY - TILE_SIZE * 0.5, label, {
      fontSize: '24px',
      fontFamily: 'Chakra Petch, sans-serif',
      stroke: '#000000',
      strokeThickness: 3,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(16);

    const settings = getSettings();
    if (settings.animations) {
      this.scene.tweens.add({
        targets: warningText,
        scale: { from: 0.8, to: 1.3 },
        alpha: { from: 0.7, to: 1 },
        duration: 250,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this.trackedWarnings.set(key, {
      type,
      graphics,
      warningText,
      impactTick: event.tick,
      warningTick: event.warningTick!,
      position: event.position ?? { x: 0, y: 0 },
      direction: event.direction,
      index: event.index,
      impacted: false,
    });
  }

  private updateAreaWarning(tw: TrackedWarning, currentTick: number): void {
    const totalWarning = tw.impactTick - tw.warningTick;
    const remaining = Math.max(0, tw.impactTick - currentTick);
    const progress = 1 - remaining / totalWarning;
    const gfx = tw.graphics;
    gfx.clear();

    const pulsePhase = Math.sin(currentTick * 0.5) * 0.5 + 0.5;
    const alpha = 0.15 + progress * 0.3 + pulsePhase * 0.1;

    if (tw.type === 'wall_collapse') {
      const x = tw.position.x * TILE_SIZE;
      const y = tw.position.y * TILE_SIZE;
      const w = 3 * TILE_SIZE;
      const h = 3 * TILE_SIZE;
      gfx.fillStyle(0xff6600, alpha);
      gfx.fillRect(x, y, w, h);
      gfx.lineStyle(2, 0xff4400, alpha + 0.2);
      gfx.strokeRect(x, y, w, h);
    } else {
      // Freeze wave — highlight row or column across the whole map. This used the viewport size,
      // so on maps wider than the screen the highlight stopped short of the far edge. (audit C10)
      const isRow = tw.direction === 'row';
      const color = 0x44ccff;
      const worldW = this.worldWidth || this.scene.scale.width;
      const worldH = this.worldHeight || this.scene.scale.height;
      if (isRow) {
        const y = tw.index! * TILE_SIZE;
        gfx.fillStyle(color, alpha);
        gfx.fillRect(0, y, worldW, TILE_SIZE);
        gfx.lineStyle(2, color, alpha + 0.2);
        gfx.strokeRect(0, y, worldW, TILE_SIZE);
      } else {
        const x = tw.index! * TILE_SIZE;
        gfx.fillStyle(color, alpha);
        gfx.fillRect(x, 0, TILE_SIZE, worldH);
        gfx.lineStyle(2, color, alpha + 0.2);
        gfx.strokeRect(x, 0, TILE_SIZE, worldH);
      }
    }
  }

  private triggerBombSurge(): void {
    const settings = getSettings();
    // Full-screen red/orange pulse overlay
    const flash = this.scene.add.graphics();
    flash.setDepth(25);
    flash.setScrollFactor(0); // Fixed to camera
    flash.fillStyle(0xff4400, 0.25);
    flash.fillRect(0, 0, this.scene.scale.width, this.scene.scale.height);

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 400,
      ease: 'Power2',
      onComplete: () => flash.destroy(),
    });

    if (settings.screenShake) {
      this.scene.cameras.main.shake(200, 0.01);
    }
  }

  private createUfoWarning(key: string, event: MapEvent): void {
    const pos = event.position!;
    const px = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = pos.y * TILE_SIZE + TILE_SIZE / 2;

    // UFO saucer above target
    const ufoGraphics = this.scene.add.graphics();
    ufoGraphics.setDepth(19);

    // Tractor beam
    const beamGraphics = this.scene.add.graphics();
    beamGraphics.setDepth(8);

    // Warning text
    const warningText = this.scene.add.text(px, py - TILE_SIZE * 1.8, '?!', {
      fontSize: '24px',
      fontFamily: 'Chakra Petch, sans-serif',
      color: '#44ff88',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    });
    warningText.setOrigin(0.5);
    warningText.setDepth(20);

    const settings = getSettings();
    if (settings.animations) {
      this.scene.tweens.add({
        targets: warningText,
        scale: { from: 0.8, to: 1.2 },
        alpha: { from: 0.7, to: 1 },
        duration: 350,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }

    this.trackedUfos.set(key, {
      tileX: pos.x,
      tileY: pos.y,
      targetPlayerId: event.targetPlayerId ?? 0,
      impactTick: event.tick,
      warningTick: event.warningTick!,
      ufoGraphics,
      beamGraphics,
      warningText,
      impacted: false,
    });
  }

  private updateUfoWarning(ufo: TrackedUfo, currentTick: number): void {
    const totalWarning = ufo.impactTick - ufo.warningTick;
    const remaining = Math.max(0, ufo.impactTick - currentTick);
    const progress = 1 - remaining / totalWarning;

    const px = ufo.tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = ufo.tileY * TILE_SIZE + TILE_SIZE / 2;
    const ufoY = py - TILE_SIZE * 2.5;

    // Draw UFO saucer
    const gfx = ufo.ufoGraphics;
    gfx.clear();

    const bob = Math.sin(currentTick * 0.3) * 3;

    // Saucer body (ellipse)
    gfx.fillStyle(0x888899, 0.9);
    gfx.fillEllipse(px, ufoY + bob, TILE_SIZE * 1.2, TILE_SIZE * 0.4);
    // Dome on top
    gfx.fillStyle(0x66ddaa, 0.7);
    gfx.fillEllipse(px, ufoY - TILE_SIZE * 0.15 + bob, TILE_SIZE * 0.5, TILE_SIZE * 0.35);
    // Light strip
    gfx.fillStyle(0x44ff88, 0.6 + Math.sin(currentTick * 0.5) * 0.3);
    gfx.fillEllipse(px, ufoY + bob, TILE_SIZE * 1.0, TILE_SIZE * 0.12);

    // Draw tractor beam (triangle from UFO to ground)
    const beam = ufo.beamGraphics;
    beam.clear();

    const beamAlpha = 0.1 + progress * 0.25 + Math.sin(currentTick * 0.4) * 0.08;
    const beamWidth = TILE_SIZE * (0.3 + progress * 0.5);

    beam.fillStyle(0x44ff88, beamAlpha);
    beam.beginPath();
    beam.moveTo(px - TILE_SIZE * 0.2, ufoY + TILE_SIZE * 0.2 + bob);
    beam.lineTo(px + TILE_SIZE * 0.2, ufoY + TILE_SIZE * 0.2 + bob);
    beam.lineTo(px + beamWidth, py + TILE_SIZE * 0.5);
    beam.lineTo(px - beamWidth, py + TILE_SIZE * 0.5);
    beam.closePath();
    beam.fill();

    // Ground circle glow
    beam.fillStyle(0x44ff88, beamAlpha * 0.6);
    beam.fillCircle(px, py, TILE_SIZE * 0.5 * (0.5 + progress * 0.5));
  }

  private triggerUfoImpact(ufo: TrackedUfo): void {
    const px = ufo.tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = ufo.tileY * TILE_SIZE + TILE_SIZE / 2;

    // Hide warning elements
    ufo.ufoGraphics.setVisible(false);
    ufo.beamGraphics.setVisible(false);
    ufo.warningText.setVisible(false);

    const settings = getSettings();
    if (settings.animations) {
      // Flash at abduction point
      const flash = this.scene.add.graphics();
      flash.setDepth(18);
      flash.fillStyle(0x44ff88, 0.5);
      flash.fillCircle(px, py, TILE_SIZE * 1.5);

      this.scene.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 500,
        ease: 'Power2',
        onComplete: () => flash.destroy(),
      });
    }
  }

  private destroyUfo(ufo: TrackedUfo): void {
    this.scene.tweens.killTweensOf(ufo.warningText);
    if (ufo.ufoGraphics?.active) ufo.ufoGraphics.destroy();
    if (ufo.beamGraphics?.active) ufo.beamGraphics.destroy();
    if (ufo.warningText?.active) ufo.warningText.destroy();
  }

  private destroyTracked(tracked: TrackedMeteor): void {
    this.scene.tweens.killTweensOf(tracked.warningText);
    if (tracked.targetGraphics?.active) tracked.targetGraphics.destroy();
    if (tracked.shadowGraphics?.active) tracked.shadowGraphics.destroy();
    if (tracked.warningText?.active) tracked.warningText.destroy();
  }

  private destroyFlash(gfx: Phaser.GameObjects.Graphics): void {
    this.scene.tweens.killTweensOf(gfx);
    if (gfx.active) gfx.destroy();
  }

  destroy(): void {
    for (const tracked of this.tracked.values()) {
      this.destroyTracked(tracked);
    }
    this.tracked.clear();
    for (const tw of this.trackedWarnings.values()) {
      if (tw.graphics?.active) tw.graphics.destroy();
      if (tw.warningText?.active) {
        this.scene.tweens.killTweensOf(tw.warningText);
        tw.warningText.destroy();
      }
    }
    this.trackedWarnings.clear();
    for (const ufo of this.trackedUfos.values()) {
      this.destroyUfo(ufo);
    }
    this.trackedUfos.clear();
    for (const gfx of this.flashes.values()) {
      this.destroyFlash(gfx);
    }
    this.flashes.clear();
  }

  /**
   * Create a brief flash effect for spectator actions (wall/powerup/speed zone).
   *
   * The key is released when the tween completes, so while the event is still in the state the
   * flash re-fires every 600ms — a pulsing marker for the lifetime of the wall/zone. (audit C5)
   */
  private createSpectatorFlash(
    key: string,
    position: { x: number; y: number },
    color: number,
  ): void {
    const px = position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = position.y * TILE_SIZE + TILE_SIZE / 2;

    // Drawn around the object's origin and moved into place: the tween scales the Graphics about
    // (0, 0), so a circle drawn at (px, py) slid away from its tile as it grew.
    const gfx = this.scene.add.graphics();
    gfx.fillStyle(color, 0.6);
    gfx.fillCircle(0, 0, TILE_SIZE * 0.6);
    gfx.setPosition(px, py);
    gfx.setDepth(120);
    this.flashes.set(key, gfx);

    // Animate: pulse then fade
    this.scene.tweens.add({
      targets: gfx,
      alpha: { from: 0.8, to: 0 },
      scale: { from: 1, to: 1.5 },
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => {
        gfx.destroy();
        if (this.flashes.get(key) === gfx) this.flashes.delete(key);
      },
    });
  }
}
