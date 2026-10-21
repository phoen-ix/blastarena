import Phaser from 'phaser';
import { PlayerState, TILE_SIZE, TICK_MS } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { PLAYER_COLORS, BootScene } from '../scenes/BootScene';
import { wrapGhostOffsets } from '../utils/wrapGhosts';
import { DEPTH, Y_BIAS, setDepthIfChanged, ySortDepth } from '../art/depth';
import { base } from '../art/scale';
import { StyleArt } from '../art/StyleArt';
import type { StyledFx } from '../art/StyledFx';
import { TEAM_COLORS } from '../art/paint';
import type { EyeStyle } from '../art/painters/types';

// Team color indices: team 0 uses red-ish colors, team 1 uses blue-ish colors
const TEAM_COLOR_INDICES: Record<number, number[]> = {
  0: [0, 3, 5], // red (#e94560), orange (#ff8800), yellow (#ffff44)
  1: [1, 7, 4], // blue (#44aaff), cyan (#44ffff), purple (#cc44ff)
};

/**
 * Fraction of the remaining distance a sprite covers per server tick (50ms). frame() rescales
 * this to the actual frame delta, so the visual speed is the same at 30, 60 or 144 Hz.
 */
const LERP_PER_TICK = 0.45;

/**
 * A target that moves further than this between two states is a jump, not a step — a teleporter,
 * an open-world round start, a replay seek — and the sprite is put there instead of sliding
 * across the map. One tick moves a player two tiles at most (a step or conveyor push onto ice,
 * then the slide). Compared target to target: the sprite itself trails a fast walker by more.
 */
const SNAP_DISTANCE = TILE_SIZE * 3;

const SHIELD_RADIUS = (TILE_SIZE - 4) / 2 + 4;

/** Where a drawn-style player's feet are, below the tile centre (for depth sorting). */
const FOOT_OFFSET = 20;

/** Per-player state for the drawn art styles. */
interface StyledPlayer {
  key: string;
  dir: PlayerState['direction'];
  /** Interpolated position; the sprite adds the drop-in offset on top. */
  lx: number;
  ly: number;
  drop: number;
  nextBlink: number;
  blinkUntil: number;
  invulnerable: number;
  shield: Phaser.GameObjects.Sprite | null;
  teamRing: Phaser.GameObjects.Image | null;
  localRing: Phaser.GameObjects.Image | null;
}

export class PlayerSpriteRenderer {
  private scene: Phaser.Scene;

  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map();
  /**
   * Where each sprite is heading, from the last state update. The lerp itself runs in frame(),
   * once per rendered frame — it used to run in update(), i.e. only when a state arrived (20 Hz),
   * so at 60 fps two frames out of three drew the sprite exactly where the previous one had.
   * (audit F2)
   */
  private targetPositions: Map<number, { x: number; y: number }> = new Map();
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

  /** Cosmetic body colour per player, for colorOf(). */
  private customColor: Map<number, number> = new Map();
  /** Cosmetic eye style per player. */
  private customEyes: Map<number, EyeStyle> = new Map();
  /**
   * How each player was last drawn, for lookOf(). Kept through death (the colour index is
   * dropped then) so the kill feed can still show the victim.
   */
  private looks: Map<number, { color: number; eyes: EyeStyle }> = new Map();
  /** Classic sprites currently flickering for spawn invulnerability. */
  private flickering: Set<number> = new Set();
  /** Spawn-invulnerability ticks left per classic player (drawn styles keep it in `styled`). */
  private invulnerable: Map<number, number> = new Map();

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

  /** Set for the drawn art styles; null keeps the classic sprites and effects. */
  private fx: StyledFx | null;
  private styled: Map<number, StyledPlayer> = new Map();
  private localId: number | null = null;

  constructor(scene: Phaser.Scene, fx: StyledFx | null = null) {
    this.scene = scene;
    this.fx = fx;
  }

