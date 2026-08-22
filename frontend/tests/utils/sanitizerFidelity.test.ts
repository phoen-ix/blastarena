import { describe, it, expect } from 'vitest';
import { setHtml, insertHtml } from '../../src/utils/html';
import { collectHtmlLiterals, hostTagFor, PLACEHOLDER } from '../helpers/htmlLiterals';

/**
 * Every HTML string the frontend builds now goes through DOMPurify (see `setHtml`). Sanitising is
 * only defence in depth if it is *invisible* — the moment it rewrites legitimate markup, someone
 * reverts the sink and the Trusted Types enforcement goes with it.
 *
 * So: pull every literal that looks like HTML out of the source, and assert `setHtml` produces the
 * same DOM the plain `innerHTML` assignment it replaced would have. Its companion,
 * trustedTypesEnforcement.test.ts, proves the insertion never touches a Trusted Types sink.
 * (audit CSP-1)
 */

/**
 * Canonical form of an element's children: tags, sorted attributes and text, whitespace collapsed.
 *
 * Comparing serialised `innerHTML` is too strict — DOMPurify trims leading and trailing whitespace
 * inside attribute values, so a `style` written across source lines comes back on one line. That
 * is the same CSS and the same DOM; only the source text differs.
 */
function canonical(root: Element): string {
  const out: string[] = [];
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  const emitChildren = (parent: Node) => {
    // Adjacent text nodes are a parse detail — `a${x}b` may arrive as one node or three — so
    // concatenate a run of them raw and squash once, not per node.
    let buffer = '';
    const flush = () => {
      const text = squash(buffer);
      if (text) out.push(`#text ${text}`);
      buffer = '';
    };

    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        buffer += child.textContent ?? '';
        continue;
      }
      flush();
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const attrs = Array.from(el.attributes)
        // `${cond ? 'selected' : ''}` in attribute position becomes a bare `xy` attribute once the
        // placeholder is substituted. That is an artefact of this scan, not of the real markup,
        // and DOMPurify is right to drop an unknown attribute — so ignore it on both sides.
        .filter((a) => a.name !== PLACEHOLDER.toLowerCase())
        .map((a) => `${a.name}=${squash(a.value)}`)
        .sort();
      out.push(`<${el.tagName.toLowerCase()} ${attrs.join(' ')}>`);
      emitChildren(el);
      out.push(`</${el.tagName.toLowerCase()}>`);
    }
    flush();
  };

  emitChildren(root);
  return out.join('\n');
}

describe('sanitiser fidelity against this app markup', () => {
  const literals = collectHtmlLiterals();

  it('finds the markup to check (guards against the scan silently breaking)', () => {
    expect(literals.length).toBeGreaterThan(200);
  });

  it('setHtml produces the same DOM as the innerHTML assignment it replaced', () => {
    const changed: string[] = [];
    for (const lit of literals) {
      const tag = hostTagFor(lit.text);

      const native = document.createElement(tag);
      native.innerHTML = lit.text;

      const sanitised = document.createElement(tag);
      setHtml(sanitised, lit.text);

      const before = canonical(native);
      const after = canonical(sanitised);
      if (before !== after) {
        changed.push(`${lit.file}:${lit.line} (in <${tag}>)\n  was: ${before}\n  now: ${after}`);
      }
    }
    expect(changed.join('\n\n')).toBe('');
  });

  it('keeps table fragments intact', () => {
    // The failure this guards against is silent and total: DOMPurify parses in a body context,
    // where the HTML parser throws away <tr>/<td> and keeps only their text.
    const tbody = document.createElement('tbody');
    setHtml(tbody, '<tr data-id="7"><td>a</td><td>b</td></tr>');
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
    expect(tbody.querySelectorAll('td')).toHaveLength(2);
    expect(tbody.querySelector('tr')?.getAttribute('data-id')).toBe('7');

    const tr = document.createElement('tr');
    setHtml(tr, '<td>x</td><th>y</th>');
    expect(tr.children).toHaveLength(2);

    const table = document.createElement('table');
    setHtml(table, '<thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody>');
    expect(table.querySelector('thead th')?.textContent).toBe('h');
    expect(table.querySelector('tbody td')?.textContent).toBe('c');
  });

  it('still strips the things it is there to strip', () => {
    const el = document.createElement('div');

    setHtml(el, '<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')?.hasAttribute('onerror')).toBe(false);

    setHtml(el, '<div>ok</div><script>alert(1)</script>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe('ok');

    setHtml(el, '<div>ok</div><iframe></iframe>');
    expect(el.querySelector('iframe')).toBeNull();

    // Escaping remains the first line of defence for interpolated values.
    setHtml(el, `<span>${'<img src=x onerror=alert(1)>'.replace(/</g, '&lt;')}</span>`);
    expect(el.querySelector('img')).toBeNull();
  });

  it('preserves the CSS custom properties and target attribute this app relies on', () => {
    const el = document.createElement('div');
    setHtml(el, '<div style="color:var(--text-dim);border-top:1px solid var(--border)">x</div>');
    expect((el.firstElementChild as HTMLElement).style.color).toBe('var(--text-dim)');

    setHtml(el, '<a href="https://example.com" target="_blank" rel="noopener">x</a>');
    expect(el.querySelector('a')?.getAttribute('target')).toBe('_blank');
  });

  it('clears content for an empty string, and inserts without disturbing siblings', () => {
    const el = document.createElement('div');
    setHtml(el, '<span>a</span>');
    setHtml(el, '');
    expect(el.childNodes).toHaveLength(0);

    setHtml(el, '<span id="keep">a</span>');
    insertHtml(el, 'beforeend', '<b>b</b>');
    expect(el.querySelector('#keep')).not.toBeNull();
    expect(el.querySelector('b')?.textContent).toBe('b');

    insertHtml(el, 'afterbegin', '<i>i</i>');
    expect(el.firstElementChild?.tagName).toBe('I');
  });
});
