/**
 * Express 5 types `req.params[name]` as `string | string[]`: path-to-regexp v8 binds a wildcard
 * (`*name`) to several path segments. No route here declares one, so the array arm cannot occur
 * today — but the type cannot prove that, and a cast at every call site would hide the day a
 * route does add one.
 *
 * Narrow it in one place instead. If an array ever does arrive, take the first segment rather
 * than stringifying the array (`String(['1', '2'])` is "1,2", which `parseInt` reads as 1).
 */
export function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * `?page=&limit=` for list endpoints: page at least 1, limit between 1 and `maxLimit`. Unclamped,
 * `?page=-5` gave a negative SQL OFFSET (a driver error, an opaque 500) and a huge `limit` streamed
 * a whole table. The same two lines were repeated in a dozen routes. (audit ADMIN-PAGINATION-1)
 */
export function pageParams(
  query: { page?: unknown; limit?: unknown },
  defaultLimit: number,
  maxLimit: number,
): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(query.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(query.limit)) || defaultLimit));
  return { page, limit };
}
