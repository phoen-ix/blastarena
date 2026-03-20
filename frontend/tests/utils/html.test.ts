import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr } from '../../src/utils/html';

describe('escapeHtml', () => {
  it('escapes <script> tags', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;'
    );
  });

  it('escapes & characters', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes < and > in content', () => {
    expect(escapeHtml('a < b > c')).toBe('a &lt; b &gt; c');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('escapeAttr', () => {
  it('replaces " with &quot;', () => {
    expect(escapeAttr('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it("replaces ' with &#39;", () => {
    expect(escapeAttr("it's")).toBe('it&#39;s');
  });

  it('replaces < with &lt;', () => {
    expect(escapeAttr('a < b')).toBe('a &lt; b');
  });

  it('replaces > with &gt;', () => {
    expect(escapeAttr('a > b')).toBe('a &gt; b');
  });

  it('handles multiple special chars in one string', () => {
    expect(escapeAttr('<div class="x">\'hi\'</div>')).toBe(
      '&lt;div class=&quot;x&quot;&gt;&#39;hi&#39;&lt;/div&gt;'
    );
  });

  it('returns empty string for empty input', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeAttr('hello world')).toBe('hello world');
  });
});
