# Bug fix: e2e specs fail on first-request `next dev` compiles

**Severity:** minor (CI hygiene; no user-facing impact) · **Base:** `release/alpha-2` · **Issue:** none
(found while driving PR #320)

## Symptom

Playwright specs fail their first attempt, and sometimes the retry too, on a wait that
expires while `next dev` compiles a route for the first time. `release/alpha-2` went red
on it (run 38303738883, #318 merge).

## Root cause (verified against the app log of each failing run)

CI serves the app with `next dev`, so every route is compiled on its first request. The
spec that happens to reach a route first pays that compile inside a fixed-timeout step.
Which spec pays it moves whenever the suite is resharded.

| Spec | Run | Waiting step | App log |
|---|---|---|---|
| `enhance-template-annotation.spec.ts:95` | 38303738883 shard 2 | `createFlow` → `waitForURL(/flows/…/config, 30s)` | `Compiled /flows/[id]/config in 61.4s`. The retry queued behind the same compile (`GET /admin/flows 200 in 30694ms`) and hit the 45s test timeout too |
| `branding.spec.ts:55` | 38621516985 shard 1 | `expect(getByText('Logo uploaded')).toBeVisible()` (5s) | `Compiled /api/branding/logo in 4.6s`, `POST /api/branding/logo 200 in 5762ms`; the retry's POST took 268ms |

### Reported failures that are *not* cold compiles (out of scope, reported to the maintainer)

- `chat.spec.ts:167` multi-turn. The base fixture answers `/api/chat/<id>/stream` in the
  browser, and neither attempt sent a stream request to the server. The first turn
  rendered no assistant bubble in 8s on both attempts. The 18.5s stream compile in that
  log belongs to the next test (`code-quality-hot-paths › a committed turn…`), which
  passed. A `FIRST_TURN_TIMEOUT` would not help: that turn pays no compile.
- `code-quality-hot-paths.spec.ts:47` chats list. `/chats` was already compiled. The
  first attempt's document arrived in 261ms and the page then sent no tRPC request at
  all. The client stalled; the server was not slow.
- `chat-typing-and-retry.spec.ts`. Failed in run 924 at line 38 (the composer) on both
  attempts, alongside about ten other specs, from the Tailwind 4 hot-reload problem that
  e5f72b2 fixed.

## Reproduction

Shard the suite so that a spec with a short wait is the first to reach a heavy route
(e.g. `/flows/[id]/config`) on a fresh `next dev` server. The wait expires during the
compile.

## Fix plan

Warm the routes in the CI "Wait for app to be ready" step, not per spec:

- The compile cost moves with sharding. The canvas compile is reached through the shared
  `createFlow` helper, so a per-spec allowance would have to go on every caller.
- 61.4s is longer than `NAV_TIMEOUT` (45s) and the default test timeout (45s). Per-spec
  budgets would have to be larger still, which delays every real failure by as much.

`apps/web/e2e/warm-routes.txt` lists each route a spec has been seen paying a compile for.
`apps/web/e2e/warm-routes.sh` mints an admin session through `/api/auth/test-session` (the
middleware would otherwise redirect a page request before the page compiles) and requests
each route once. It fails if a page request is redirected, because a redirect means
nothing compiled.

Regression guard: `apps/web/src/e2e-warm-routes.test.ts` checks that every listed route
still resolves to a page or route handler under `src/app`, and that the e2e workflow runs
the script before Playwright.

## Approved change summary

Approved as summarised in the `/bugfix` session (severity: minor).

- **Goal:** first-request `next dev` compiles stop failing whichever spec happens to reach
  a route first. Failures that are not compile waits stay visible, not hidden behind
  longer timeouts.
- **Rule (CI only):** before Playwright starts, every route a spec reaches first through
  a fixed-timeout step is compiled once. No app behaviour changes.
- **Approach:** a warm-up in the CI ready step, chosen over per-spec timeouts (see Fix
  plan). No spec timeout or assertion changes.
- **Out of scope:** the multi-turn chat and chats-list client stalls (reported above),
  and moving CI off `next dev`.
