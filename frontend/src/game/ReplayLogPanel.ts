import { ReplayLogEntry, ReplayLogEventType, TICK_RATE } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { t } from '../i18n';

interface FilterState {
  kill: boolean;
  bomb_place: boolean;
  bomb_detonate: boolean;
  bot_decision: boolean;
  movement: boolean;
  powerup_pickup: boolean;
  explosion_detail: boolean;
  game_over: boolean;
}

const EVENT_CONFIG: Record<ReplayLogEventType, { icon: string; color: string; label: string }> = {
  kill: { icon: '\u2620\uFE0F', color: 'var(--danger)', label: 'Kills' },
  bomb_place: { icon: '\uD83D\uDCA3', color: 'var(--primary)', label: 'Bombs' },
  bomb_detonate: { icon: '\uD83D\uDCA5', color: 'var(--warning)', label: 'Bombs' },
  bot_decision: { icon: '\uD83E\uDD16', color: 'var(--info)', label: 'Bot AI' },
  movement: { icon: '\uD83D\uDC63', color: 'var(--text-dim)', label: 'Movement' },
  powerup_pickup: { icon: '\u2B50', color: 'var(--success)', label: 'Power-ups' },
  explosion_detail: {
    icon: '\uD83D\uDD25',
    color: 'var(--warning)',
    label: 'Explosions',
  },
  game_over: { icon: '\uD83C\uDFC1', color: 'var(--accent)', label: 'Game Over' },
};

// Filter groups (some event types share a filter)
const FILTER_GROUPS: {
  key: string;
  label: string;
  types: ReplayLogEventType[];
  defaultOn: boolean;
}[] = [
  { key: 'kills', label: '\u2620\uFE0F Kills', types: ['kill'], defaultOn: true },
  {
    key: 'bombs',
    label: '\uD83D\uDCA3 Bombs',
    types: ['bomb_place', 'bomb_detonate'],
    defaultOn: true,
  },
  {
    key: 'bot',
    label: '\uD83E\uDD16 Bot AI',
    types: ['bot_decision'],
    defaultOn: false,
  },
  {
    key: 'powerups',
    label: '\u2B50 Power-ups',
    types: ['powerup_pickup'],
    defaultOn: true,
  },
  {
    key: 'movement',
    label: '\uD83D\uDC63 Movement',
    types: ['movement'],
    defaultOn: false,
  },
  {
    key: 'explosions',
    label: '\uD83D\uDD25 Explosions',
    types: ['explosion_detail'],
    defaultOn: false,
  },
];

export class ReplayLogPanel {
  private entries: ReplayLogEntry[];
  private onSeek: (tick: number) => void;
  private container: HTMLElement | null = null;
  private logList: HTMLElement | null = null;
  private isOpen: boolean = false;
  private currentTick: number = 0;
  private filters: FilterState;

  // Pre-indexed data
  private entryByTick: Map<number, ReplayLogEntry[]> = new Map();
  private filteredEntries: ReplayLogEntry[] = [];
  private entryElements: Map<number, HTMLElement[]> = new Map(); // tick -> DOM elements

  constructor(entries: ReplayLogEntry[], onSeek: (tick: number) => void) {
    this.entries = entries;
    this.onSeek = onSeek;

    // Initialize filters
    this.filters = {
      kill: true,
      bomb_place: true,
      bomb_detonate: true,
      bot_decision: false,
      movement: false,
      powerup_pickup: true,
      explosion_detail: false,
      game_over: true,
    };

    // Index entries by tick
    for (const entry of entries) {
      const existing = this.entryByTick.get(entry.tick);
      if (existing) {
        existing.push(entry);
      } else {
        this.entryByTick.set(entry.tick, [entry]);
      }
    }

    this.rebuildFilteredEntries();
  }

