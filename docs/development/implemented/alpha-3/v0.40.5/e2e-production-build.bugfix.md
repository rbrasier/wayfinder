# Bug fix — main's E2E suite times out in specs that have nothing wrong with them

Source: red Playwright E2E on `main` (run #1058, `129e8ef`) and on the forward-merge PR #373. No issue.
Severity: major. The E2E check fails on `main` without a code change, so a PR's red E2E says nothing
about the PR.

## Symptom

Every recent `main` run fails a different handful of specs, mostly with
`page.goto: Timeout 30000ms exceeded` or `apiRequestContext.post: Timeout 15000ms exceeded`. A
retry often fails again. Run #1058 failed the Email step editor accessibility audit and the auth
rate-limit burst; PR #373's two attempts failed those plus `fix-synthesise-live-results` and the
multi-turn chat spec, with 9–11 more passing only on retry. Run #1027 passed, and the only commits
between #1027 and #1058 touch skill docs.

## Root cause

The suite ran against `next dev`. The dev server compiles a route on its first request, and CI set
`E2E_KEEP_ROUTES_COMPILED` so that no compiled route was ever disposed. Each route's server bundle
pulls in the whole container graph (every AI SDK, LangChain, docx, the embeddings stack), and the dev
server held all of them at once.

Measured locally against `main`'s workflow settings:

- After the first page compile, the server's RSS is 3.4 GB. Each further route adds 300–500 MB.
- After `warm-routes.sh` (21 routes), RSS is 8.0 GB, before a single spec runs.
- Part-way through shard 1 it reached 11.4 GB and was OOM-killed; 24 specs then failed with
  connection errors.

On the 16 GB CI runner the server instead runs up against its 12 GB heap ceiling (or the `next dev`
restart threshold at 80% of it), next to Postgres, SeaweedFS, the mocks and Chromium. Near the
ceiling V8 spends its time in GC, so every request slows: run #1058's app log shows ~1 s for a
plain page, 9.5 s for the session events route and 14.8 s for one sign-in. Whichever spec is running
when that happens times out. `webpackMemoryOptimizations` did not change the figure (8.3 GB after
warm-up), Next reverts `devtool` changes in dev, and Turbopack bundles `@huggingface/transformers`
despite `serverExternalPackages`, so the dev server could not be slimmed in place.

## Fix

- **E2E runs against a production build.** Both E2E jobs (the shards and the PKI job) run
  `pnpm --filter @wayfinder/web build` and then `start`, instead of `dev`. A `next start` server holds
  ~200 MB, starts in under 2 s and has every route compiled before the first spec. The build costs
  about what the route warm-up did (3.4 min locally), and a shard now runs in 2–3 minutes instead of
  10–13.
- Removed with it, as dead code: `e2e/warm-routes.sh`, `e2e/warm-routes.txt`,
  `src/e2e-warm-routes.test.ts`, the `E2E_KEEP_ROUTES_COMPILED` branch of `next.config.ts`, and the
  `NODE_OPTIONS` heap ceilings.

The production server also stopped hiding three faults the stalls had masked:

- **Insights filters had no accessible name** (a WCAG 4.1.2 failure). The Date range, Filter on,
  Operator and Value controls on Admin → Insights showed their caption in a `<span>` that is not
  tied to the control, so a screen reader announced an unnamed select. Each now carries an
  `aria-label` matching its caption, as the Status filter beside them already did.
- **The flow editor audit was auditing Insights.** It clicked the first link on `/admin/flows` named
  like `/open|edit|flow/i`. Under `next start` the sidebar renders first, so that was the sidebar's
  Insights link. The spec now opens the seeded flow's editor directly and waits for the canvas.
- **The rate-limit burst met Better Auth's limiter first.** A production build turns on Better Auth's
  own sign-in limit (three tries per ten seconds), whose 429 carries only `X-Retry-After`. The spec
  now bursts until a 429 with the standard `Retry-After` answers, which only Wayfinder's limiter sends.
- **The sticky-link spec matched two indicators.** On a fast server the progress bar and the skeleton
  are up together, so `progressBar.or(skeleton)` was a strict-mode violation. It takes the first.

## Regression guard

- `accessibility.spec.ts` audits `/admin/dashboards/insights`. Against the build before the fix it
  failed with `select-name` on the two filters; after it, it passes.
- The full chromium project (3 shards) and the `pki` project pass locally against a production
  build: 160 passed, 1 skipped by design (`fix-session-upload-not-reaching-ai.spec.ts:35`, which
  needs real embeddings). `fix-sticky-link-navigation.spec.ts` passed three runs in a row.

## Known limitations

- The suite now tests production behaviour, which differs from `next dev` in a few places: React's
  dev-only warnings are absent, `/api/dev-login` is off, the API value-set lookup refuses localhost,
  and Better Auth's sign-in limit is on. No spec depended on the dev-only paths.
- A local `next dev` run still compiles routes on first use; `e2e/helpers/timeouts.ts` keeps its
  budgets for that case.
