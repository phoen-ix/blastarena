import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { TILE_SIZE, Position } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { audioManager } from './AudioManager';
import { POWERUP_COLORS } from '../scenes/BootScene';
import { t } from '../i18n';

/**
 * Upper bound on debris bursts per tile-destruction batch. A wall-collapse event or a long pierce
 * chain can clear dozens of tiles in one tick; past this many, extra bursts add nothing visible.
 */
const MAX_DEBRIS_BURSTS = 24;
/** Alive-particle cap for the shared debris emitter (~20 tiles' worth). */
const MAX_DEBRIS_PARTICLES = 160;

export class EffectSystem {
  private scene: Phaser.Scene;
  private socketClient: SocketClient;
  private localPlayerId: number;
  private localPlayerAlive: boolean = true;
  private pendingShakeIntensity: number = 0;
  private pendingShakeDuration: number = 0;
  private shakeScheduled: boolean = false;
  wrappingMapSize: { width: number; height: number } | null = null;
  /**
   * One pooled emitter for every tile-destruction burst. Previously each destroyed tile got its
   * own emitter plus a 500ms timer to destroy it again — a wall collapse or pierce chain created
   * dozens at once. (audit F6)
   */
  private debrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  private explosionHandler:
    | ((data: { cells: { x: number; y: number }[]; ownerId: number }) => void)
    | null = null;
  private playerDiedHandler:
    | ((data: { playerId: number; killerId: number | null }) => void)
    | null = null;
  private powerupCollectedHandler:
    | ((data: { playerId: number; type: string; position: { x: number; y: number } }) => void)
    | null = null;

  constructor(scene: Phaser.Scene, socketClient: SocketClient, localPlayerId: number) {
    this.scene = scene;
    this.socketClient = socketClient;
    this.localPlayerId = localPlayerId;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.explosionHandler = (data) => {
      this.onExplosion(data.cells);
    };

    this.playerDiedHandler = (data) => {
      this.onPlayerDied(data.playerId);
    };

    this.powerupCollectedHandler = (data) => {
      if (data.playerId === this.localPlayerId) {
        audioManager.powerUpCollect();
      }
      // The pickup burst + floating label existed but nothing called it. (audit G2)
      this.onPowerUpCollected(data.position.x, data.position.y, data.type);
    };

    this.socketClient.on('game:explosion', this.explosionHandler);
    this.socketClient.on('game:playerDied', this.playerDiedHandler);
    this.socketClient.on('game:powerupCollected', this.powerupCollectedHandler);
  }

  /** An open-world re-join can hand a guest a new id. */
  setLocalPlayerId(id: number): void {
    this.localPlayerId = id;
  }

  setLocalPlayerAlive(alive: boolean): void {
    this.localPlayerAlive = alive;
  }