  /** The player this client controls (gets the "you" ring in the drawn styles). */
  setLocalPlayerId(id: number | null): void {
    this.localId = id;
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

          if (this.fx) {
            this.knockOutStyled(player.id, existing, settings.animations);
          } else if (settings.animations) {
            existing.setTint(0xff0000);

            // Get player color for death particles
            const colorIndex = this.playerColorIndex.get(player.id) ?? index % 8;
            const playerColor =
              player.cosmetics?.colorHex ??
              (colorIndex >= 0 ? PLAYER_COLORS[colorIndex] : 0xffffff);

            this.scene.tweens.add({
              targets: existing,
              alpha: 0,
              scaleX: 0.2 * base(existing),
              scaleY: 0.2 * base(existing),
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

          // Free the particle emitters. removePlayer() does this, but it only runs when a player
          // leaves the game — a dead player is still in state.players, so nothing released them.
          // A cosmetic trail emitter is frequency-driven with emitting:true, so it kept spitting
          // particles at the exact tile the player died on for the rest of the match.
          // (audit TRAIL-EMITTER-LEAK-1)
          const deadTrail = this.trailEmitters.get(player.id);
          if (deadTrail) {
            deadTrail.destroy();
            this.trailEmitters.delete(player.id);
          }
          const deadDust = this.dustEmitters.get(player.id);
          if (deadDust) {
            deadDust.destroy();
            this.dustEmitters.delete(player.id);
          }

          // Clean up tracking maps
          this.prevShieldState.delete(player.id);
          this.prevPositions.delete(player.id);
          this.targetPositions.delete(player.id);
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
          this.customColor.set(player.id, player.cosmetics.colorHex);
          if (player.cosmetics.eyeStyle) {
            this.customEyes.set(player.id, player.cosmetics.eyeStyle as EyeStyle);
          }
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
        const color = this.colorOf(player.id);
        if (color !== undefined) {
          this.looks.set(player.id, { color, eyes: this.customEyes.get(player.id) ?? 'default' });
        }
      }

      if (!sprite) {
        const dir = player.direction || 'down';
        const isBuddy = player.id === this.buddyPlayerId;
        const displaySize = isBuddy
          ? (TILE_SIZE - 4) * (this.buddySizePercent / 100)
          : TILE_SIZE - 4;
        if (this.fx) {
          sprite = this.createStyled(player, colorIndex, targetX, targetY, this.fx);
        } else {
          const customPrefix = this.customTexturePrefix.get(player.id);
          const textureKey = customPrefix
            ? `${customPrefix}_${dir}`
            : `player_${colorIndex}_${dir}`;
          sprite = this.scene.add.sprite(targetX, targetY, textureKey);
          sprite.setDepth(DEPTH.PLAYER);
          sprite.setDisplaySize(displaySize, displaySize);
        }
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
          .setDepth(DEPTH.LABEL);
        this.labels.set(player.id, label);

        // Team colored underline indicator (drawn at origin, positioned via setPosition)
        if (isTeamMode && !this.fx) {
          const teamGfx = this.scene.add.graphics();
          teamGfx.setDepth(DEPTH.TEAM_BAR);
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

      // Record where the sprite should head; frame() moves it there. (audit F2)
      const target = this.targetPositions.get(player.id);
      if (target) {
        if (this.jumpDistanceSq(target, targetX, targetY) > SNAP_DISTANCE * SNAP_DISTANCE) {
          sprite.setPosition(targetX, targetY);
          const st = this.styled.get(player.id);
          if (st) {
            st.lx = targetX;
            st.ly = targetY;
          }
        }
        target.x = targetX;
        target.y = targetY;
      } else {
        this.targetPositions.set(player.id, { x: targetX, y: targetY });
      }

      const st = this.styled.get(player.id);
      if (st) {
        // Drawn styles pick walk/idle/blink frames per rendered frame (see frame()).
        st.dir = player.direction || st.dir;
        st.invulnerable = player.invulnerableTicks ?? 0;
      } else {
        this.invulnerable.set(player.id, player.invulnerableTicks ?? 0);
        // Update texture based on direction
        const customPrefix = this.customTexturePrefix.get(player.id);
        const dirTexture = customPrefix
          ? `${customPrefix}_${player.direction}`
          : `player_${colorIndex}_${player.direction}`;
        if (sprite.texture.key !== dirTexture && this.scene.textures.exists(dirTexture)) {
          sprite.setTexture(dirTexture);
        }
      }

      // Enforce buddy display size on every update (setTexture and tweens can reset it)
      if (player.id === this.buddyPlayerId && !st) {
        const buddySize = (TILE_SIZE - 4) * (this.buddySizePercent / 100);
        sprite.setDisplaySize(buddySize, buddySize);
      }

      // Trail particles for cosmetic trails (positioned per frame in frame())
      if (player.cosmetics?.trailConfig && settings.particles) {
        if (
          !this.trailEmitters.has(player.id) &&
          this.scene.textures.exists(player.cosmetics.trailConfig.particleKey)
        ) {
          const emitter = this.scene.add.particles(
            sprite.x,
            sprite.y,
            player.cosmetics.trailConfig.particleKey,
            {
              speed: { min: 5, max: 15 },
              scale: { start: 0.5, end: 0 },
              lifespan: 400,
              alpha: { start: 0.6, end: 0 },
              frequency: player.cosmetics.trailConfig.frequency,
              tint: player.cosmetics.trailConfig.tint,
              emitting: true,
            },
          );
          emitter.setDepth(DEPTH.TRAIL);
          this.trailEmitters.set(player.id, emitter);
        }
      }

      // Detect movement
      const prevPos = this.prevPositions.get(player.id);
      const moved =
        prevPos && (Math.abs(prevPos.x - targetX) > 1 || Math.abs(prevPos.y - targetY) > 1);

      if (moved && this.fx) {
        if (settings.animations && !this.activeMoveAnim.has(player.id)) {
          this.activeMoveAnim.add(player.id);
          const b = sprite.scaleX;
          this.scene.tweens.add({
            targets: sprite,
            scaleX: b * 1.06,
            scaleY: sprite.scaleY * 0.94,
            duration: 60,
            yoyo: true,
            ease: 'Sine.easeOut',
            onComplete: () => this.activeMoveAnim.delete(player.id),
          });
        }
        this.fx.dust(sprite.x, sprite.y + FOOT_OFFSET, 2);
      } else if (moved) {
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
            emitter.setDepth(DEPTH.DUST);
            this.dustEmitters.set(player.id, emitter);
          }
          emitter.setPosition(sprite.x, sprite.y + (TILE_SIZE - 4) / 2);
          emitter.explode(Phaser.Math.Between(2, 3));
        }
      }

      if (prevPos) {
        prevPos.x = targetX;
        prevPos.y = targetY;
      } else {
        this.prevPositions.set(player.id, { x: targetX, y: targetY });
      }

      // ---- Shield visual (drawn per frame in frame(); only its lifetime is decided here) ----
      const hadShield = this.prevShieldState.get(player.id) ?? false;
      this.prevShieldState.set(player.id, player.hasShield);

      if (st && this.fx) {
        this.updateStyledShield(player.id, st, player.hasShield, hadShield, sprite, this.fx);
      } else if (player.hasShield) {
        if (!this.shieldGraphics.has(player.id)) {
          const shieldGfx = this.scene.add.graphics();
          shieldGfx.setDepth(DEPTH.SHIELD);
          shieldGfx.setPosition(sprite.x, sprite.y);
          this.shieldGraphics.set(player.id, shieldGfx);
        }
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

      // Buddy glow aura (drawn per frame in frame())
      if (player.id === this.buddyPlayerId && !this.buddyGlowGraphics.has(player.id)) {
        const glowGfx = this.scene.add.graphics();
        glowGfx.setDepth(DEPTH.BUDDY_GLOW); // Below player (10), above floor
        glowGfx.setPosition(sprite.x, sprite.y);
        this.buddyGlowGraphics.set(player.id, glowGfx);
      }
    });
  }

  /** Squared distance from an old target to a new one, the short way round on a wrapping map. */
  private jumpDistanceSq(from: { x: number; y: number }, x: number, y: number): number {
    let dx = x - from.x;
    let dy = y - from.y;
    const wrap = this.wrappingWorldSize;
    if (wrap) {
      if (dx > wrap.w / 2) dx -= wrap.w;
      else if (dx < -wrap.w / 2) dx += wrap.w;
      if (dy > wrap.h / 2) dy -= wrap.h;
      else if (dy < -wrap.h / 2) dy += wrap.h;
    }
    return dx * dx + dy * dy;
  }

  /**
   * Per-frame pass, driven from GameScene.update(): moves every sprite toward its target, keeps
   * the overlays (label, team bar, shield, buddy glow, trail, wrap ghosts) on it and redraws the
   * time-animated ones. `delta` is the frame time in ms. (audit F2)
   */
  frame(delta: number): void {
    if (this.sprites.size === 0) return;

    // Same visual speed as the old 0.45-per-tick lerp, whatever the frame rate.
    const k = 1 - Math.pow(1 - LERP_PER_TICK, delta / TICK_MS);
    const time = this.scene.time.now;
    const shieldAlpha = 0.25 + 0.15 * Math.sin(time * 0.005);
    const glowPulse = 0.15 + 0.08 * Math.sin(time * 0.003);
    const wrap = this.wrappingWorldSize;
    const buddySize = (TILE_SIZE - 4) * (this.buddySizePercent / 100);

    for (const [id, sprite] of this.sprites) {
      const target = this.targetPositions.get(id);
      const st = this.styled.get(id);
      if (st && target) {
        this.lerpStyled(st, target, k);
        sprite.setPosition(st.lx, st.ly + st.drop);
      } else if (target) {
        // Sprite stays in canonical range [0, worldW) on wrapping maps; ghosts cover the seam.
        if (wrap) {
          const { w, h } = wrap;
          let dx = target.x - sprite.x;
          let dy = target.y - sprite.y;
          if (dx > w / 2) dx -= w;
          else if (dx < -w / 2) dx += w;
          if (dy > h / 2) dy -= h;
          else if (dy < -h / 2) dy += h;
          sprite.x += dx * k;
          sprite.y += dy * k;
          sprite.x = ((sprite.x % w) + w) % w;
          sprite.y = ((sprite.y % h) + h) % h;
        } else {
          sprite.x = Phaser.Math.Linear(sprite.x, target.x, k);
          sprite.y = Phaser.Math.Linear(sprite.y, target.y, k);
        }
      }

      // Classic: a plain flicker while spawn-invulnerable (drawn styles do theirs in frameStyled).
      if (!st) {
        if ((this.invulnerable.get(id) ?? 0) > 0) {
          sprite.setAlpha(Math.floor(time / 90) % 2 === 0 ? 0.35 : 1);
          this.flickering.add(id);
        } else if (this.flickering.delete(id)) {
          sprite.setAlpha(1);
        }
      }

      const isBuddy = id === this.buddyPlayerId;

      const trail = this.trailEmitters.get(id);
      if (trail) trail.setPosition(sprite.x, sprite.y);

      const shieldGfx = this.shieldGraphics.get(id);
      if (shieldGfx) {
        this.drawShield(shieldGfx, shieldAlpha);
        shieldGfx.setPosition(sprite.x, sprite.y);
      }

      const glowGfx = this.buddyGlowGraphics.get(id);
      if (glowGfx) {
        const glowRadius = buddySize / 2 + 6;
        glowGfx.clear();
        glowGfx.fillStyle(this.buddyGlowColor, glowPulse * 0.5);
        glowGfx.fillCircle(0, 0, glowRadius + 4);
        glowGfx.fillStyle(this.buddyGlowColor, glowPulse);
        glowGfx.fillCircle(0, 0, glowRadius);
        glowGfx.lineStyle(1.5, this.buddyGlowColor, glowPulse + 0.1);
        glowGfx.strokeCircle(0, 0, glowRadius + 2);
        glowGfx.setPosition(sprite.x, sprite.y);
      }

      const label = this.labels.get(id);
      if (label) {
        label.x = sprite.x;
        label.y = sprite.y - (isBuddy ? buddySize / 2 + 2 : TILE_SIZE / 2 + 2);
      }

      // Team indicator: setPosition only — no clear/redraw
      const teamGfx = this.teamIndicators.get(id);
      if (teamGfx) teamGfx.setPosition(sprite.x, sprite.y);

      if (st) this.frameStyled(id, sprite, st, target, time);

      // Ghost sprites for wrapping maps follow the interpolated position, not the tick target
      if (wrap) {
        this.updatePlayerGhosts(
          id,
          sprite.x,
          sprite.y,
          sprite.texture.key,
          sprite.displayWidth,
          shieldAlpha,
          st ? sprite : undefined,
        );
      }
    }
  }

  /* ---------------- drawn art styles ---------------- */

  private createStyled(
    player: PlayerState,
    colorIndex: number,
    x: number,
    y: number,
    fx: StyledFx,
  ): Phaser.GameObjects.Sprite {
    const color =
      player.cosmetics?.colorHex ?? (colorIndex >= 0 ? PLAYER_COLORS[colorIndex] : 0xffffff);
    const eyes = (player.cosmetics?.eyeStyle as EyeStyle | undefined) ?? 'default';
    const key = fx.art.ensurePlayer(this.scene, color, eyes);
    const dir = player.direction || 'down';
    const sprite = this.scene.add.sprite(x, y, key, StyleArt.playerFrame(dir, 'i'));
    const isBuddy = player.id === this.buddyPlayerId;
    sprite.setScale(base(sprite) * (isBuddy ? this.buddySizePercent / 100 : 1));
    sprite.setDepth(ySortDepth(y + FOOT_OFFSET, Y_BIAS.PLAYER));

    const now = this.scene.time.now;
    const st: StyledPlayer = {
      key,
      dir,
      lx: x,
      ly: y,
      drop: 0,
      nextBlink: now + 1200 + ((player.id * 977) % 2600),
      blinkUntil: 0,
      invulnerable: player.invulnerableTicks ?? 0,
      shield: null,
      teamRing: null,
      localRing: null,
    };
    const fxKey = fx.art.fxKey();
    if (player.team !== null && player.team !== undefined) {
      st.teamRing = this.scene.add.image(x, y + FOOT_OFFSET, fxKey, StyleArt.fxFrame('teamRing'));
      st.teamRing.setTint(parseInt(TEAM_COLORS[player.team % 2].slice(1), 16));
      st.teamRing.setScale(base(st.teamRing) * 0.95);
      st.teamRing.setDepth(DEPTH.SHADOW + 1);
    }
    if (player.id === this.localId) {
      st.localRing = this.scene.add.image(x, y + FOOT_OFFSET, fxKey, StyleArt.fxFrame('localRing'));
      st.localRing.setTint(color);
      st.localRing.setScale(base(st.localRing) * 1.05);
      st.localRing.setDepth(DEPTH.SHADOW + 2);
    }
    this.styled.set(player.id, st);

    // Drop in from above and land with a puff.
    if (getSettings().animations) {
      st.drop = -44;
      sprite.setAlpha(0);
      this.scene.tweens.add({
        targets: st,
        drop: 0,
        duration: 300,
        ease: 'Quad.In',
        onUpdate: () => sprite.setAlpha(Math.min(1, 1 + st.drop / 30)),
        onComplete: () => {
          sprite.setAlpha(1);
          fx.dust(st.lx, st.ly + FOOT_OFFSET, 4);
          const b = sprite.scaleX;
          this.scene.tweens.add({
            targets: sprite,
            scaleX: b * 1.12,
            scaleY: sprite.scaleY * 0.86,
            duration: 80,
            yoyo: true,
            ease: 'Sine.easeOut',
          });
        },
      });
    }
    return sprite;
  }

  private lerpStyled(st: StyledPlayer, target: { x: number; y: number }, k: number): void {
    const wrap = this.wrappingWorldSize;
    if (wrap) {
      const { w, h } = wrap;
      let dx = target.x - st.lx;
      let dy = target.y - st.ly;
      if (dx > w / 2) dx -= w;
      else if (dx < -w / 2) dx += w;
      if (dy > h / 2) dy -= h;
      else if (dy < -h / 2) dy += h;
      st.lx = (((st.lx + dx * k) % w) + w) % w;
      st.ly = (((st.ly + dy * k) % h) + h) % h;
    } else {
      st.lx += (target.x - st.lx) * k;
      st.ly += (target.y - st.ly) * k;
    }
  }

  /** Walk/idle/blink frames, depth, invulnerability flicker and overlays for one player. */
  private frameStyled(
    id: number,
    sprite: Phaser.GameObjects.Sprite,
    st: StyledPlayer,
    target: { x: number; y: number } | undefined,
    time: number,
  ): void {
    const moving =
      !!target && (Math.abs(target.x - st.lx) > 1.5 || Math.abs(target.y - st.ly) > 1.5);
    const animations = getSettings().animations;
    if (moving && animations) {
      const anim = this.fx!.art.walkAnim(st.key, st.dir);
      if (sprite.anims.currentAnim?.key !== anim || !sprite.anims.isPlaying) {
        if (this.scene.anims.exists(anim)) sprite.play(anim, true);
      }
    } else {
      if (sprite.anims.isPlaying) sprite.stop();
      if (time >= st.nextBlink) {
        st.blinkUntil = time + 130;
        st.nextBlink = time + 2400 + ((id * 613 + Math.floor(time)) % 2200);
      }
      const pose = animations && time < st.blinkUntil ? 'b' : 'i';
      const frame = StyleArt.playerFrame(st.dir, pose);
      if (sprite.frame.name !== frame) sprite.setFrame(frame);
    }

    // Spawn/hit protection: flicker while it lasts.
    if (st.drop === 0) {
      sprite.setAlpha(st.invulnerable > 0 && Math.floor(time / 90) % 2 === 0 ? 0.35 : 1);
    }

    setDepthIfChanged(sprite, ySortDepth(st.ly + FOOT_OFFSET, Y_BIAS.PLAYER));
    const fy = st.ly + FOOT_OFFSET;
    st.teamRing?.setPosition(st.lx, fy);
    if (st.localRing) {
      st.localRing.setPosition(st.lx, fy);
      if (animations) st.localRing.setRotation(time / 1400);
    }
    if (st.shield) {
      st.shield.setPosition(sprite.x, sprite.y);
      setDepthIfChanged(st.shield, sprite.depth + 0.02);
    }
  }

  private updateStyledShield(
    id: number,
    st: StyledPlayer,
    hasShield: boolean,
    hadShield: boolean,
    sprite: Phaser.GameObjects.Sprite,
    fx: StyledFx,
  ): void {
    if (hasShield && !st.shield) {
      const shield = this.scene.add.sprite(
        sprite.x,
        sprite.y,
        fx.art.fxKey(),
        StyleArt.shieldFrame(0),
      );
      shield.setScale(base(shield));
      shield.setDepth(sprite.depth + 0.02);
      if (getSettings().animations && this.scene.anims.exists(fx.art.shieldAnim())) {
        shield.play(fx.art.shieldAnim());
      }
      st.shield = shield;
      fx.burst(sprite.x, sprite.y, 0x88ffcc, 8);
    } else if (!hasShield && st.shield) {
      st.shield.destroy();
      st.shield = null;
      if (hadShield) {
        fx.burst(sprite.x, sprite.y, 0x88ffcc, 14);
        fx.light(sprite.x, sprite.y, TILE_SIZE * 1.4, '#9effc8', 0.7, 300);
      }
    }
    void id;
  }

  /** Knockout in a drawn style: flash, pop into a puff, a ghost floats up. */
  private knockOutStyled(id: number, sprite: Phaser.GameObjects.Sprite, animations: boolean): void {
    const st = this.styled.get(id);
    this.styled.delete(id);
    st?.shield?.destroy();
    st?.teamRing?.destroy();
    st?.localRing?.destroy();
    const fx = this.fx!;
    const color = this.colorOf(id) ?? 0xffffff;
    fx.burst(sprite.x, sprite.y, color, 14);
    fx.puff(sprite.x, sprite.y + 4, 7);
    if (!animations || !st) {
      sprite.destroy();
      return;
    }
    sprite.stop();
    sprite.setTint(0xffffff);
    sprite.setTintMode(Phaser.TintModes.FILL);
    const b = sprite.scaleX;
    this.scene.tweens.add({
      targets: sprite,
      scaleX: b * 1.25,
      scaleY: sprite.scaleY * 0.75,
      alpha: 0,
      duration: 200,
      ease: 'Quad.Out',
      onComplete: () => sprite.destroy(),
    });
    const ghost = this.scene.add.image(sprite.x, sprite.y, st.key, 'ghost');
    ghost.setScale(base(ghost));
    ghost.setDepth(DEPTH.LABEL - 1);
    ghost.setAlpha(0);
    this.scene.tweens.add({
      targets: ghost,
      alpha: { from: 0.95, to: 0 },
      y: sprite.y - 48,
      delay: 120,
      duration: 1000,
      ease: 'Sine.easeOut',
      onComplete: () => ghost.destroy(),
    });
    this.scene.tweens.add({
      targets: ghost,
      x: sprite.x + 6,
      delay: 120,
      duration: 250,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
    });
  }

  private destroyStyled(id: number): void {
    const st = this.styled.get(id);
    if (!st) return;
    st.shield?.destroy();
    st.teamRing?.destroy();
    st.localRing?.destroy();
    this.styled.delete(id);
  }

  private drawShield(gfx: Phaser.GameObjects.Graphics, alpha: number): void {
    gfx.clear();
    gfx.fillStyle(0x44ff44, alpha);
    gfx.fillCircle(0, 0, SHIELD_RADIUS);
    gfx.lineStyle(2, 0x88ffaa, alpha + 0.2);
    gfx.strokeCircle(0, 0, SHIELD_RADIUS);
  }

  /** Create/update ghost copies of a player sprite and overlays near wrapping edges */
  private updatePlayerGhosts(
    playerId: number,
    px: number,
    py: number,
    textureKey: string,
    displaySize: number,
    shieldAlpha: number,
    styledSource?: Phaser.GameObjects.Sprite,
  ): void {
    if (!this.wrappingWorldSize) return;
    const { w, h } = this.wrappingWorldSize;
    // Only mirror copies that would actually land in view. The old threshold was half the world
    // size, which is true for every position, so every player always carried three ghost sprites
    // plus three name labels, team indicators and shield Graphics — redrawn every frame, almost
    // always off screen. (audit WRAP-GHOST-1)
    const offsets = wrapGhostOffsets(this.scene.cameras.main.worldView, px, py, w, h, displaySize);

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
        const img = this.scene.add.image(px + ox, py + oy, textureKey, styledSource?.frame.name);
        img.setDepth(DEPTH.PLAYER);
        if (!styledSource) img.setDisplaySize(displaySize, displaySize);
        return img;
      });
      this.ghostSprites.set(playerId, ghosts);
    }
    for (let i = 0; i < offsets.length; i++) {
      const g = ghosts[i];
      g.setPosition(px + offsets[i].ox, py + offsets[i].oy);
      if (styledSource) {
        g.setTexture(textureKey, styledSource.frame.name);
        g.setScale(styledSource.scaleX, styledSource.scaleY);
        g.setAlpha(styledSource.alpha);
        setDepthIfChanged(g, ySortDepth(g.y + FOOT_OFFSET, Y_BIAS.PLAYER));
      } else {
        g.setTexture(textureKey);
        g.setDisplaySize(displaySize, displaySize);
        g.setAlpha(this.sprites.get(playerId)?.alpha ?? 1);
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
          gfx.setDepth(DEPTH.SHIELD);
          return gfx;
        });
        this.ghostShieldGraphics.set(playerId, gShields);
      }
      for (let i = 0; i < offsets.length; i++) {
        this.drawShield(gShields[i], shieldAlpha);
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
            .setDepth(DEPTH.LABEL);
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
          gfx.setDepth(DEPTH.TEAM_BAR);
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

  /**
   * The body colour a player is drawn in (cosmetic colour, team colour or index colour), once
   * they have been seen. Bombs and the minimap use it so an owner's colour matches their sprite.
   */
  /** Body colour and eyes a player is drawn with, for portraits (kill feed, results). */
  lookOf(playerId: number): { color: number; eyes: EyeStyle } | undefined {
    return this.looks.get(playerId);
  }

  colorOf(playerId: number): number | undefined {
    const custom = this.customColor.get(playerId);
    if (custom !== undefined) return custom;
    const index = this.playerColorIndex.get(playerId);
    return index !== undefined && index >= 0 ? PLAYER_COLORS[index] : undefined;
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
    // destroy() cleared dust but not trails, so a renderer teardown left them behind too.
    // (audit TRAIL-EMITTER-LEAK-1)
    for (const emitter of this.trailEmitters.values()) emitter.destroy();
    this.trailEmitters.clear();
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
    this.customColor.clear();
    this.customEyes.clear();
    this.looks.clear();
    this.flickering.clear();
    this.invulnerable.clear();
    this.playerTeams.clear();
    this.prevShieldState.clear();
    this.prevPositions.clear();
    this.targetPositions.clear();
    this.activeMoveAnim.clear();
    this.teamPlayerCount = {};
    for (const id of [...this.styled.keys()]) this.destroyStyled(id);
  }

  private removePlayer(id: number): void {
    this.destroyStyled(id);
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
    this.targetPositions.delete(id);
    this.playerColorIndex.delete(id);
    this.playerTeams.delete(id);
    this.customTexturePrefix.delete(id);
    this.customColor.delete(id);
    this.customEyes.delete(id);
    this.looks.delete(id);
    this.flickering.delete(id);
    this.invulnerable.delete(id);
    this.activeMoveAnim.delete(id);
  }
}
