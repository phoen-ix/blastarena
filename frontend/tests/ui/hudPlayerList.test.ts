import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlayerState } from '@blast-arena/shared';
import { HudPlayerList } from '../../src/ui/hudPlayerList';

// i18n is not initialised in tests; t() would return the raw key, which is fine but noisy.
vi.mock('../../src/i18n', () => ({
  t: (key: string) => (key === 'ui:hud.teamRed' ? 'RED' : key === 'ui:hud.teamBlue' ? 'BLUE' : key),
}));

/** A PlayerState with only the fields the list reads; the rest never leave the server. */
function player(over: Partial<PlayerState> & { id: number }): PlayerState {
  return {
    id: over.id,
    username: `P${over.id}`,
    alive: true,
    team: null,
    isBot: false,
    ...over,
  } as PlayerState;
}

let list: HudPlayerList;
let el: HTMLElement;

const rows = () =>
  Array.from(el.querySelectorAll('.hud-player-item')).map((r) => r.getAttribute('data-player-id'));
const names = () => Array.from(el.children).map((c) => c.textContent);

beforeEach(() => {
  list = new HudPlayerList();
  el = document.createElement('div');
});

describe('HudPlayerList', () => {
  it('renders one row per player, alive first', () => {
    list.render(el, [player({ id: 1, alive: false }), player({ id: 2 }), player({ id: 3 })], {
      localPlayerDead: false,
    });
    expect(rows()).toEqual(['2', '3', '1']);
    expect(el.querySelector('[data-player-id="1"]')?.className).toContain('dead');
  });

  it('reuses the same DOM node for a player across renders', () => {
    const players = [player({ id: 1 }), player({ id: 2 })];
    list.render(el, players, { localPlayerDead: false });
    const first = el.querySelector('[data-player-id="1"]');

    list.render(el, players, { localPlayerDead: false });
    expect(el.querySelector('[data-player-id="1"]')).toBe(first);
  });

  it('writes nothing when nothing changed — the reason the click-flash survives', () => {
    const players = [player({ id: 1 }), player({ id: 2 })];
    list.render(el, players, { localPlayerDead: true });

    // The spectate handler sets this inline, then clears it 300ms later. A full re-render
    // between those two moments used to destroy the node it was set on.
    const row = el.querySelector<HTMLElement>('[data-player-id="1"]')!;
    row.style.background = 'rgba(255, 107, 53, 0.6)';
    const nameHtml = row.firstElementChild!.innerHTML;

    for (let tick = 0; tick < 20; tick++) list.render(el, players, { localPlayerDead: true });

    expect(row.parentNode).toBe(el);
    expect(row.style.background).toBe('rgba(255, 107, 53, 0.6)');
    expect(row.firstElementChild!.innerHTML).toBe(nameHtml);
  });

  it('updates a row in place when a player dies, keeping the node', () => {
    const before = [player({ id: 1 }), player({ id: 2 })];
    list.render(el, before, { localPlayerDead: false });
    const row1 = el.querySelector('[data-player-id="1"]');

    list.render(el, [player({ id: 1, alive: false }), player({ id: 2 })], {
      localPlayerDead: false,
    });
    expect(el.querySelector('[data-player-id="1"]')).toBe(row1);
    expect(row1?.className).toContain('dead');
    expect(rows()).toEqual(['2', '1']); // dead player sorted to the bottom
  });

  it('marks rows clickable only while the local player is dead', () => {
    const players = [player({ id: 1 }), player({ id: 2, alive: false })];
    list.render(el, players, { localPlayerDead: false });
    expect(el.querySelector('[data-player-id="1"]')?.className).not.toContain('clickable');

    list.render(el, players, { localPlayerDead: true });
    expect(el.querySelector('[data-player-id="1"]')?.className).toContain('clickable');
    // A dead player is never a spectate target.
    expect(el.querySelector('[data-player-id="2"]')?.className).not.toContain('clickable');
  });

  it('adds and removes players without disturbing the survivors', () => {
    list.render(el, [player({ id: 1 }), player({ id: 2 })], { localPlayerDead: false });
    const row2 = el.querySelector('[data-player-id="2"]');

    list.render(el, [player({ id: 2 }), player({ id: 3 })], { localPlayerDead: false });
    expect(rows()).toEqual(['2', '3']);
    expect(el.querySelector('[data-player-id="2"]')).toBe(row2);
    expect(el.querySelector('[data-player-id="1"]')).toBeNull();
  });

  it('emits a team header per team, as a sibling of the rows', () => {
    list.render(
      el,
      [player({ id: 1, team: 0 }), player({ id: 2, team: 1 }), player({ id: 3, team: 0 })],
      { localPlayerDead: false },
    );
    expect(names()).toEqual(['RED', 'P1', 'P3', 'BLUE', 'P2']);
    expect(el.querySelectorAll('.hud-team-header')).toHaveLength(2);
  });

  it('drops a team header when the mode changes, leaving no orphan', () => {
    list.render(el, [player({ id: 1, team: 0 }), player({ id: 2, team: 1 })], {
      localPlayerDead: false,
    });
    expect(el.querySelectorAll('.hud-team-header')).toHaveLength(2);

    list.render(el, [player({ id: 1 }), player({ id: 2 })], { localPlayerDead: false });
    expect(el.querySelectorAll('.hud-team-header')).toHaveLength(0);
    expect(rows()).toEqual(['1', '2']);
  });

  it('reorders on live KOTH score and crowns the controlling player', () => {
    const players = [player({ id: 1 }), player({ id: 2 })];
    list.render(el, players, {
      localPlayerDead: false,
      kothScores: { 1: 3, 2: 9 },
      controllingPlayerId: 2,
    });
    expect(rows()).toEqual(['2', '1']);
    const leader = el.querySelector('[data-player-id="2"]')!;
    expect(leader.textContent).toContain('👑');
    expect(leader.textContent).toContain('9');

    // Scores move; the rows must move with them, reusing the same nodes.
    const row1 = el.querySelector('[data-player-id="1"]');
    list.render(el, players, {
      localPlayerDead: false,
      kothScores: { 1: 12, 2: 9 },
      controllingPlayerId: 1,
    });
    expect(rows()).toEqual(['1', '2']);
    expect(el.querySelector('[data-player-id="1"]')).toBe(row1);
    expect(el.querySelector('[data-player-id="2"]')?.textContent).not.toContain('👑');
  });

  it('escapes usernames', () => {
    list.render(el, [player({ id: 1, username: '<img src=x onerror=alert(1)>' })], {
      localPlayerDead: false,
    });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('tags bots and buddies', () => {
    list.render(el, [player({ id: -1, isBot: true }), player({ id: -2, isBuddy: true })], {
      localPlayerDead: false,
    });
    expect(el.querySelector('[data-player-id="-1"]')?.textContent).toContain('🤖');
    expect(el.querySelector('[data-player-id="-2"]')?.textContent).toContain('[BUDDY]');
  });

  it('reset() drops cached rows so a reused scene starts clean', () => {
    list.render(el, [player({ id: 1 })], { localPlayerDead: false });
    const row = el.querySelector('[data-player-id="1"]');

    list.reset();
    list.render(el, [player({ id: 1 })], { localPlayerDead: false });
    expect(el.querySelector('[data-player-id="1"]')).not.toBe(row);
    expect(rows()).toEqual(['1']); // and the stale node is gone, not duplicated
  });
});