  /** The shared debris emitter, created on first use (the emitter sits at the origin, so the
   * world position passed to emitParticleAt is the particle's local position). */
  private getDebrisEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (!this.debrisEmitter || !this.debrisEmitter.active) {
      this.debrisEmitter = this.scene.add.particles(0, 0, 'particle_debris', {
        speed: { min: 40, max: 120 },
        lifespan: 400,
        scale: { start: 1, end: 0.3 },
        alpha: { start: 0.9, end: 0 },
        gravityY: 200,
        angle: { min: 0, max: 360 },
        emitting: false,
        maxAliveParticles: MAX_DEBRIS_PARTICLES,
      });
      this.debrisEmitter.setDepth(9);
    }
    return this.debrisEmitter;
  }

  /** Called when tiles are destroyed - triggers debris particles (audit F6) */
  onTilesDestroyed(positions: Position[]): void {
    const settings = getSettings();
    if (!settings.particles || positions.length === 0) return;

    const emitter = this.getDebrisEmitter();
    const bursts = Math.min(positions.length, MAX_DEBRIS_BURSTS);
    for (let i = 0; i < bursts; i++) {
      const pos = positions[i];
      emitter.emitParticleAt(
        pos.x * TILE_SIZE + TILE_SIZE / 2,
        pos.y * TILE_SIZE + TILE_SIZE / 2,
        Phaser.Math.Between(6, 8),
      );
    }
  }

  /** Short-lived burst at a world position; the emitter frees itself after the particles die. */
  private burst(
    px: number,
    py: number,
    texture: string,
    config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
    count: number,
    ttlMs: number,
  ): void {
    const emitter = this.scene.add.particles(px, py, texture, { ...config, emitting: false });
    emitter.setDepth(9);
    emitter.explode(count);
    this.scene.time.delayedCall(ttlMs, () => {
      if (emitter && emitter.active) emitter.destroy();
    });
  }

  /** Called when a power-up is collected - shows text popup and particles */
  onPowerUpCollected(x: number, y: number, type: string): void {
    const settings = getSettings();
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;
    const color = POWERUP_COLORS[type] ?? 0xffffff;

    if (settings.particles) {
      this.burst(
        px,
        py,
        'particle_star',
        {
          speed: { min: 40, max: 100 },
          lifespan: 400,
          scale: { start: 1, end: 0 },
          alpha: { start: 0.9, end: 0 },
          tint: color,
          angle: { min: 0, max: 360 },
        },
        10,
        500,
      );
    }

    if (settings.animations) {
      const fallback = type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const name = t(`game:powerups.${type}.name`, { defaultValue: fallback });
      const colorHex = '#' + color.toString(16).padStart(6, '0');
      const text = this.scene.add
        .text(px, py - 10, name, {
          fontSize: '12px',
          color: colorHex,
          stroke: '#000000',
          strokeThickness: 2,
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(20);

      this.scene.tweens.add({
        targets: text,
        y: py - 40,
        alpha: 0,
        duration: 800,
        ease: 'Power2',
        onComplete: () => text.destroy(),
      });
    }
  }

  private onExplosion(cells: { x: number; y: number }[]): void {
    const cam = this.scene.cameras.main;
    const camCenterX = cam.scrollX + cam.width / 2;
    const camCenterY = cam.scrollY + cam.height / 2;

    // Find closest explosion cell to camera center (wrapped distance for toroidal maps)
    const worldW = this.wrappingMapSize ? this.wrappingMapSize.width * TILE_SIZE : 0;
    const worldH = this.wrappingMapSize ? this.wrappingMapSize.height * TILE_SIZE : 0;
    let minDist = Infinity;
    for (const cell of cells) {
      const px = cell.x * TILE_SIZE + TILE_SIZE / 2;
      const py = cell.y * TILE_SIZE + TILE_SIZE / 2;
      let dx = Math.abs(px - camCenterX);
      let dy = Math.abs(py - camCenterY);
      if (this.wrappingMapSize) {
        dx = Math.min(dx, worldW - dx);
        dy = Math.min(dy, worldH - dy);
      }
      const dist = dx + dy;
      if (dist < minDist) minDist = dist;
    }

    const tilesDist = minDist / TILE_SIZE;

    // Play explosion sound scaled by distance (always, regardless of visual settings)
    audioManager.explosion(tilesDist);

    if (!this.localPlayerAlive) return;
    const settings = getSettings();
    if (!settings.screenShake) return;

    if (tilesDist > 6) return;

    // Scale intensity inversely with distance
    const intensity = Math.max(0.003, 0.015 * (1 - tilesDist / 6));
    const duration = Math.max(80, 200 * (1 - tilesDist / 6));

    // Coalesce: keep the strongest shake, apply once per frame
    if (intensity > this.pendingShakeIntensity) {
      this.pendingShakeIntensity = intensity;
      this.pendingShakeDuration = duration;
    }

    if (!this.shakeScheduled) {
      this.shakeScheduled = true;
      queueMicrotask(() => {
        if (this.pendingShakeIntensity > 0) {
          cam.shake(this.pendingShakeDuration, this.pendingShakeIntensity);
          if (this.pendingShakeIntensity >= 0.012) {
            cam.flash(80, 255, 200, 100, true);
          }
        }
        this.pendingShakeIntensity = 0;
        this.pendingShakeDuration = 0;
        this.shakeScheduled = false;
      });
    }
  }

  private onPlayerDied(playerId: number): void {
    if (playerId === this.localPlayerId) {
      this.localPlayerAlive = false;
      audioManager.death();
      const settings = getSettings();
      if (settings.screenShake) {
        this.scene.cameras.main.shake(300, 0.02);
      }
    }
  }

  /**
   * Campaign enemy defeated: a burst at the tile, and a heavier one plus a camera shake for a
   * boss. The server has always emitted `campaign:enemyDied`; nothing listened. (audit G7)
   */
  onEnemyDied(position: Position, isBoss: boolean): void {
    const settings = getSettings();
    const px = position.x * TILE_SIZE + TILE_SIZE / 2;
    const py = position.y * TILE_SIZE + TILE_SIZE / 2;

    audioManager.shieldBreak();
    if (isBoss) audioManager.explosion(0);

    if (settings.particles) {
      this.burst(
        px,
        py,
        'particle_star',
        {
          speed: { min: 60, max: isBoss ? 220 : 140 },
          lifespan: isBoss ? 700 : 450,
          scale: { start: isBoss ? 1.6 : 1.1, end: 0 },
          alpha: { start: 1, end: 0 },
          tint: isBoss ? [0xffdd44, 0xff4444, 0xffffff] : 0xff6666,
          angle: { min: 0, max: 360 },
        },
        isBoss ? 36 : 14,
        isBoss ? 800 : 550,
      );
      if (isBoss) {
        this.burst(
          px,
          py,
          'particle_smoke',
          {
            speed: { min: 20, max: 60 },
            lifespan: 900,
            scale: { start: 1.5, end: 0.4 },
            alpha: { start: 0.6, end: 0 },
            gravityY: -30,
            angle: { min: 0, max: 360 },
          },
          12,
          1000,
        );
      }
    }

    if (isBoss && settings.screenShake) {
      this.scene.cameras.main.shake(400, 0.02);
    }
  }

  /** Direct trigger for replay mode (no socket events) */
  triggerExplosion(data: { cells: { x: number; y: number }[]; ownerId: number }): void {
    this.onExplosion(data.cells);
  }

  /** Direct trigger for replay mode (no socket events) */
  triggerPlayerDied(data: { playerId: number; killerId: number | null }): void {
    this.onPlayerDied(data.playerId);
  }

  destroy(): void {
    if (this.explosionHandler) {
      this.socketClient.off('game:explosion', this.explosionHandler);
    }
    if (this.playerDiedHandler) {
      this.socketClient.off('game:playerDied', this.playerDiedHandler);
    }
    if (this.powerupCollectedHandler) {
      this.socketClient.off('game:powerupCollected', this.powerupCollectedHandler);
    }
    if (this.debrisEmitter?.active) this.debrisEmitter.destroy();
    this.debrisEmitter = null;
  }
}
