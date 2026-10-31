import path from 'path';

/**
 * Resolve `segments` under `baseDir` and refuse any result that is not strictly inside it.
 *
 * Path segments here come from ids and names a request supplied (AI ids, a simulation's game
 * mode, room codes in log names). They are validated where they enter, but a file path is only
 * safe when the path itself is checked: `..`, an absolute segment or a separator in any of them
 * would otherwise walk out of the data directory.
 */
export function resolveInside(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`Path escapes ${base}: ${segments.join('/')}`);
  }
  return target;
}
