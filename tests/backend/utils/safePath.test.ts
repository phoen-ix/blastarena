import { describe, it, expect } from '@jest/globals';
import path from 'path';
import { resolveInside } from '../../../backend/src/utils/safePath';

describe('resolveInside', () => {
  const base = path.resolve('/data/ai');

  it('resolves plain segments under the base', () => {
    expect(resolveInside(base, 'abc-123', 'source.ts')).toBe(
      path.join(base, 'abc-123', 'source.ts'),
    );
  });

  it.each([['..'], ['../ai-evil'], ['x/../../etc'], ['/etc/passwd'], [''], ['.']])(
    'refuses %j, which does not land strictly inside the base',
    (segment) => {
      expect(() => resolveInside(base, segment)).toThrow(/escapes/);
    },
  );
});
