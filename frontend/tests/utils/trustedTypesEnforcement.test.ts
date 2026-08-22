import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { collectHtmlLiterals, hostTagFor } from '../helpers/htmlLiterals';

/**
 * Proves the Trusted Types migration actually holds, by enforcing it.
 *
 * The CSP now ships `require-trusted-types-for 'script'`. In Chromium that turns every
 * `element.innerHTML = someString` into a thrown TypeError — in production, and nowhere else.
 * Firefox and Safari ignore the directive, `vite dev` serves no CSP, and jsdom/happy-dom have no
 * Trusted Types, so a missed sink is invisible to every other check in this repo.
 *
 * This installs the enforcement: the `innerHTML` / `outerHTML` setters and `insertAdjacentHTML`
 * reject anything that is not a branded TrustedHTML, exactly as Chromium does. Then it drives the
 * real `setHtml` over every HTML literal in the source, plus the modules that build markup without
 * pulling in Phaser.
 *
 * The first test deliberately asserts a raw assignment DOES throw. Without it the whole file
 * could pass while enforcing nothing. (audit CSP-1)
 */

const TRUSTED = Symbol.for('test.trustedHTML');
type Branded = { [TRUSTED]: true; toString(): string };

const isBranded = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[TRUSTED] === true;

/** Find `prop` wherever it actually lives on the prototype chain. */
function findDescriptor(proto: object, prop: string) {
  let cur: object | null = proto;
  while (cur) {
    const d = Object.getOwnPropertyDescriptor(cur, prop);
    if (d) return { owner: cur, descriptor: d };
    cur = Object.getPrototypeOf(cur);
  }
  return null;
}

const restores: (() => void)[] = [];

function enforce(prop: 'innerHTML' | 'outerHTML') {
  const found = findDescriptor(Element.prototype, prop);
  if (!found) throw new Error(`cannot find ${prop} descriptor to enforce against`);
  const { owner, descriptor } = found;
  const originalSet = descriptor.set;
  if (!originalSet) throw new Error(`${prop} has no setter`);

  Object.defineProperty(owner, prop, {
    ...descriptor,
    set(this: Element, value: unknown) {
      if (!isBranded(value)) {
        throw new TypeError(
          `Failed to set the '${prop}' property on 'Element': This document requires ` +
            `'TrustedHTML' assignment. Got: ${String(value).slice(0, 120)}`,
        );
      }
      originalSet.call(this, String(value));
    },
  });
  restores.push(() => Object.defineProperty(owner, prop, descriptor));
}

beforeAll(async () => {
  // A Trusted Types shim, installed BEFORE utils/html (and therefore DOMPurify) is imported —
  // DOMPurify creates its policy at module init, so the order matters.
  const trustedTypes = {
    createPolicy(_name: string, rules: { createHTML(s: string): string }) {
      return {
        createHTML(s: string): Branded {
          const html = rules.createHTML(s);
          return { [TRUSTED]: true, toString: () => html };
        },
      };
    },
  };
  (globalThis as Record<string, unknown>).trustedTypes = trustedTypes;
  (window as unknown as Record<string, unknown>).trustedTypes = trustedTypes;

  enforce('innerHTML');
  enforce('outerHTML');

  const found = findDescriptor(Element.prototype, 'insertAdjacentHTML');
  if (found) {
    const original = found.descriptor.value;
    Object.defineProperty(found.owner, 'insertAdjacentHTML', {
      ...found.descriptor,
      value(this: Element, position: string, value: unknown) {
        if (!isBranded(value)) {
          throw new TypeError(
            "Failed to execute 'insertAdjacentHTML' on 'Element': This document requires " +
              "'TrustedHTML' assignment.",
          );
        }
        return original.call(this, position, String(value));
      },
    });
    restores.push(() => Object.defineProperty(found.owner, 'insertAdjacentHTML', found.descriptor));
  }
});

afterAll(() => {
  for (const restore of restores.reverse()) restore();
  delete (globalThis as Record<string, unknown>).trustedTypes;
});

describe('Trusted Types enforcement', () => {
  it('the harness actually enforces (a raw assignment must throw)', () => {
    const el = document.createElement('div');
    expect(() => {
      el.innerHTML = '<b>x</b>';
    }).toThrow(/TrustedHTML/);
    expect(() => {
      el.insertAdjacentHTML('beforeend', '<b>x</b>');
    }).toThrow(/TrustedHTML/);
    // ...and the branded form is accepted, so the harness is not simply blocking everything.
    expect(() => {
      (el as unknown as { innerHTML: unknown }).innerHTML = {
        [TRUSTED]: true,
        toString: () => '<b>ok</b>',
      };
    }).not.toThrow();
    expect(el.textContent).toBe('ok');
  });

  it('setHtml inserts every HTML literal in the source without touching a sink', async () => {
    const { setHtml } = await import('../../src/utils/html');
    const literals = collectHtmlLiterals();
    expect(literals.length).toBeGreaterThan(200);

    const failures: string[] = [];
    for (const lit of literals) {
      const host = document.createElement(hostTagFor(lit.text));
      try {
        setHtml(host, lit.text);
      } catch (err) {
        failures.push(`${lit.file}:${lit.line} — ${(err as Error).message}`);
      }
    }
    expect(failures.slice(0, 10).join('\n')).toBe('');
  });

  it('insertHtml inserts without touching a sink, in every position', async () => {
    const { insertHtml, setHtml } = await import('../../src/utils/html');
    const parent = document.createElement('div');
    const anchor = document.createElement('span');
    parent.appendChild(anchor);

    for (const position of ['beforebegin', 'afterbegin', 'beforeend', 'afterend'] as const) {
      expect(() => insertHtml(anchor, position, '<b>x</b>')).not.toThrow();
    }
    expect(() => setHtml(parent, '')).not.toThrow();
  });

  it('the HUD player list renders under enforcement', async () => {
    // The one markup-building module that does not import Phaser, so it can be driven directly.
    const { HudPlayerList } = await import('../../src/ui/hudPlayerList');
    const list = new HudPlayerList();
    const el = document.createElement('div');
    const players = [
      { id: 1, username: 'alice', alive: true, team: 0, isBot: false },
      { id: 2, username: '<img src=x>', alive: false, team: 1, isBot: true },
      { id: -3, username: 'buddy', alive: true, team: 1, isBot: false, isBuddy: true },
    ];
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      list.render(el, players as any, {
        localPlayerDead: true,
        kothScores: { 1: 5, 2: 2, [-3]: 0 },
        controllingPlayerId: 1,
      }),
    ).not.toThrow();
    expect(el.querySelectorAll('.hud-player-item')).toHaveLength(3);
    expect(el.querySelector('img')).toBeNull();
  });

  it('escapeHtml still works — it reads innerHTML, which is not a sink', async () => {
    const { escapeHtml } = await import('../../src/utils/html');
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
