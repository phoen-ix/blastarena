import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { TILE_SIZE, Position } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { audioManager } from './AudioManager';

export class EffectSystem {
  private scene: Phaser.Scene;
  private socketClient: SocketClient;
  private localPlayerId: number;
  private localPlayerAlive: boolean = true;
  private pendingShakeIntensity: number = 0;
  private pendingShakeDuration: number = 0;
  private shakeScheduled: boolean = false;
  wrappingMapSize: { width: number; height: number } | null = null;

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
    };

    this.socketClient.on('game:explosion', this.explosionHandler);
    this.socketClient.on('game:playerDied', this.playerDiedHandler);
    this.socketClient.on('game:powerupCollected', this.powerupCollectedHandler);
  }

  setLocalPlayerAlive(alive: boolean): void {
    this.localPlayerAlive = alive;
  }

  /** Called when tiles are destroyed - triggers debris particles */
  onTilesDestroyed(positions: Position[]): void {
    const settings = getSettings();
    if (!settings.particles) return;

    for (const pos of positions) {
      const x = pos.x * TILE_SIZE + TILE_SIZE / 2;
      const y = pos.y * TILE_SIZE + TILE_SIZE / 2;

      const emitter = this.scene.add.particles(x, y, 'particle_debris', {
        speed: { min: 40, max: 120 },
        lifespan: 400,
        scale: { start: 1, end: 0.3 },
        alpha: { start: 0.9, end: 0 },
        gravityY: 200,
        angle: { min: 0, max: 360 },
        emitting: false,
      });
      emitter.setDepth(9);
      emitter.explode(Phaser.Math.Between(6, 8));
      this.scene.time.delayedCall(500, () => {
        if (emitter && emitter.active) emitter.destroy();
      });
    }
  }

  /** Called when a power-up is collected - shows text popup and particles */
  onPowerUpCollected(x: number, y: number, type: string, color: number): void {
    const settings = getSettings();
    const px = x * TILE_SIZE + TILE_SIZE / 2;
    const py = y * TILE_SIZE + TILE_SIZE / 2;

    if (settings.particles) {
      const emitter = this.scene.add.particles(px, py, 'particle_star', {
        speed: { min: 40, max: 100 },
        lifespan: 400,
        scale: { start: 1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: color,
        angle: { min: 0, max: 360 },
        emitting: false,
      });
      emitter.setDepth(9);
      emitter.explode(10);
      this.scene.time.delayedCall(500, () => {
        if (emitter && emitter.active) emitter.destroy();
      });
    }

    if (settings.animations) {
      const name = type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
  }
}
