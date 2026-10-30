# v0.40.5 — E2E against a production build

## Root cause

`next dev` kept every compiled route in memory for the E2E run: 8 GB after the route warm-up, more
as the suite went on. On the CI runner the server stalled in GC near its heap ceiling, and specs
running at that moment timed out. The stalls were independent of the code under test: `main` went
from green to red with only skill docs changed.

## Fix applied

- `.github/workflows/e2e.yml`: both E2E jobs build the app and serve it with `next start`.
- Removed the route warm-up (`warm-routes.sh`, `warm-routes.txt`, its route-resolution test) and the
  `E2E_KEEP_ROUTES_COMPILED` config it needed.
- `field-report-section.tsx`: the Insights filters (Date range, Filter on, Operator, Value) carry an
  `aria-label`.
- Specs: the flow editor audit opens the seeded flow directly; the rate-limit burst waits for
  Wayfinder's own 429 (with `Retry-After`) rather than Better Auth's; the sticky-link spec takes the
  first of its two loading indicators; the flow test-run and chat send specs script the server-side
  AI instead of counting a browser-mocked reply the page discards on resync.
- `/e2e-cc-web` runs the stack the way CI now does.

## Tests

- Regression: `accessibility.spec.ts` audits Insights (failed before the `aria-label` fix, passes after).
- E2E: accessibility is group 5 of `docs/guides/e2e-test-policy.md`, so the Insights audit extends the
  existing accessibility spec. The three spec corrections are test bugs, not new coverage.
- Full chromium suite and the PKI project pass locally against a production build (160 passed,
  1 skipped by design).
