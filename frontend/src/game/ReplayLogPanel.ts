import { ReplayLogEntry, ReplayLogEventType, TICK_RATE } from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../utils/html';
import { t } from '../i18n';
import { findTickRange, sortByTick } from './replayLogIndex';

interface FilterState {
  kill: boolean;
  bomb_place: boolean;
  bomb_detonate: boolean;
  bot_decision: boolean;
  movement: boolean;
  powerup_pickup: boolean;
  explosion_detail: boolean;
  player_leave: boolean;
  player_disconnect: boolean;
  player_disconnect_kill: boolean;
  game_over: boolean;
}

// Icon and accent per event type. Labels live in the locale files (`ui:replayLog.*`) and are
// resolved at render time, so nothing here calls t() at module load. (audit G12)
const EVENT_CONFIG: Record<ReplayLogEventType, { icon: string; color: string }> = {
  kill: { icon: '\u2620\uFE0F', color: 'var(--danger)' },
  bomb_place: { icon: '\uD83D\uDCA3', color: 'var(--primary)' },
  bomb_detonate: { icon: '\uD83D\uDCA5', color: 'var(--warning)' },
  bot_decision: { icon: '\uD83E\uDD16', color: 'var(--info)' },
  movement: { icon: '\uD83D\uDC63', color: 'var(--text-dim)' },
  powerup_pickup: { icon: '\u2B50', color: 'var(--success)' },
  explosion_detail: { icon: '\uD83D\uDD25', color: 'var(--warning)' },
  player_leave: { icon: '\uD83D\uDEAA', color: 'var(--warning)' },
  player_disconnect: { icon: '\u26A0\uFE0F', color: 'var(--warning)' },
  player_disconnect_kill: { icon: '\u26A0\uFE0F', color: 'var(--danger)' },
  game_over: { icon: '\uD83C\uDFC1', color: 'var(--accent)' },
};

// Filter groups (some event types share a filter). `labelKey` is an i18n key under `ui:`.
const FILTER_GROUPS: {
  key: string;
  icon: string;
  labelKey: string;
  types: ReplayLogEventType[];
  defaultOn: boolean;
}[] = [
  {
    key: 'kills',
    icon: '\u2620\uFE0F',
    labelKey: 'ui:replayLog.filters.kills',
    types: ['kill'],
    defaultOn: true,
  },
  {
    key: 'bombs',
    icon: '\uD83D\uDCA3',
    labelKey: 'ui:replayLog.filters.bombs',
    types: ['bomb_place', 'bomb_detonate'],
    defaultOn: true,
  },
  {
    key: 'bot',
    icon: '\uD83E\uDD16',
    labelKey: 'ui:replayLog.filters.bot',
    types: ['bot_decision'],
    defaultOn: false,
  },
  {
    key: 'powerups',
    icon: '\u2B50',
    labelKey: 'ui:replayLog.filters.powerups',
    types: ['powerup_pickup'],
    defaultOn: true,
  },
  {
    key: 'movement',
    icon: '\uD83D\uDC63',
    labelKey: 'ui:replayLog.filters.movement',
    types: ['movement'],
    defaultOn: false,
  },
  {
    key: 'explosions',
    icon: '\uD83D\uDD25',
    labelKey: 'ui:replayLog.filters.explosions',
    types: ['explosion_detail'],
    defaultOn: false,
  },
  {
    key: 'players',
    icon: '\u26A0\uFE0F',
    labelKey: 'ui:replayLog.filters.players',
    types: ['player_leave', 'player_disconnect', 'player_disconnect_kill'],
    defaultOn: true,
  },
];

/** A rendered log row, indexed by tick for highlightTick's binary search. (audit F3) */
interface RenderedEntry {
  tick: number;
  el: HTMLElement;
}

export class ReplayLogPanel {
  private entries: ReplayLogEntry[];
  private onSeek: (tick: number) => void;
  private container: HTMLElement | null = null;
  private logList: HTMLElement | null = null;
  private isOpen: boolean = false;
  private currentTick: number = 0;
  private filters: FilterState;

