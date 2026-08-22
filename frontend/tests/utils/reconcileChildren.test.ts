import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileChildren } from '../../src/utils/html';

let parent: HTMLElement;

const make = (id: string) => {
  const el = document.createElement('div');
  el.id = id;
  return el;
};
const ids = () => Array.from(parent.children).map((c) => c.id);

beforeEach(() => {
  parent = document.createElement('div');
});

describe('reconcileChildren', () => {
  it('appends into an empty parent', () => {
    reconcileChildren(parent, [make('a'), make('b'), make('c')]);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op when the order already matches', () => {
    const nodes = [make('a'), make('b'), make('c')];
    reconcileChildren(parent, nodes);
    const before = Array.from(parent.children);
    reconcileChildren(parent, nodes);
    expect(Array.from(parent.children)).toEqual(before); // same object identities, not just ids
  });

  it('reorders without recreating nodes', () => {
    const a = make('a');
    const b = make('b');
    const c = make('c');
    reconcileChildren(parent, [a, b, c]);
    reconcileChildren(parent, [c, a, b]);
    expect(ids()).toEqual(['c', 'a', 'b']);
    expect(parent.children[0]).toBe(c);
    expect(parent.children[1]).toBe(a);
  });

  it('removes nodes dropped from the order, wherever they sit', () => {
    const a = make('a');
    const x = make('x');
    const b = make('b');
    reconcileChildren(parent, [a, x, b]);
    reconcileChildren(parent, [a, b]); // x was in the middle
    expect(ids()).toEqual(['a', 'b']);
    expect(x.parentNode).toBeNull();
  });

  it('empties the parent for an empty order', () => {
    reconcileChildren(parent, [make('a'), make('b')]);
    reconcileChildren(parent, []);
    expect(parent.childNodes.length).toBe(0);
  });

  it('adopts pre-existing children it does not own', () => {
    parent.appendChild(make('stale1'));
    parent.appendChild(make('stale2'));
    reconcileChildren(parent, [make('fresh')]);
    expect(ids()).toEqual(['fresh']);
  });

  it('preserves inline styles and listener state across a reorder', () => {
    const a = make('a');
    const b = make('b');
    reconcileChildren(parent, [a, b]);
    a.style.background = 'rgba(255, 107, 53, 0.6)'; // the spectate click-flash
    let clicks = 0;
    a.addEventListener('mousedown', () => clicks++);

    reconcileChildren(parent, [b, a]);

    expect(a.style.background).toBe('rgba(255, 107, 53, 0.6)');
    a.dispatchEvent(new Event('mousedown'));
    expect(clicks).toBe(1);
  });

  it('handles arbitrary permutations, insertions and deletions', () => {
    const pool = new Map<string, HTMLElement>();
    const get = (id: string) => {
      let el = pool.get(id);
      if (!el) pool.set(id, (el = make(id)));
      return el;
    };
    const rounds = [
      ['a', 'b', 'c', 'd'],
      ['d', 'c', 'b', 'a'],
      ['b', 'd'],
      ['e', 'b', 'a', 'd', 'c'],
      [],
      ['c', 'a'],
    ];
    for (const round of rounds) {
      reconcileChildren(parent, round.map(get));
      expect(ids()).toEqual(round);
    }
  });
});
