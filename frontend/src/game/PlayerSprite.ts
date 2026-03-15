import Phaser from 'phaser';
import { PlayerState, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { PLAYER_COLORS } from '../scenes/BootScene';

// Team color indices: team 0 uses red-ish colors, team 1 uses blue-ish colors
const TEAM_COLOR_INDICES: Record<number, number[]> = {
  0: [0, 3, 5], // red (#e94560), orange (#ff8800), yellow (#ffff44)
  1: [1, 7, 4], // blue (#44aaff), cyan (#44ffff), purple (#cc44ff)
};

export class PlayerSpriteRenderer {
  private scene: Phaser.Scene;
  private localPlayerId: number;

  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private labels: Map<number, Phaser.GameObjects.Text> = new Map();
  private teamIndicators: Map<number, Phaser.GameObjects.Graphics> = new Map();
  private shieldGraphics: Map<number, Phaser.GameObjects.Graphics> = new Map();

  /** Maps player ID -> color index for consistent color assignment */
  private playerColorIndex: Map<number, number> = new Map();

  /** Previous shield state per player for detecting shield breaks */
  private prevShieldState: Map<number, boolean> = new Map();

  /** Previous positions per player for detecting movement */
  private prevPositions: Map<number, { x: number; y: number }> = new Map();

  /** Track team assignments per player */
  private playerTeams: Map<number, number | null> = new Map();

  /** Counter per team for distributing colors within a team */
  private teamPlayerCount: Record<number, number> = {};

  constructor(scene: Phaser.Scene, localPlayerId: number) {
    this.scene = scene;
    this.localPlayerId = localPlayerId;
  }

  update(players: PlayerState[]): void {
    const activeIds = new Set(players.map((p) => p.id));

    // Remove sprites for players no longer in the array
    for (const [id] of this.sprites) {
      if (!activeIds.has(id)) {
        this.removePlayer(id);
      }
    }

    const settings = getSettings();

    players.forEach((player, index) => {
      const targetX = player.position.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = player.position.y * TILE_SIZE + TILE_SIZE / 2;

      if (!player.alive) {
        // Play death animation if sprite still exists, then remove
        const existing = this.sprites.get(player.id);
        if (existing) {
          this.sprites.delete(player.id);

          if (settings.animations) {
            existing.setTint(0xff0000);

            // Get player color for death particles
            const colorIndex = this.playerColorIndex.get(player.id) ?? index % 8;
            const playerColor = PLAYER_COLORS[colorIndex];

            this.scene.tweens.add({
              targets: existing,
              alpha: 0,
              scaleX: 0.2,
              scaleY: 0.2,
              rotation: existing.rotation + Math.PI * 2,
              duration: 400,
              ease: 'Power2',
              onComplete: () => existing.destroy(),
            });

            // Burst particles in player color
            if (settings.particles) {
              // Create a temporary tinted texture for particles
              const emitter = this.scene.add.particles(existing.x, existing.y, 'particle_star', {
                speed: { min: 60, max: 160 },
                lifespan: 500,
                scale: { start: 1.2, end: 0 },
                alpha: { start: 1, end: 0 },
                quantity: 15,
                frequency: -1, // explode mode
                tint: playerColor,
                angle: { min: 0, max: 360 },
              });
              emitter.explode(15);
              this.scene.time.delayedCall(600, () => emitter.destroy());
            }
          } else {
            existing.destroy();
          }

          // Remove label
          const existingLabel = this.labels.get(player.id);
          if (existingLabel) {
            this.labels.delete(player.id);
            if (settings.animations) {
              this.scene.tweens.add({
                targets: existingLabel,
                alpha: 0,
                y: existingLabel.y - 20,
                duration: 400,
                ease: 'Power2',
                onComplete: () => existingLabel.destroy(),
              });
            } else {
              existingLabel.destroy();
            }
          }

          // Remove team indicator
          const teamGfx = this.teamIndicators.get(player.id);
          if (teamGfx) {
            teamGfx.destroy();
            this.teamIndicators.delete(player.id);
          }

          // Remove shield graphic
          const shieldGfx = this.shieldGraphics.get(player.id);
          if (shieldGfx) {
            shieldGfx.destroy();
            this.shieldGraphics.delete(player.id);
          }

          // Clean up tracking maps
          this.prevShieldState.delete(player.id);
          this.prevPositions.delete(player.id);
          this.playerColorIndex.delete(player.id);
          this.playerTeams.delete(player.id);
        }
        return;
      }

      // ---- Alive player logic ----

      let sprite = this.sprites.get(player.id);
      let colorIndex = this.playerColorIndex.get(player.id);

      if (colorIndex === undefined) {
        // Assign color based on team membership or individual index
        if (player.team !== null && player.team !== undefined) {
          const teamColors = TEAM_COLOR_INDICES[player.team] || TEAM_COLOR_INDICES[0];
          const teamIdx = this.teamPlayerCount[player.team] || 0;
          colorIndex = teamColors[teamIdx % teamColors.length];
          this.teamPlayerCount[player.team] = teamIdx + 1;
        } else {
          colorIndex = index % 8;
        }
        this.playerColorIndex.set(player.id, colorIndex);
        this.playerTeams.set(player.id, player.team);
      }

      if (!sprite) {
        const dir = player.direction || 'down';
        const textureKey = `player_${colorIndex}_${dir}`;
        sprite = this.scene.add.sprite(targetX, targetY, textureKey);
        sprite.setDepth(10);
        sprite.setDisplaySize(TILE_SIZE - 4, TILE_SIZE - 4);
        this.sprites.set(player.id, sprite);

        // Create name label with team color tint
        const isTeamMode = player.team !== null && player.team !== undefined;
        const teamLabelColors = ['#ff6b7f', '#6bb8ff'];
        const labelColor = isTeamMode ? teamLabelColors[player.team!] : '#ffffff';
        const label = this.scene.add
          .text(targetX, targetY - TILE_SIZE / 2 - 2, player.username, {
            fontSize: '11px',
            color: labelColor,
            stroke: '#000000',
            strokeThickness: 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(11);
        this.labels.set(player.id, label);

        // Team colored underline indicator
        if (isTeamMode) {
          const teamGfx = this.scene.add.graphics();
          teamGfx.setDepth(9);
          const teamColor = player.team === 0 ? 0xe94560 : 0x44aaff;
          teamGfx.fillStyle(teamColor, 0.35);
          teamGfx.fillRoundedRect(
            targetX - TILE_SIZE / 2 + 1,
            targetY + TILE_SIZE / 2 - 5,
            TILE_SIZE - 2,
            4,
            2,
          );
          this.teamIndicators.set(player.id, teamGfx);
        }

        // Initialize tracking
        this.prevPositions.set(player.id, { x: targetX, y: targetY });
        this.prevShieldState.set(player.id, player.hasShield);
      }

      // Interpolate position
      sprite.x = Phaser.Math.Linear(sprite.x, targetX, 0.18);
      sprite.y = Phaser.Math.Linear(sprite.y, targetY, 0.18);

      // Update texture based on direction
      const dirTexture = `player_${colorIndex}_${player.direction}`;
      if (sprite.texture.key !== dirTexture && this.scene.textures.exists(dirTexture)) {
        sprite.setTexture(dirTexture);
      }

      // Detect movement
      const prevPos = this.prevPositions.get(player.id);
      const moved =
        prevPos && (Math.abs(prevPos.x - targetX) > 1 || Math.abs(prevPos.y - targetY) > 1);

      if (moved) {
        // Squash/stretch on movement
        if (settings.animations && sprite.scaleX === sprite.displayWidth / sprite.width) {
          // Only add tween if not already tweening scale
          this.scene.tweens.add({
            targets: sprite,
            scaleX: sprite.scaleX * 1.15,
            scaleY: sprite.scaleY * 0.85,
            duration: 50,
            yoyo: true,
            ease: 'Sine.easeOut',
          });
        }

        // Dust particles behind player on movement
        if (settings.particles) {
          const dustX = sprite.x;
          const dustY = sprite.y + (TILE_SIZE - 4) / 2;
          const emitter = this.scene.add.particles(dustX, dustY, 'particle_smoke', {
            speed: { min: 10, max: 30 },
            lifespan: 300,
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.4, end: 0 },
            quantity: Phaser.Math.Between(2, 3),
            frequency: -1,
            gravityY: -20,
            angle: { min: 160, max: 200 },
          });
          emitter.explode(Phaser.Math.Between(2, 3));
          this.scene.time.delayedCall(400, () => emitter.destroy());
        }
      }

      this.prevPositions.set(player.id, { x: targetX, y: targetY });

      // ---- Shield visual ----
      const hadShield = this.prevShieldState.get(player.id) ?? false;
      this.prevShieldState.set(player.id, player.hasShield);

      if (player.hasShield) {
        let shieldGfx = this.shieldGraphics.get(player.id);
        if (!shieldGfx) {
          shieldGfx = this.scene.add.graphics();
          shieldGfx.setDepth(12);
          this.shieldGraphics.set(player.id, shieldGfx);
        }
        // Oscillating alpha
        const time = this.scene.time.now;
        const oscillation = 0.25 + 0.15 * Math.sin(time * 0.005);

        shieldGfx.clear();
        shieldGfx.fillStyle(0x44ff44, oscillation);
        shieldGfx.fillCircle(sprite.x, sprite.y, (TILE_SIZE - 4) / 2 + 4);
        shieldGfx.lineStyle(2, 0x88ffaa, oscillation + 0.2);
        shieldGfx.strokeCircle(sprite.x, sprite.y, (TILE_SIZE - 4) / 2 + 4);
      } else {
        // Remove shield graphic if it exists
        const shieldGfx = this.shieldGraphics.get(player.id);
        if (shieldGfx) {
          shieldGfx.destroy();
          this.shieldGraphics.delete(player.id);
        }

        // Shield break effect: had shield before, doesn't now
        if (hadShield && settings.particles) {
          const emitter = this.scene.add.particles(sprite.x, sprite.y, 'particle_shield', {
            speed: { min: 80, max: 180 },
            lifespan: 400,
            scale: { start: 1, end: 0 },
            alpha: { start: 0.8, end: 0 },
            quantity: 12,
            frequency: -1,
            angle: { min: 0, max: 360 },
            tint: 0x44ff44,
          });
          emitter.explode(12);
          this.scene.time.delayedCall(500, () => emitter.destroy());
        }
      }

      // Update label position to follow sprite
      const label = this.labels.get(player.id);
      if (label) {
        label.x = sprite.x;
        label.y = sprite.y - TILE_SIZE / 2 - 2;
      }

      // Update team indicator position
      const teamGfx = this.teamIndicators.get(player.id);
      if (teamGfx) {
        const teamColor = player.team === 0 ? 0xe94560 : 0x44aaff;
        teamGfx.clear();
        teamGfx.fillStyle(teamColor, 0.35);
        teamGfx.fillRoundedRect(
          sprite.x - TILE_SIZE / 2 + 1,
          sprite.y + TILE_SIZE / 2 - 5,
          TILE_SIZE - 2,
          4,
          2,
        );
      }
    });
  }

  getSprite(id: number): Phaser.GameObjects.Sprite | undefined {
    return this.sprites.get(id);
  }

  destroy(): void {
    for (const [id] of this.sprites) {
      this.removePlayer(id);
    }
    this.sprites.clear();
    this.labels.clear();
    this.teamIndicators.clear();
    this.shieldGraphics.clear();
    this.playerColorIndex.clear();
    this.playerTeams.clear();
    this.prevShieldState.clear();
    this.prevPositions.clear();
    this.teamPlayerCount = {};
  }

  private removePlayer(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }

    const label = this.labels.get(id);
    if (label) {
      label.destroy();
      this.labels.delete(id);
    }

    const teamGfx = this.teamIndicators.get(id);
    if (teamGfx) {
      teamGfx.destroy();
      this.teamIndicators.delete(id);
    }

    const shieldGfx = this.shieldGraphics.get(id);
    if (shieldGfx) {
      shieldGfx.destroy();
      this.shieldGraphics.delete(id);
    }

    this.prevShieldState.delete(id);
    this.prevPositions.delete(id);
    this.playerColorIndex.delete(id);
    this.playerTeams.delete(id);
  }
}
