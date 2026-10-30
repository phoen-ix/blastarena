# E2E coverage

Every user-facing feature mapped to the Playwright test that exercises it, or to the reason it is
not driven. The suite is split in two parts with their own spec directories and coverage files:

| Part | Scope | Specs | Coverage |
|---|---|---|---|
| A | player side: landing and open world, lobby views, rooms, matches (bots, several browser contexts), campaign, replays, help, social, stats, settings | `e2e/player/` | [COVERAGE.a.md](COVERAGE.a.md) |
| B | admin side and the level editor | see [COVERAGE.b.md](COVERAGE.b.md) | [COVERAGE.b.md](COVERAGE.b.md) |

Each part file starts with its extraction command, date and item count.

## Running

```bash
bash scripts/e2e.sh                         # whole suite (both parts)
bash scripts/e2e.sh player/rooms.spec.ts    # any Playwright arguments pass through
```

`scripts/e2e.sh` builds the production images, starts `docker-compose.yml` + `docker-compose.e2e.yml`
(profile `mail`: a Mailpit SMTP sink) as project `blastarena_e2e` on `127.0.0.1:${PORT_BASE:-24200}`
(Mailpit API on `PORT_BASE+5`), runs `e2e/playwright.config.ts` (every `*.spec.ts` under `e2e/`
except the docs tour) and tears the stack down. The frontend is built with `VITE_E2E_HOOKS=1`, which
adds one read-only probe, `window.__e2eScenes()` (the running Phaser scene keys), for canvas-only
screens such as the game-over results. Artifacts (HTML report, traces of failures, stack log) go to
`$ARTIFACTS`. Rules: 2 workers, no retries locally (1 in CI), every test owns its data (unique
names), a page error or a 5xx response fails the test. Tests that change server-wide state
(settings, banner, active challenge, seasons, bulk deletes) carry the tag `@global`: the script runs
everything else first (`--grep-invert @global`), then those alone (`--grep @global --workers=1`).
Filter runs by path (`player/`, `b/`, a file); a `-g` would replace the phase filter.