  mount(): void {
    this.container = document.createElement('div');
    this.container.id = 'replay-log-panel';
    this.container.style.cssText = `
      position: fixed; top: 0; right: 0; bottom: 70px; width: 340px; z-index: 99;
      background: rgba(12, 12, 24, 0.94); backdrop-filter: blur(8px);
      border-left: 1px solid var(--border);
      font-family: 'DM Sans', sans-serif; color: var(--text);
      display: flex; flex-direction: column;
      transition: transform 0.25s ease;
      transform: translateX(100%);
    `;

    // Toggle button (tab on the left edge)
    const toggle = document.createElement('button');
    toggle.id = 'replay-log-toggle';
    toggle.style.cssText = `
      position: absolute; left: -32px; top: 50%; transform: translateY(-50%);
      width: 32px; height: 60px; background: rgba(12, 12, 24, 0.94);
      border: 1px solid var(--border); border-right: none;
      border-radius: 6px 0 0 6px; cursor: pointer;
      color: var(--text-dim); font-size: 14px;
      display: flex; align-items: center; justify-content: center;
    `;
    toggle.textContent = '\u25B6';
    toggle.title = t('ui:replay.toggleLog');
    toggle.addEventListener('click', () => this.togglePanel());
    this.container.appendChild(toggle);

    // Header
    const header = document.createElement('div');
    header.style.cssText =
      'padding:8px 12px; border-bottom:1px solid var(--border); font-weight:600; font-size:13px; color:var(--accent);';
    header.textContent = t('ui:replay.gameLog');
    this.container.appendChild(header);

    // Filters
    const filterBar = document.createElement('div');
    filterBar.style.cssText =
      'padding:6px 12px; display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid var(--border);';

    for (const group of FILTER_GROUPS) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        padding:2px 6px; font-size:11px; border-radius:4px; cursor:pointer;
        border:1px solid var(--border); background:${group.defaultOn ? 'var(--bg-hover)' : 'transparent'};
        color:${group.defaultOn ? 'var(--text)' : 'var(--text-dim)'};
      `;
      btn.textContent = group.label;
      btn.dataset.filterKey = group.key;
      btn.addEventListener('click', () => {
        const isOn = group.types.every((t) => this.filters[t]);
        for (const t of group.types) {
          this.filters[t] = !isOn;
        }
        btn.style.background = !isOn ? 'var(--bg-hover)' : 'transparent';
        btn.style.color = !isOn ? 'var(--text)' : 'var(--text-dim)';
        this.rebuildFilteredEntries();
        this.renderLogEntries();
        this.highlightTick(this.currentTick);
      });
      filterBar.appendChild(btn);
    }
    this.container.appendChild(filterBar);

    // Log list
    this.logList = document.createElement('div');
    this.logList.style.cssText =
      'flex:1; overflow-y:auto; font-size:11px; font-family:"DM Sans",monospace;';
    this.container.appendChild(this.logList);

    this.renderLogEntries();
    document.body.appendChild(this.container);
  }

  updateTick(tick: number): void {
    this.currentTick = tick;
    this.highlightTick(tick);
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
    this.logList = null;
    this.entryElements.clear();
  }

  private togglePanel(): void {
    this.isOpen = !this.isOpen;
    if (this.container) {
      this.container.style.transform = this.isOpen ? 'translateX(0)' : 'translateX(100%)';
      const toggle = this.container.querySelector('#replay-log-toggle') as HTMLElement;
      if (toggle) {
        toggle.textContent = this.isOpen ? '\u25C0' : '\u25B6';
      }
    }
    // Shift player list so it doesn't overlap with the open panel
    const playerList = document.querySelector('.hud-players') as HTMLElement;
    if (playerList) {
      playerList.style.right = this.isOpen ? '360px' : '20px';
    }
  }

  private rebuildFilteredEntries(): void {
    this.filteredEntries = this.entries.filter((e) => this.filters[e.event]);
  }

  private renderLogEntries(): void {
    if (!this.logList) return;
    this.logList.innerHTML = '';
    this.entryElements.clear();

    const fragment = document.createDocumentFragment();
    for (const entry of this.filteredEntries) {
      const el = this.createEntryElement(entry);
      fragment.appendChild(el);

      const existing = this.entryElements.get(entry.tick);
      if (existing) {
        existing.push(el);
      } else {
        this.entryElements.set(entry.tick, [el]);
      }
    }
    this.logList.appendChild(fragment);
  }

  private createEntryElement(entry: ReplayLogEntry): HTMLElement {
    const config = EVENT_CONFIG[entry.event];
    const el = document.createElement('div');
    el.style.cssText = `
      padding:3px 12px; border-left:3px solid transparent;
      cursor:pointer; transition: background 0.1s;
      display:flex; gap:6px; align-items:flex-start;
      line-height:1.4;
    `;
    el.addEventListener('mouseenter', () => {
      el.style.background = 'var(--bg-hover)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.background = '';
    });

    // Timestamp
    const time = document.createElement('span');
    time.style.cssText = 'color:var(--text-dim); min-width:36px; flex-shrink:0; cursor:pointer;';
    const seconds = entry.tick / TICK_RATE;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    time.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    time.title = t('ui:replay.clickToSeek');
    el.appendChild(time);

    // Icon
    const icon = document.createElement('span');
    icon.style.cssText = 'flex-shrink:0;';
    icon.textContent = config.icon;
    el.appendChild(icon);

    // Message
    const msg = document.createElement('span');
    msg.style.cssText = 'flex:1; word-break:break-word;';
    msg.innerHTML = this.formatEntry(entry);
    el.appendChild(msg);

    el.addEventListener('click', () => {
      this.onSeek(entry.tick);
    });

    el.dataset.tick = String(entry.tick);
    el.dataset.borderColor = config.color;

    return el;
  }

  private formatEntry(entry: ReplayLogEntry): string {
    const d = entry.data;
    switch (entry.event) {
      case 'kill': {
        const killer = escapeHtml(String(d.killerName || ''));
        const victim = escapeHtml(String(d.victimName || ''));
        if (d.selfKill) {
          return `<span style="color:var(--warning)">${victim}</span> self-destructed`;
        }
        return `<span style="color:var(--danger)">${killer}</span> killed <span style="color:var(--text-dim)">${victim}</span>`;
      }
      case 'bomb_place': {
        const owner = escapeHtml(String(d.ownerName || ''));
        const pos = d.pos as { x: number; y: number };
        return `<span style="color:var(--primary)">${owner}</span> placed bomb at (${pos?.x},${pos?.y})`;
      }
      case 'bomb_detonate': {
        const owner = escapeHtml(String(d.ownerName || ''));
        const pos = d.pos as { x: number; y: number };
        return `<span style="color:var(--warning)">${owner}</span> bomb detonated at (${pos?.x},${pos?.y})`;
      }
      case 'bot_decision': {
        const bot = escapeHtml(String(d.botName || ''));
        const decision = escapeHtml(String(d.decision || ''));
        return `<span style="color:var(--info)">${bot}</span>: ${decision}`;
      }
      case 'movement': {
        const player = escapeHtml(String(d.playerName || ''));
        const to = d.to as { x: number; y: number };
        const dir = escapeHtml(String(d.direction || ''));
        return `<span style="color:var(--text-dim)">${player}</span> moved ${dir} to (${to?.x},${to?.y})`;
      }
      case 'powerup_pickup': {
        const player = escapeHtml(String(d.playerName || ''));
        const type = escapeHtml(String(d.type || ''));
        return `<span style="color:var(--success)">${player}</span> picked up ${type}`;
      }
      case 'explosion_detail': {
        const owner = escapeHtml(String(d.ownerName || ''));
        return `<span style="color:var(--warning)">${owner}</span> explosion: ${d.cellCount} cells, ${d.destroyedWalls} walls`;
      }
      case 'game_over':
        return `Game over`;
      default:
        return escapeHtml(JSON.stringify(d));
    }
  }

  private highlightTick(tick: number): void {
    if (!this.logList) return;

    // Remove previous highlights
    const highlighted = this.logList.querySelectorAll('[data-highlighted="true"]');
    for (const el of highlighted) {
      (el as HTMLElement).style.borderLeftColor = 'transparent';
      (el as HTMLElement).style.background = '';
      el.removeAttribute('data-highlighted');
    }

    // Find the closest entry at or before the current tick and scroll to it
    let scrollTarget: HTMLElement | null = null;

    // Highlight entries at the current tick
    const tickEntries = this.entryElements.get(tick);
    if (tickEntries) {
      for (const el of tickEntries) {
        el.style.borderLeftColor = el.dataset.borderColor || 'var(--primary)';
        el.style.background = 'rgba(255,255,255,0.04)';
        el.setAttribute('data-highlighted', 'true');
        if (!scrollTarget) scrollTarget = el;
      }
    }

    // If no entries at exact tick, find nearest preceding entry for scroll
    if (!scrollTarget) {
      const allEntryDivs = this.logList.children;
      for (let i = allEntryDivs.length - 1; i >= 0; i--) {
        const el = allEntryDivs[i] as HTMLElement;
        const entryTick = parseInt(el.dataset.tick || '0');
        if (entryTick <= tick) {
          scrollTarget = el;
          break;
        }
      }
    }

    if (scrollTarget) {
      scrollTarget.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }
}
