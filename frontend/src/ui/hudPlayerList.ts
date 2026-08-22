import type { PlayerState } from '@blast-arena/shared';
import { escapeHtml, reconcileChildren, setHtml } from '../utils/html';
import { t } from '../i18n';

/**
 * The in-match HUD player list.
 *
 * Lives outside HUDScene, and imports no Phaser, so it can be driven directly from tests — the
 * diffing below is exactly the kind of thing that looks right and silently isn't.
 *
 * The list used to be rebuilt with `playersEl.innerHTML = sorted.map(...)` on every state update,
 * twenty times a second. Two visible consequences beyond the churn: the `transition: all` on
 * .hud-player-item restarted every tick, and the 300ms orange spectate click-flash was destroyed
 * roughly 50ms after it started. Rows are now keyed by player id and reused, with a rendered
 * signature gating any DOM write. (audit HUD-PLAYERLIST-1)
 */

const TEAM_COLORS = ['#ff4466', '#448aff'];

export interface PlayerListContext {
  /** Present only in King of the Hill; its presence is what switches the score badge on. */
  kothScores?: Record<number, number> | null;
  controllingPlayerId?: number | null;
  /** Dead players can click a row to spectate, which is what makes rows `clickable`. */
  localPlayerDead: boolean;
}

interface Row {
  el: HTMLElement;
  nameEl: HTMLElement;
  badgeEl: HTMLElement;
  sig: string;
}

export class HudPlayerList {
  private rows = new Map<number, Row>();
  private headers: HTMLElement[] = [];

  /**
   * Drop all cached elements.
   *
   * Phaser reuses scene instances, so HUDScene must call this from `create()` — otherwise rows
   * from the previous match survive into the next one.
   */
  reset(): void {
    this.rows.clear();
    this.headers = [];
  }

  render(container: Element, players: readonly PlayerState[], ctx: PlayerListContext): void {
    const isTeamMode = players.some((p) => p.team !== null && p.team !== undefined);
    const isKOTH = !!ctx.kothScores;

    const sorted = [...players].sort((a, b) => {
      // In team mode, group by team first, then alive status
      if (isTeamMode && a.team !== b.team) return (a.team ?? 99) - (b.team ?? 99);
      return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
    });

    // In KOTH, sort by score descending
    if (isKOTH) {
      sorted.sort((a, b) => {
        const sa = ctx.kothScores?.[a.id] ?? 0;
        const sb = ctx.kothScores?.[b.id] ?? 0;
        return sb - sa || (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
      });
    }

    const order: HTMLElement[] = [];
    const seenIds = new Set<number>();
    let lastTeam = -1;
    let headerCount = 0;

    for (const p of sorted) {
      if (isTeamMode && p.team !== lastTeam) {
        lastTeam = p.team ?? -1;
        const team = p.team ?? 0;
        let header = this.headers[headerCount];
        if (!header) {
          header = document.createElement('div');
          header.className = 'hud-team-header';
          this.headers[headerCount] = header;
        }
        headerCount++;
        const teamName = p.team === 0 ? t('ui:hud.teamRed') : t('ui:hud.teamBlue');
        if (header.textContent !== teamName) header.textContent = teamName;
        header.style.cssText = `font-size:11px;font-weight:600;color:${TEAM_COLORS[team]};padding:4px 8px 2px;margin-top:${team > 0 ? '6px' : '0'};`;
        order.push(header);
      }

      seenIds.add(p.id);
      const dead = !p.alive;
      const clickable = p.alive && ctx.localPlayerDead;
      const score = isKOTH ? (ctx.kothScores?.[p.id] ?? 0) : 0;
      const isControlling = isKOTH && ctx.controllingPlayerId === p.id;
      const sig = [
        dead,
        clickable,
        isTeamMode,
        p.team,
        p.isBot,
        p.isBuddy,
        p.username,
        isKOTH,
        score,
        isControlling,
      ].join('|');

      let row = this.rows.get(p.id);
      if (!row) {
        const el = document.createElement('div');
        el.setAttribute('data-player-id', String(p.id));
        const nameEl = document.createElement('span');
        const badgeEl = document.createElement('span');
        el.appendChild(nameEl);
        el.appendChild(badgeEl);
        row = { el, nameEl, badgeEl, sig: '' };
        this.rows.set(p.id, row);
      }

      if (row.sig !== sig) {
        row.sig = sig;
        row.el.className = `hud-player-item${dead ? ' dead' : ''}${clickable ? ' clickable' : ''}`;
        // Individual properties, not cssText: the spectate click-flash writes el.style.background
        // and must survive a re-render.
        row.el.style.display = isKOTH ? 'flex' : '';
        row.el.style.alignItems = isKOTH ? 'center' : '';
        row.el.style.gap = isKOTH ? '4px' : '';

        const teamDot = isTeamMode
          ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${TEAM_COLORS[p.team ?? 0]};margin-right:4px;vertical-align:middle;"></span>`
          : '';
        const buddyTag = p.isBuddy
          ? '<span style="color:var(--accent);font-size:10px;font-weight:700;margin-left:4px;">[BUDDY]</span>'
          : '';
        setHtml(
          row.nameEl,
          `${teamDot}${p.isBot ? '🤖 ' : ''}${escapeHtml(p.username)}${buddyTag}`,
        );

        if (isKOTH) {
          row.badgeEl.style.cssText = `margin-left:auto;font-size:11px;font-weight:700;color:${isControlling ? '#00e676' : '#ffaa22'};font-family:'Chakra Petch',monospace;`;
          row.badgeEl.textContent = `${isControlling ? '👑 ' : ''}${score}`;
        } else if (row.badgeEl.textContent) {
          row.badgeEl.style.cssText = 'display:none;';
          row.badgeEl.textContent = '';
        }
      }
      order.push(row.el);
    }

    // Reconcile positions: row order is not stable (team grouping, alive status, live KOTH score),
    // so elements move rather than just change content.
    reconcileChildren(container, order);

    this.headers.length = headerCount;
    for (const id of this.rows.keys()) {
      if (!seenIds.has(id)) this.rows.delete(id);
    }
  }
}
