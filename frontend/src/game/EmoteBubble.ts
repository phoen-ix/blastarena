import Phaser from 'phaser';
import { EMOTES, EmoteId, EMOTE_DISPLAY_MS } from '@blast-arena/shared';

const TILE_SIZE = 32;
const FADE_DURATION = 400;
const FLOAT_DISTANCE = 15;
const FLOAT_DURATION = 300;
const BG_COLOR = 0x1a1a2e;
const BG_ALPHA = 0.85;
const TEXT_DEPTH = 100;
const BG_PADDING_X = 8;
const BG_PADDING_Y = 4;

interface ActiveEmote {
  playerId: number;
  text: Phaser.GameObjects.Text;
  bg: Phaser.GameObjects.Rectangle;
  startTime: number;
}

export class EmoteBubbleRenderer {
  private scene: Phaser.Scene;
  private activeEmotes: ActiveEmote[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  showEmote(playerId: number, emoteId: EmoteId, x: number, y: number): void {
    // Remove any existing emote for this player (one at a time)
    this.removeEmoteForPlayer(playerId);

    const emote = EMOTES[emoteId];
    if (!emote) return;

    const posX = x;
    const posY = y - TILE_SIZE - 10;

    // Create text
    const text = this.scene.add.text(posX, posY, emote.label, {
      fontFamily: '"Chakra Petch"',
      fontStyle: 'bold',
      fontSize: '14px',
      color: '#ffffff',
      align: 'center',
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(TEXT_DEPTH);

    // Create background rectangle sized to text
    const bgWidth = text.width + BG_PADDING_X * 2;
    const bgHeight = text.height + BG_PADDING_Y * 2;
    const bg = this.scene.add.rectangle(posX, posY, bgWidth, bgHeight, BG_COLOR, BG_ALPHA);
    bg.setOrigin(0.5, 0.5);
    bg.setDepth(TEXT_DEPTH - 1);

    const entry: ActiveEmote = {
      playerId,
      text,
      bg,
      startTime: Date.now(),
    };
    this.activeEmotes.push(entry);

    // Float up animation
    this.scene.tweens.add({
      targets: [text, bg],
      y: posY - FLOAT_DISTANCE,
      duration: FLOAT_DURATION,
      ease: 'Power2',
    });

    // Fade out after display time
    this.scene.time.delayedCall(EMOTE_DISPLAY_MS, () => {
      // Guard: objects may have been destroyed already
      if (text.scene) {
        this.scene.tweens.add({
          targets: [text, bg],
          alpha: 0,
          duration: FADE_DURATION,
          ease: 'Power2',
          onComplete: () => {
            this.destroyEmote(entry);
          },
        });
      }
    });
  }

  update(playerPositions: Map<number, { x: number; y: number }>): void {
    const now = Date.now();
    const totalLifetime = EMOTE_DISPLAY_MS + FADE_DURATION;

    for (let i = this.activeEmotes.length - 1; i >= 0; i--) {
      const emote = this.activeEmotes[i];

      // Remove expired emotes
      if (now - emote.startTime > totalLifetime) {
        this.destroyEmote(emote);
        this.activeEmotes.splice(i, 1);
        continue;
      }

      // Follow player x position
      const pos = playerPositions.get(emote.playerId);
      if (pos) {
        emote.text.x = pos.x;
        emote.bg.x = pos.x;
      }
    }
  }

  destroy(): void {
    for (const emote of this.activeEmotes) {
      this.destroyEmote(emote);
    }
    this.activeEmotes = [];
  }

  private removeEmoteForPlayer(playerId: number): void {
    for (let i = this.activeEmotes.length - 1; i >= 0; i--) {
      if (this.activeEmotes[i].playerId === playerId) {
        this.destroyEmote(this.activeEmotes[i]);
        this.activeEmotes.splice(i, 1);
      }
    }
  }

  private destroyEmote(emote: ActiveEmote): void {
    if (emote.text.scene) {
      emote.text.destroy();
    }
    if (emote.bg.scene) {
      emote.bg.destroy();
    }
  }
}
