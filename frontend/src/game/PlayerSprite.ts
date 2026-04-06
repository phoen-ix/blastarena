import Phaser from 'phaser';
import { PlayerState, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { PLAYER_COLORS, BootScene } from '../scenes/BootScene';

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

  /** Wrapping map dimensions (set for open world) */
  wrappingWorldSize: { w: number; h: number } | null = null;

  /** Players currently in a squash/stretch tween (prevents stacking) */
  private activeMoveAnim: Set<number> = new Set();

  /** Reusable dust emitters per player (avoids create/destroy per movement) */
  private dustEmitters: Map<number, Phaser.GameObjects.Particles.ParticleEmitter> = new Map();

  /** Track team assignments per player */
  private playerTeams: Map<number, number | null> = new Map();

  /** Counter per team for distributing colors within a team */
  private teamPlayerCount: Record<number, number> = {};

  /** Custom texture key overrides per player (from cosmetics) */
  private customTexturePrefix: Map<number, string> = new Map();

  /** Trail particle emitters per player */
  private trailEmitters: Map<number, Phaser.GameObjects.Particles.ParticleEmitter> = new Map();

  /** Ghost sprites for wrapping maps (same pattern as BombSpriteRenderer) */
  private ghostSprites: Map<number, Phaser.GameObjects.Image[]> = new Map();

  /** Ghost copies of player overlays for wrapping maps */
  private ghostShieldGraphics: Map<number, Phaser.GameObjects.Graphics[]> = new Map();
  private ghostLabels: Map<number, Phaser.GameObjects.Text[]> = new Map();
  private ghostTeamIndicators: Map<number, Phaser.GameObjects.Graphics[]> = new Map();

  /** Buddy mode: player ID, size, and glow color */
  private buddyPlayerId: number | null = null;
  private buddySizePercent: number = 60;
  private buddyGlowColor: number = 0x44aaff;
  private buddyGlowGraphics: Map<number, Phaser.GameObjects.Graphics> = new Map();

  constructor(scene: Phaser.Scene, localPlayerId: number) {
    this.scene = scene;
    this.localPlayerId = localPlayerId;
  }

  setBuddyPlayer(playerId: number, sizePercent: number, glowColor: number): void {
    this.buddyPlayerId = playerId;
    this.buddySizePercent = sizePercent;
    this.buddyGlowColor = glowColor;
  }

  update(players: PlayerState[]): void {
    // Auto-detect buddy from state if not explicitly set
    if (!this.buddyPlayerId) {
      const buddy = players.find((p) => p.isBuddy);
      if (buddy) {
        this.buddyPlayerId = buddy.id;
      }
    }

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
            const playerColor =
              player.cosmetics?.colorHex ??
              (colorIndex >= 0 ? PLAYER_COLORS[colorIndex] : 0xffffff);

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

          // Remove buddy glow graphic
          const glowGfx = this.buddyGlowGraphics.get(player.id);
          if (glowGfx) {
            glowGfx.destroy();
            this.buddyGlowGraphics.delete(player.id);
          }

          // Clean up ghost sprites and overlays
          const ghostsDeath = this.ghostSprites.get(player.id);
          if (ghostsDeath) {
            for (const g of ghostsDeath) g.destroy();
            this.ghostSprites.delete(player.id);
          }
          this.destroyGhostOverlays(player.id);

          // Clean up tracking maps
          this.prevShieldState.delete(player.id);
          this.prevPositions.delete(player.id);
          this.playerColorIndex.delete(player.id);
          this.playerTeams.delete(player.id);
          this.activeMoveAnim.delete(player.id);
        }
        return;
      }

      // ---- Alive player logic ----

      let sprite = this.sprites.get(player.id);
      let colorIndex = this.playerColorIndex.get(player.id);

      if (colorIndex === undefined) {
        // Priority: 1) cosmetic color, 2) team color, 3) index-based
        if (player.cosmetics?.colorHex) {
          // Generate custom textures if needed
          BootScene.generateCustomPlayerTextures(
            this.scene,
            player.cosmetics.colorHex,
            player.cosmetics.eyeStyle,
          );
          const suffix = player.cosmetics.eyeStyle
            ? `${player.cosmetics.colorHex.toString(16)}_${player.cosmetics.eyeStyle}`
            : player.cosmetics.colorHex.toString(16);
          this.customTexturePrefix.set(player.id, `player_custom_${suffix}`);
          colorIndex = -1; // Sentinel: use custom prefix
        } else if (player.team !== null && player.team !== undefined) {
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
        const customPrefix = this.customTexturePrefix.get(player.id);
        const textureKey = customPrefix ? `${customPrefix}_${dir}` : `player_${colorIndex}_${dir}`;
        sprite = this.scene.add.sprite(targetX, targetY, textureKey);
        sprite.setDepth(10);
        const isBuddy = player.id === this.buddyPlayerId;
        const displaySize = isBuddy
          ? (TILE_SIZE - 4) * (this.buddySizePercent / 100)
          : TILE_SIZE - 4;
        sprite.setDisplaySize(displaySize, displaySize);
        this.sprites.set(player.id, sprite);

        // Create name label with team color tint
        const isTeamMode = player.team !== null && player.team !== undefined;
        const teamLabelColors = ['#ff6b7f', '#6bb8ff'];
        const labelColor = isTeamMode ? teamLabelColors[player.team!] : '#ffffff';
        const labelOffset = isBuddy ? displaySize / 2 + 2 : TILE_SIZE / 2 + 2;
        const label = this.scene.add
          .text(targetX, targetY - labelOffset, player.username, {
            fontSize: '11px',
            color: labelColor,
            stroke: '#000000',
            strokeThickness: 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(11);
        this.labels.set(player.id, label);

        // Team colored underline indicator (drawn at origin, positioned via setPosition)
        if (isTeamMode) {
          const teamGfx = this.scene.add.graphics();
          teamGfx.setDepth(9);
          const teamColor = player.team === 0 ? 0xe94560 : 0x44aaff;
          teamGfx.fillStyle(teamColor, 0.35);
          teamGfx.fillRoundedRect(-TILE_SIZE / 2 + 1, TILE_SIZE / 2 - 5, TILE_SIZE - 2, 4, 2);
          teamGfx.setPosition(targetX, targetY);
          this.teamIndicators.set(player.id, teamGfx);
        }

        // Initialize tracking
        this.prevPositions.set(player.id, { x: targetX, y: targetY });
        this.prevShieldState.set(player.id, player.hasShield);
      }

      // Interpolate position (wrapping-aware for toroidal maps)
      // Sprite stays in canonical range [0, worldW). Ghost sprites handle edge visibility.
      if (this.wrappingWorldSize) {
        const { w, h } = this.wrappingWorldSize;
        let dx = targetX - sprite.x;
        let dy = targetY - sprite.y;
        if (dx > w / 2) dx -= w;
        else if (dx < -w / 2) dx += w;
        if (dy > h / 2) dy -= h;
        else if (dy < -h / 2) dy += h;
        sprite.x += dx * 0.45;
        sprite.y += dy * 0.45;
        // Wrap to canonical range
        sprite.x = ((sprite.x % w) + w) % w;
        sprite.y = ((sprite.y % h) + h) % h;
      } else {
        sprite.x = Phaser.Math.Linear(sprite.x, targetX, 0.45);
        sprite.y = Phaser.Math.Linear(sprite.y, targetY, 0.45);
      }

      // Update texture based on direction
      const customPrefix = this.customTexturePrefix.get(player.id);
      const dirTexture = customPrefix
        ? `${customPrefix}_${player.direction}`
        : `player_${colorIndex}_${player.direction}`;
      if (sprite.texture.key !== dirTexture && this.scene.textures.exists(dirTexture)) {
        sprite.setTexture(dirTexture);
      }

      // Enforce buddy display size every frame (setTexture and tweens can reset it)
      if (player.id === this.buddyPlayerId) {
        const buddySize = (TILE_SIZE - 4) * (this.buddySizePercent / 100);
        sprite.setDisplaySize(buddySize, buddySize);
      }

      // Trail particles for cosmetic trails
      if (player.cosmetics?.trailConfig && getSettings().particles) {
        let emitter = this.trailEmitters.get(player.id);
        if (!emitter && this.scene.textures.exists(player.cosmetics.trailConfig.particleKey)) {
          emitter = this.scene.add.particles(0, 0, player.cosmetics.trailConfig.particleKey, {
            speed: { min: 5, max: 15 },
            scale: { start: 0.5, end: 0 },
            lifespan: 400,
            alpha: { start: 0.6, end: 0 },
            frequency: player.cosmetics.trailConfig.frequency,
            tint: player.cosmetics.trailConfig.tint,
            emitting: true,
          });
          emitter.setDepth(5);
          this.trailEmitters.set(player.id, emitter);
        }
        if (emitter) {
          emitter.setPosition(sprite.x, sprite.y);
        }
      }

      // Detect movement
      const prevPos = this.prevPositions.get(player.id);
      const moved =
        prevPos && (Math.abs(prevPos.x - targetX) > 1 || Math.abs(prevPos.y - targetY) > 1);

      if (moved) {
        // Squash/stretch on movement
        if (settings.animations && !this.activeMoveAnim.has(player.id)) {
          this.activeMoveAnim.add(player.id);
          this.scene.tweens.add({
            targets: sprite,
            scaleX: sprite.scaleX * 1.15,
            scaleY: sprite.scaleY * 0.85,
            duration: 50,
            yoyo: true,
            ease: 'Sine.easeOut',
            onComplete: () => this.activeMoveAnim.delete(player.id),
          });
        }

        // Dust particles behind player on movement (reuse emitter per player)
        if (settings.particles) {
          let emitter = this.dustEmitters.get(player.id);
          if (!emitter) {
            emitter = this.scene.add.particles(0, 0, 'particle_smoke', {
              speed: { min: 10, max: 30 },
              lifespan: 300,
              scale: { start: 0.5, end: 0 },
              alpha: { start: 0.4, end: 0 },
              quantity: Phaser.Math.Between(2, 3),
              frequency: -1,
              gravityY: -20,
              angle: { min: 160, max: 200 },
            });
            emitter.setDepth(5);
            this.dustEmitters.set(player.id, emitter);
          }
          emitter.setPosition(sprite.x, sprite.y + (TILE_SIZE - 4) / 2);
          emitter.explode(Phaser.Math.Between(2, 3));
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
        // Oscillating alpha (redraw only every ~3 frames for performance)
        const time = this.scene.time.now;
        const oscillation = 0.25 + 0.15 * Math.sin(time * 0.005);

        shieldGfx.clear();
        shieldGfx.fillStyle(0x44ff44, oscillation);
        shieldGfx.fillCircle(0, 0, (TILE_SIZE - 4) / 2 + 4);
        shieldGfx.lineStyle(2, 0x88ffaa, oscillation + 0.2);
        shieldGfx.strokeCircle(0, 0, (TILE_SIZE - 4) / 2 + 4);
        shieldGfx.setPosition(sprite.x, sprite.y);
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

      // Buddy glow aura
      if (player.id === this.buddyPlayerId) {
        let glowGfx = this.buddyGlowGraphics.get(player.id);
        if (!glowGfx) {
          glowGfx = this.scene.add.graphics();
          glowGfx.setDepth(8); // Below player (10), above floor
          this.buddyGlowGraphics.set(player.id, glowGfx);
        }

        const time = this.scene.time.now;
        const pulse = 0.15 + 0.08 * Math.sin(time * 0.003);
        const buddyDisplaySize = (TILE_SIZE - 4) * (this.buddySizePercent / 100);
        const glowRadius = buddyDisplaySize / 2 + 6;

        glowGfx.clear();
        glowGfx.fillStyle(this.buddyGlowColor, pulse * 0.5);
        glowGfx.fillCircle(0, 0, glowRadius + 4);
        glowGfx.fillStyle(this.buddyGlowColor, pulse);
        glowGfx.fillCircle(0, 0, glowRadius);
        glowGfx.lineStyle(1.5, this.buddyGlowColor, pulse + 0.1);
        glowGfx.strokeCircle(0, 0, glowRadius + 2);
        glowGfx.setPosition(sprite.x, sprite.y);
      }

      // Update label position to follow sprite
      const label = this.labels.get(player.id);
      if (label) {
        const isBuddyPlayer = player.id === this.buddyPlayerId;
        const labelYOffset = isBuddyPlayer
          ? ((TILE_SIZE - 4) * (this.buddySizePercent / 100)) / 2 + 2
          : TILE_SIZE / 2 + 2;
        label.x = sprite.x;
        label.y = sprite.y - labelYOffset;
      }

      // Update team indicator position (setPosition only — no clear/redraw)
      const teamGfx = this.teamIndicators.get(player.id);
      if (teamGfx) {
        teamGfx.setPosition(sprite.x, sprite.y);
      }

      // Ghost sprites for wrapping maps (entity visible on both sides of the edge)
      if (this.wrappingWorldSize) {
        this.updatePlayerGhosts(
          player.id,
          sprite.x,
          sprite.y,
          sprite.texture.key,
          sprite.displayWidth,
        );
      }
    });
  }

  /** Create/update ghost copies of a player sprite and overlays near wrapping edges */
  private updatePlayerGhosts(
    playerId: number,
    px: number,
    py: number,
    textureKey: string,
    displaySize: number,
  ): void {
    if (!this.wrappingWorldSize) return;
    const { w, h } = this.wrappingWorldSize;
    // Threshold: half the world size ensures ghosts cover any viewport width up to the world size
    const thresholdX = w / 2;
    const thresholdY = h / 2;
    const nearLeft = px < thresholdX;
    const nearRight = px > w - thresholdX;
    const nearTop = py < thresholdY;
    const nearBottom = py > h - thresholdY;

    const offsets: { ox: number; oy: number }[] = [];
    if (nearLeft) offsets.push({ ox: w, oy: 0 });
    if (nearRight) offsets.push({ ox: -w, oy: 0 });
    if (nearTop) offsets.push({ ox: 0, oy: h });
    if (nearBottom) offsets.push({ ox: 0, oy: -h });
    if (nearLeft && nearTop) offsets.push({ ox: w, oy: h });
    if (nearLeft && nearBottom) offsets.push({ ox: w, oy: -h });
    if (nearRight && nearTop) offsets.push({ ox: -w, oy: h });
    if (nearRight && nearBottom) offsets.push({ ox: -w, oy: -h });

    let ghosts = this.ghostSprites.get(playerId);

    if (ghosts && ghosts.length !== offsets.length) {
      for (const g of ghosts) g.destroy();
      ghosts = undefined;
      this.ghostSprites.delete(playerId);
      // Offset count changed — destroy overlay ghosts so they get re-created
      this.destroyGhostOverlays(playerId);
    }

    if (offsets.length === 0) {
      if (ghosts) {
        for (const g of ghosts) g.destroy();
        this.ghostSprites.delete(playerId);
      }
      this.destroyGhostOverlays(playerId);
      return;
    }

    if (!ghosts) {
      ghosts = offsets.map(({ ox, oy }) => {
        const img = this.scene.add.image(px + ox, py + oy, textureKey);
        img.setDepth(10);
        img.setDisplaySize(displaySize, displaySize);
        return img;
      });
      this.ghostSprites.set(playerId, ghosts);
    } else {
      for (let i = 0; i < offsets.length; i++) {
        ghosts[i].setPosition(px + offsets[i].ox, py + offsets[i].oy);
        ghosts[i].setTexture(textureKey);
        ghosts[i].setDisplaySize(displaySize, displaySize);
      }
    }

    // --- Ghost overlays: shield, label, team indicator ---

    // Shield ghosts
    const canonicalShield = this.shieldGraphics.get(playerId);
    if (canonicalShield) {
      let gShields = this.ghostShieldGraphics.get(playerId);
      if (!gShields || gShields.length !== offsets.length) {
        if (gShields) for (const g of gShields) g.destroy();
        gShields = offsets.map(() => {
          const gfx = this.scene.add.graphics();
          gfx.setDepth(12);
          return gfx;
        });
        this.ghostShieldGraphics.set(playerId, gShields);
      }
      const time = this.scene.time.now;
      const oscillation = 0.25 + 0.15 * Math.sin(time * 0.005);
      const radius = (TILE_SIZE - 4) / 2 + 4;
      for (let i = 0; i < offsets.length; i++) {
        gShields[i].clear();
        gShields[i].fillStyle(0x44ff44, oscillation);
        gShields[i].fillCircle(0, 0, radius);
        gShields[i].lineStyle(2, 0x88ffaa, oscillation + 0.2);
        gShields[i].strokeCircle(0, 0, radius);
        gShields[i].setPosition(
          canonicalShield.x + offsets[i].ox,
          canonicalShield.y + offsets[i].oy,
        );
      }
    } else {
      const gShields = this.ghostShieldGraphics.get(playerId);
      if (gShields) {
        for (const g of gShields) g.destroy();
        this.ghostShieldGraphics.delete(playerId);
      }
    }

    // Label ghosts
    const canonicalLabel = this.labels.get(playerId);
    if (canonicalLabel) {
      let gLabels = this.ghostLabels.get(playerId);
      if (!gLabels || gLabels.length !== offsets.length) {
        if (gLabels) for (const g of gLabels) g.destroy();
        gLabels = offsets.map(() => {
          const txt = this.scene.add
            .text(0, 0, canonicalLabel.text, {
              fontSize: '11px',
              color: canonicalLabel.style.color as string,
              stroke: '#000000',
              strokeThickness: 2,
            })
            .setOrigin(0.5, 1)
            .setDepth(11);
          return txt;
        });
        this.ghostLabels.set(playerId, gLabels);
      }
      for (let i = 0; i < offsets.length; i++) {
        gLabels[i].setPosition(canonicalLabel.x + offsets[i].ox, canonicalLabel.y + offsets[i].oy);
      }
    } else {
      const gLabels = this.ghostLabels.get(playerId);
      if (gLabels) {
        for (const g of gLabels) g.destroy();
        this.ghostLabels.delete(playerId);
      }
    }

    // Team indicator ghosts
    const canonicalTeam = this.teamIndicators.get(playerId);
    if (canonicalTeam) {
      let gTeam = this.ghostTeamIndicators.get(playerId);
      if (!gTeam || gTeam.length !== offsets.length) {
        if (gTeam) for (const g of gTeam) g.destroy();
        const team = this.playerTeams.get(playerId);
        const teamColor = team === 0 ? 0xe94560 : 0x44aaff;
        gTeam = offsets.map(() => {
          const gfx = this.scene.add.graphics();
          gfx.setDepth(9);
          gfx.fillStyle(teamColor, 0.35);
          gfx.fillRoundedRect(-TILE_SIZE / 2 + 1, TILE_SIZE / 2 - 5, TILE_SIZE - 2, 4, 2);
          return gfx;
        });
        this.ghostTeamIndicators.set(playerId, gTeam);
      }
      for (let i = 0; i < offsets.length; i++) {
        gTeam[i].setPosition(canonicalTeam.x + offsets[i].ox, canonicalTeam.y + offsets[i].oy);
      }
    } else {
      const gTeam = this.ghostTeamIndicators.get(playerId);
      if (gTeam) {
        for (const g of gTeam) g.destroy();
        this.ghostTeamIndicators.delete(playerId);
      }
    }
  }

  /** Destroy all ghost overlay objects for a player */
  private destroyGhostOverlays(playerId: number): void {
    const gShields = this.ghostShieldGraphics.get(playerId);
    if (gShields) {
      for (const g of gShields) g.destroy();
      this.ghostShieldGraphics.delete(playerId);
    }
    const gLabels = this.ghostLabels.get(playerId);
    if (gLabels) {
      for (const g of gLabels) g.destroy();
      this.ghostLabels.delete(playerId);
    }
    const gTeam = this.ghostTeamIndicators.get(playerId);
    if (gTeam) {
      for (const g of gTeam) g.destroy();
      this.ghostTeamIndicators.delete(playerId);
    }
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
    for (const glow of this.buddyGlowGraphics.values()) glow.destroy();
    this.buddyGlowGraphics.clear();
    for (const emitter of this.dustEmitters.values()) emitter.destroy();
    this.dustEmitters.clear();
    for (const ghosts of this.ghostSprites.values()) {
      for (const g of ghosts) g.destroy();
    }
    this.ghostSprites.clear();
    for (const arr of this.ghostShieldGraphics.values()) {
      for (const g of arr) g.destroy();
    }
    this.ghostShieldGraphics.clear();
    for (const arr of this.ghostLabels.values()) {
      for (const g of arr) g.destroy();
    }
    this.ghostLabels.clear();
    for (const arr of this.ghostTeamIndicators.values()) {
      for (const g of arr) g.destroy();
    }
    this.ghostTeamIndicators.clear();
    this.playerColorIndex.clear();
    this.playerTeams.clear();
    this.prevShieldState.clear();
    this.prevPositions.clear();
    this.activeMoveAnim.clear();
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

    const glowGfx = this.buddyGlowGraphics.get(id);
    if (glowGfx) {
      glowGfx.destroy();
      this.buddyGlowGraphics.delete(id);
    }

    const ghostsRemove = this.ghostSprites.get(id);
    if (ghostsRemove) {
      for (const g of ghostsRemove) g.destroy();
      this.ghostSprites.delete(id);
    }
    this.destroyGhostOverlays(id);

    const dustEmitter = this.dustEmitters.get(id);
    if (dustEmitter) {
      dustEmitter.destroy();
      this.dustEmitters.delete(id);
    }

    const trailEmitter = this.trailEmitters.get(id);
    if (trailEmitter) {
      trailEmitter.destroy();
      this.trailEmitters.delete(id);
    }

    this.prevShieldState.delete(id);
    this.prevPositions.delete(id);
    this.playerColorIndex.delete(id);
    this.playerTeams.delete(id);
    this.customTexturePrefix.delete(id);
    this.activeMoveAnim.delete(id);
  }
}
