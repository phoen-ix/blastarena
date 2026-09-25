/**
 * Procedural sound effect generator using Web Audio API.
 * All sounds are synthesized from scratch — no external audio files.
 */

type OscType = OscillatorType;

interface ToneParams {
  frequency: number;
  type: OscType;
  duration: number;
  volume: number;
  attack?: number;
  decay?: number;
  pitchSlide?: number;
}

export class SoundGenerator {
  private ctx: AudioContext;
  private masterGain: GainNode;

  constructor(ctx: AudioContext, masterGain: GainNode) {
    this.ctx = ctx;
    this.masterGain = masterGain;
  }

  private playTone(params: ToneParams): void {
    const { frequency, type, duration, volume, attack = 0.01, decay, pitchSlide } = params;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (pitchSlide) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, frequency + pitchSlide),
        now + duration,
      );
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    if (decay !== undefined) {
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private playNoise(duration: number, volume: number, decay?: number): void {
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (decay ?? duration));

    // Low-pass filter for rumble
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start(now);
  }

  /** Explosion — rumbling boom with noise burst. Intensity 1-3 scales volume/pitch for batched blasts. */
  explosion(distance: number = 0, intensity: number = 1): void {
    const baseVol = Math.max(0.05, 0.4 - distance * 0.03);
    const vol = Math.min(0.6, baseVol * Math.sqrt(intensity));
    const pitchMod = 1 - (intensity - 1) * 0.15;
    this.playNoise(0.4 + (intensity - 1) * 0.05, vol, 0.35);
    this.playTone({
      frequency: 80 * pitchMod,
      type: 'sine',
      duration: 0.3 + (intensity - 1) * 0.05,
      volume: vol * 0.6,
      pitchSlide: -40,
    });
    this.playTone({
      frequency: 150 * pitchMod,
      type: 'square',
      duration: 0.15,
      volume: vol * 0.3,
      decay: 0.1,
    });
  }

  /** Bomb placement — soft thud */
  bombPlace(): void {
    this.playTone({ frequency: 200, type: 'sine', duration: 0.12, volume: 0.15, pitchSlide: -100 });
    this.playTone({ frequency: 400, type: 'triangle', duration: 0.06, volume: 0.08, decay: 0.04 });
  }

  /** Power-up collect — bright ascending chime */
  powerUpCollect(): void {
    this.playTone({ frequency: 523, type: 'sine', duration: 0.08, volume: 0.18, attack: 0.005 });
    setTimeout(() => {
      this.playTone({ frequency: 659, type: 'sine', duration: 0.08, volume: 0.15, attack: 0.005 });
    }, 60);
    setTimeout(() => {
      this.playTone({ frequency: 784, type: 'sine', duration: 0.12, volume: 0.12, attack: 0.005 });
    }, 120);
  }

  /** Player death — descending wah */
  death(): void {
    this.playTone({
      frequency: 400,
      type: 'sawtooth',
      duration: 0.3,
      volume: 0.15,
      pitchSlide: -300,
    });
    this.playNoise(0.15, 0.08, 0.12);
  }

  /** Shield break — metallic shatter */
  shieldBreak(): void {
    this.playTone({
      frequency: 1200,
      type: 'square',
      duration: 0.1,
      volume: 0.12,
      pitchSlide: -800,
    });
    this.playNoise(0.12, 0.1, 0.1);
    this.playTone({
      frequency: 300,
      type: 'triangle',
      duration: 0.15,
      volume: 0.08,
      pitchSlide: -100,
    });
  }

  /** Bomb throw */
  bombThrow(): void {
    this.playTone({ frequency: 250, type: 'sine', duration: 0.15, volume: 0.1, pitchSlide: 300 });
    this.playNoise(0.08, 0.05, 0.06);
  }

  /** Countdown beep (3-2-1) */
  countdownBeep(): void {
    this.playTone({ frequency: 440, type: 'square', duration: 0.12, volume: 0.15, decay: 0.1 });
  }

  /** Countdown GO — higher, longer */
  countdownGo(): void {
    this.playTone({ frequency: 880, type: 'square', duration: 0.25, volume: 0.2, decay: 0.2 });
    this.playTone({ frequency: 660, type: 'sine', duration: 0.25, volume: 0.12 });
  }

  /** Victory jingle */
  victory(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        this.playTone({ frequency: freq, type: 'sine', duration: 0.2, volume: 0.15, attack: 0.01 });
      }, i * 120);
    });
  }

  /** Defeat sound */
  defeat(): void {
    const notes = [400, 350, 300, 200];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        this.playTone({
          frequency: freq,
          type: 'triangle',
          duration: 0.2,
          volume: 0.12,
          attack: 0.01,
        });
      }, i * 150);
    });
  }
}
