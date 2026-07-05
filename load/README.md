# Load test suite (k6)

Dev tooling for the **Scaling Within the Current Stack** phase, Group D (item
16). This is **not** a runtime service — it is a set of [k6](https://k6.io)
scripts you run by hand (or in a pipeline) to measure the app against its SLOs
before and after each scaling group, so sizing is measured rather than guessed.

The suite lives at the repo root, outside the pnpm workspace, so it is never
typechecked, linted, or run by `validate.sh` / `turbo`. It has no npm
dependencies — k6 bundles its own runtime.

## Install k6

k6 is a single binary; it is not installed via npm.

```bash
brew install k6            # macOS
# or: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## SLOs (the ship gates)

Defined in `config.js`. Targets are for **~500 concurrent active users** — the
phase target (≈5000 registered accounts at ~10% concurrency).

| Path | Metric | Target |
| --- | --- | --- |
| Light reads / SSE subscribe | error rate | < 1% |
| Light reads / SSE subscribe | p95 request latency | < 2 s |
| Chat turn | error rate | < 2% |
| Chat turn | p95 time-to-first-byte | < 2.5 s |
| Chat turn | p95 full turn duration | < 15 s |

A turn runs several LLM calls, so its end-to-end duration is intentionally loose
— time-to-first-byte is what a user feels. **Calibrate the absolute numbers
against a measured baseline** for the target deployment; the metric shapes are
fixed, the thresholds are a starting point. A run passes when every k6 threshold
holds (k6 exits non-zero otherwise, so this gates a pipeline cleanly).

## Environment

| Variable | Meaning | Default |
| --- | --- | --- |
| `WEB_BASE_URL` | Next.js app | `http://localhost:3000` |
| `API_BASE_URL` | Express API / scheduler | `http://localhost:3001` |
| `SESSION_ID` | existing session UUID to exercise | — (required for turn/read) |
| `AUTH_COOKIE` | full `Cookie` header for an authenticated user | — (required for turn/read) |
| `TARGET_VUS` | peak concurrent virtual users | `500` |
| `TURN_PROMPT` | message a synthetic turn sends | a short status prompt |

Grab `AUTH_COOKIE` from a logged-in browser session (DevTools → Network → any
request → `cookie` request header) or your auth tooling. `SESSION_ID` is any
session the user can access — copy it from a `/chats/<id>` URL.

## Running

Always smoke first — it needs no auth and proves the suite is wired:

```bash
k6 run load/scenarios/smoke.js
```

Then the load scenarios (start well below 500 while calibrating):

```bash
# Steady-state read/subscribe load — the cost of open windows
SESSION_ID=<uuid> AUTH_COOKIE='<cookie>' \
  k6 run -e TARGET_VUS=100 load/scenarios/session-read.js

# Hot-path chat turns — spends real LLM budget; use a staging key
SESSION_ID=<uuid> AUTH_COOKIE='<cookie>' \
  k6 run -e TARGET_VUS=100 load/scenarios/chat-turn.js
```

Raise `TARGET_VUS` toward 500 once the smaller runs are green.

## Before/after each group

The phase requires running this suite **before and after** each scaling group so
each change's effect is measured. The most instructive comparison is
`session-read.js` across the Group C boundary: with polling, each idle open
window cost ~0.8 DB queries/s; with the SSE transport it drops toward ~0. Record
each run's k6 summary (and, where you can, `pg_stat_statements`) so the phase's
capacity model is backed by numbers, not estimates.

## Safety

- Chat turns spend real provider budget and advance real sessions. Run against a
  **staging** deployment with a test provider key, never production.
- The ramp holds at peak for 3 minutes (`ramp()` in `config.js`); a full run is
  ~7 minutes per scenario.