  // Pre-indexed data
  private filteredEntries: ReplayLogEntry[] = [];
  /** Rendered rows sorted by tick — rebuilt in renderLogEntries. (audit F3) */
  private tickIndex: RenderedEntry[] = [];
  /** Rows currently highlighted, so clearing them needs no querySelectorAll. (audit F3) */
  private highlightedEls: HTMLElement[] = [];
  private lastScrollTarget: HTMLElement | null = null;

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
      player_leave: true,
      player_disconnect: true,
      player_disconnect_kill: true,
      game_over: true,
    };

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
      btn.textContent = `${group.icon} ${t(group.labelKey)}`;
      btn.dataset.filterKey = group.key;
      btn.addEventListener('click', () => {
        const isOn = group.types.every((type) => this.filters[type]);
        for (const type of group.types) {
          this.filters[type] = !isOn;
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
    this.tickIndex = [];
    this.highlightedEls = [];
    this.lastScrollTarget = null;
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
    // Scrolling is skipped while hidden; catch up with the current position on open
    if (this.isOpen) {
      this.lastScrollTarget = null;
      this.highlightTick(this.currentTick);
    }
  }

  private rebuildFilteredEntries(): void {
    this.filteredEntries = this.entries.filter((e) => this.filters[e.event]);
  }

  private renderLogEntries(): void {
    if (!this.logList) return;
    setHtml(this.logList, '');
    this.highlightedEls = [];
    this.lastScrollTarget = null;

    const index: RenderedEntry[] = [];
    const fragment = document.createDocumentFragment();
    for (const entry of this.filteredEntries) {
      const el = this.createEntryElement(entry);
      fragment.appendChild(el);
      index.push({ tick: entry.tick, el });
    }
    this.logList.appendChild(fragment);
    this.tickIndex = sortByTick(index);
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
    setHtml(msg, this.formatEntry(entry));
    el.appendChild(msg);

    el.addEventListener('click', () => {
      this.onSeek(entry.tick);
    });

    el.dataset.tick = String(entry.tick);
    el.dataset.borderColor = config.color;

    return el;
  }

  /** A player name wrapped in an accent colour; the name is escaped before it goes into HTML. */
  private static name(value: unknown, color: string): string {
    return `<span style="color:${color}">${escapeHtml(String(value || ''))}</span>`;
  }

  // Log lines are translated (`ui:replayLog.*`); the interpolated names are already escaped
  // HTML, which i18next passes through untouched (escapeValue is off). (audit G12)
  private formatEntry(entry: ReplayLogEntry): string {
    const d = entry.data;
    switch (entry.event) {
      case 'kill': {
        if (d.selfKill) {
          return t('ui:replayLog.selfDestructed', {
            victim: ReplayLogPanel.name(d.victimName, 'var(--warning)'),
          });
        }
        return t('ui:replayLog.killed', {
          killer: ReplayLogPanel.name(d.killerName, 'var(--danger)'),
          victim: ReplayLogPanel.name(d.victimName, 'var(--text-dim)'),
        });
      }
      case 'bomb_place': {
        const pos = d.pos as { x: number; y: number } | undefined;
        return t('ui:replayLog.bombPlaced', {
          owner: ReplayLogPanel.name(d.ownerName, 'var(--primary)'),
          x: pos?.x,
          y: pos?.y,
        });
      }
      case 'bomb_detonate': {
        const pos = d.pos as { x: number; y: number } | undefined;
        return t('ui:replayLog.bombDetonated', {
          owner: ReplayLogPanel.name(d.ownerName, 'var(--warning)'),
          x: pos?.x,
          y: pos?.y,
        });
      }
      case 'bot_decision':
        return t('ui:replayLog.botDecision', {
          bot: ReplayLogPanel.name(d.botName, 'var(--info)'),
          decision: escapeHtml(String(d.decision || '')),
        });
      case 'movement': {
        const to = d.to as { x: number; y: number } | undefined;
        return t('ui:replayLog.moved', {
          player: ReplayLogPanel.name(d.playerName, 'var(--text-dim)'),
          direction: escapeHtml(String(d.direction || '')),
          x: to?.x,
          y: to?.y,
        });
      }
      case 'powerup_pickup':
        return t('ui:replayLog.pickedUp', {
          player: ReplayLogPanel.name(d.playerName, 'var(--success)'),
          type: escapeHtml(String(d.type || '')),
        });
      case 'explosion_detail':
        return t('ui:replayLog.explosion', {
          owner: ReplayLogPanel.name(d.ownerName, 'var(--warning)'),
          cells: d.cellCount,
          walls: d.destroyedWalls,
        });
      case 'player_leave':
        return t('ui:replayLog.left', {
          player: ReplayLogPanel.name(d.playerName, 'var(--warning)'),
        });
      case 'player_disconnect':
        return t('ui:replayLog.disconnected', {
          player: ReplayLogPanel.name(d.playerName, 'var(--warning)'),
        });
      case 'player_disconnect_kill':
        return t('ui:replayLog.disconnectKilled', {
          player: ReplayLogPanel.name(d.playerName, 'var(--danger)'),
        });
      case 'game_over':
        return t('ui:replayLog.gameOver');
      default:
        return escapeHtml(JSON.stringify(d));
    }
  }

  /**
   * Highlight the rows at `tick` and keep the nearest row in view. Two binary searches on the
   * sorted index replace the old per-tick reverse scan of every row. (audit F3)
   */
  private highlightTick(tick: number): void {
    if (!this.logList) return;

    const { start, end, nearest } = findTickRange(this.tickIndex, tick);

    // Nothing to do when the same rows are already lit (the common case between events)
    const same =
      this.highlightedEls.length === end - start &&
      this.highlightedEls.every((el, i) => el === this.tickIndex[start + i].el);

    if (!same) {
      for (const el of this.highlightedEls) {
        el.style.borderLeftColor = 'transparent';
        el.style.background = '';
        el.removeAttribute('data-highlighted');
      }
      this.highlightedEls = [];
      for (let i = start; i < end; i++) {
        const el = this.tickIndex[i].el;
        el.style.borderLeftColor = el.dataset.borderColor || 'var(--primary)';
        el.style.background = 'rgba(255,255,255,0.04)';
        el.setAttribute('data-highlighted', 'true');
        this.highlightedEls.push(el);
      }
    }

    // Exact matches scroll to the first of them; otherwise the nearest preceding entry
    const scrollTarget =
      end > start ? this.tickIndex[start].el : (this.tickIndex[nearest]?.el ?? null);
    if (scrollTarget && this.isOpen && scrollTarget !== this.lastScrollTarget) {
      this.lastScrollTarget = scrollTarget;
      scrollTarget.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }
}
