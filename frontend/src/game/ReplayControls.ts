import { ReplayPlayer } from './ReplayPlayer';

export interface ReplayMatchInfo {
  matchId: number;
  gameMode: string;
  playerCount: number;
}

export class ReplayControls {
  private player: ReplayPlayer;
  private matchInfo: ReplayMatchInfo;
  private container: HTMLElement | null = null;
  private slider: HTMLInputElement | null = null;
  private timeDisplay: HTMLElement | null = null;
  private playBtn: HTMLElement | null = null;
  private speedBtn: HTMLElement | null = null;
  private onBack: () => void;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private static SPEEDS = [0.5, 1, 2, 4];

  constructor(player: ReplayPlayer, matchInfo: ReplayMatchInfo, onBack: () => void) {
    this.player = player;
    this.matchInfo = matchInfo;
    this.onBack = onBack;
  }

  mount(): void {
    this.container = document.createElement('div');
    this.container.id = 'replay-controls';
    this.container.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
      background: rgba(8, 8, 16, 0.92); backdrop-filter: blur(8px);
      border-top: 1px solid var(--border); padding: 8px 16px;
      font-family: 'DM Sans', sans-serif; color: var(--text);
      display: flex; flex-direction: column; gap: 6px;
    `;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.style.cssText = 'padding:4px 10px; font-size:12px;';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => this.onBack());
    topRow.appendChild(backBtn);

    // Skip to start
    const skipStartBtn = this.createControlBtn('|◄', 'Skip to start');
    skipStartBtn.addEventListener('click', () => {
      this.player.seekTo(0);
      this.update();
    });
    topRow.appendChild(skipStartBtn);

    // Rewind 5s
    const rewBtn = this.createControlBtn('◄◄', 'Rewind 5s');
    rewBtn.addEventListener('click', () => {
      this.player.seekTo(this.player.getCurrentFrame() - 100);
      this.update();
    });
    topRow.appendChild(rewBtn);

    // Play/Pause
    this.playBtn = this.createControlBtn('▶', 'Play/Pause');
    this.playBtn.style.cssText += 'min-width:36px; font-size:16px;';
    this.playBtn.addEventListener('click', () => {
      this.player.togglePlayPause();
      this.updatePlayButton();
    });
    topRow.appendChild(this.playBtn);

    // Forward 5s
    const fwdBtn = this.createControlBtn('►►', 'Forward 5s');
    fwdBtn.addEventListener('click', () => {
      this.player.seekTo(this.player.getCurrentFrame() + 100);
      this.update();
    });
    topRow.appendChild(fwdBtn);

    // Skip to end
    const skipEndBtn = this.createControlBtn('►|', 'Skip to end');
    skipEndBtn.addEventListener('click', () => {
      this.player.seekTo(this.player.getTotalFrames() - 1);
      this.update();
    });
    topRow.appendChild(skipEndBtn);

    // Separator
    const sep = document.createElement('div');
    sep.style.cssText =
      'width:1px; height:20px; background:var(--border); margin:0 4px;';
    topRow.appendChild(sep);

    // Time display
    this.timeDisplay = document.createElement('span');
    this.timeDisplay.style.cssText =
      'font-family:"Chakra Petch",monospace; font-size:13px; color:var(--text-dim); min-width:100px;';
    topRow.appendChild(this.timeDisplay);

    // Speed button
    this.speedBtn = this.createControlBtn('1x', 'Cycle speed');
    this.speedBtn.style.cssText +=
      'margin-left:auto; min-width:40px; color:var(--accent);';
    this.speedBtn.addEventListener('click', () => {
      this.cycleSpeed();
    });
    topRow.appendChild(this.speedBtn);

    // Match info
    const info = document.createElement('span');
    info.style.cssText = 'font-size:11px; color:var(--text-dim); margin-left:8px;';
    info.textContent = `Match #${this.matchInfo.matchId} — ${this.matchInfo.gameMode.toUpperCase()} — ${this.matchInfo.playerCount} players`;
    topRow.appendChild(info);

    this.container.appendChild(topRow);

    // Slider row
    const sliderRow = document.createElement('div');
    sliderRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = String(this.player.getTotalFrames() - 1);
    this.slider.value = '0';
    this.slider.style.cssText = `
      flex:1; height:6px; cursor:pointer;
      accent-color: var(--primary);
    `;
    this.slider.addEventListener('input', () => {
      const frame = parseInt(this.slider!.value);
      this.player.seekTo(frame);
      this.updateTimeDisplay();
    });
    sliderRow.appendChild(this.slider);

    this.container.appendChild(sliderRow);

    document.body.appendChild(this.container);

    // Keyboard shortcuts
    this.keyHandler = (e: KeyboardEvent) => {
      // Don't capture if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.player.togglePlayPause();
          this.updatePlayButton();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) {
            this.player.seekTo(this.player.getCurrentFrame() - 200);
          } else {
            this.player.seekTo(this.player.getCurrentFrame() - 20);
          }
          this.update();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) {
            this.player.seekTo(this.player.getCurrentFrame() + 200);
          } else {
            this.player.seekTo(this.player.getCurrentFrame() + 20);
          }
          this.update();
          break;
      }
    };
    window.addEventListener('keydown', this.keyHandler);

    this.update();
  }

  update(): void {
    if (!this.slider) return;
    this.slider.value = String(this.player.getCurrentFrame());
    this.updateTimeDisplay();
    this.updatePlayButton();
  }

  destroy(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container?.remove();
    this.container = null;
  }

  private createControlBtn(label: string, title: string): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText =
      'padding:4px 8px; font-size:12px; min-width:28px; text-align:center;';
    btn.textContent = label;
    btn.title = title;
    return btn;
  }

  private updateTimeDisplay(): void {
    if (!this.timeDisplay) return;
    const current = this.formatTime(this.player.getCurrentTime());
    const total = this.formatTime(this.player.getTotalTime());
    this.timeDisplay.textContent = `${current} / ${total}`;
  }

  private updatePlayButton(): void {
    if (!this.playBtn) return;
    this.playBtn.textContent = this.player.isPlaying ? '⏸' : '▶';
  }

  private cycleSpeed(): void {
    const speeds = ReplayControls.SPEEDS;
    const idx = speeds.indexOf(this.player.speed);
    const next = speeds[(idx + 1) % speeds.length];
    this.player.setSpeed(next);
    if (this.speedBtn) {
      this.speedBtn.textContent = `${next}x`;
    }
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
