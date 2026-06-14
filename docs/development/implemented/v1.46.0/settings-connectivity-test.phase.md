# Phase — Settings Connectivity Test

- **Status**: Drafted — awaiting `/doc-review`
- **Target version**: **MINOR** (1.45.0 → 1.46.0; new read-only feature, no schema change)
- **Depends on**: existing `admin_system_settings` config store, runtime config
  store, and the integration adapters (language-model, MinIO storage, email
  sender, n8n directory, embeddings, Microsoft Graph/Entra).

## 1. Goal

Give an admin immediate, on-demand confidence that each configured integration on
`/admin/settings` is **actually reachable with the saved credentials** — not merely
"set". Each applicable card gains a **Test connectivity** button; the page header
gains a **Test all** button that runs every applicable probe **in parallel** and
populates each card's result as it returns.

This extends the precedent already in the codebase: the Email card's existing
"Send test" action. We generalise that idea (a live probe behind an
`adminProcedure`) across all external-dependency cards, without sending real
artefacts or burning AI tokens.

## 2. Scope

### In scope — 6 cards with external dependencies

| Card | Probe (lightweight, live) |
|------|---------------------------|
| AI provider | Auth ping / list-models against the configured provider key. **No completion / token-generating call.** |
| Storage (MinIO/S3) | `bucketExists()` on the configured bucket. |
| Email (SMTP / M365) | SMTP `verify()` handshake, or M365 OAuth2 token acquisition. **No message sent.** |
| n8n | Authenticated `GET /api/v1/workflows?limit=1`. |
| RAG embeddings | local: model load/health probe; OpenAI: models auth ping. |
| Entra / Graph directory | Graph token acquisition + a scoped permission probe. |

### Out of scope — config-only cards

Organisation name, registration toggle, notification preferences, and session
upload limits have **no external dependency** and therefore get **no button**.

### Decisions captured from planning

- **Test depth**: *Lightweight checks* — cheapest possible live probe per service;
  explicitly avoid any token-generating AI calls or sending real emails.
- **Card scope**: All applicable external integrations **plus** the Entra/Graph
  directory card (currently a read-only info card; it gains a real probe).
- **Test all mode**: **Parallel** — fire all configured probes at once; results
  populate per-card as each resolves.

## 3. Approach & layering (per CLAUDE.md)

Mirrors the existing `CompositeHealthChecker` pattern (`packages/adapters/src/health/`).

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/connectivity.ts` (new) | `ConnectivityTarget` union (`"ai" \| "storage" \| "email" \| "n8n" \| "embeddings" \| "entra"`) and `ConnectivityResult` entity (`target`, `ok`, `latencyMs?`, `message?`, `skipped?`). Plain TypeScript, zero deps. |
| domain | `packages/domain/src/ports/connectivity-tester.ts` (new) | `IConnectivityTester` port: `test(target): Promise<Result<ConnectivityResult>>` and `testAll(): Promise<Result<ConnectivityResult[]>>`. Result pattern only. |
| domain | `packages/domain/src/index.ts` | Export the new entity + port from the barrel. |
| adapters | `packages/adapters/src/health/composite-connectivity-tester.ts` (new) | `CompositeConnectivityTester implements IConnectivityTester`. Holds references to the integration adapters / runtime config; dispatches per target; runs `testAll` with `Promise.all` (parallel). Catches all probe failures and maps them into a `ConnectivityResult` (never throws across the boundary). A target whose config is absent returns `skipped: true`. |
| adapters | language-model / minio-storage / email sender / n8n directory / embeddings / graph adapters | Add a narrow `testConnectivity(): Promise<Result<...>>` probe method to each (or a small per-adapter prober) implementing the lightweight probe from §2. Verify exact third-party API shapes in `node_modules` (MinIO `bucketExists`, Nodemailer `verify`, provider SDK list-models, Graph token) — do not rely on training data. |
| adapters | `packages/adapters/src/index.ts` | Export `CompositeConnectivityTester` from the barrel. |
| apps/web | `apps/web/src/lib/container.ts` | Instantiate `CompositeConnectivityTester` with the wired adapters + runtime config; expose as `container.connectivityTester`. |
| apps/web | `apps/web/src/server/routers/settings.ts` | Two `adminProcedure`s: `testConnectivity({ target })` and `testAllConnectivity`. Follow the existing `sendTestEmail` precedent — call the tester, map `result.error` via `toTrpcError`. |
| apps/web | `apps/web/src/app/(admin)/admin/settings/page.tsx` | Per-card **Test connectivity** button (shown only when the card is configured), a header **Test all** button, and a per-card status badge with four states: idle / testing (spinner) / ok (+latency) / failed (+message). Test-all fans out to per-card mutations in parallel. |

No application-layer use case is added: the established precedent for a live admin
probe (`sendTestEmail`) calls the adapter-backed service directly through the
container from tRPC. The new `IConnectivityTester` is a domain port wired in the
container the same way.

## 4. Database changes

**None.** Probes read the existing `admin_system_settings` config via the runtime
config store and hit live services. No new table, column, or migration.

## 5. Security / safety notes

- All procedures are `adminProcedure` (admin-only), matching the rest of
  `settings.ts`.
- Probes never return secret values — only `{ ok, latencyMs?, message? }`. The
  `message` on failure must be a sanitised, human-readable reason (e.g.
  "401 Unauthorized", "ENOTFOUND host"), never the raw credential or full stack.
- No artefacts are produced: no email is sent, no object is written to storage,
  no chat completion is requested.
- Probes use a bounded timeout so a hung endpoint cannot stall the request
  (especially under parallel "Test all").

## 6. Implementation order (tests first)

1. domain `ConnectivityResult` / `ConnectivityTarget` + `IConnectivityTester`
   (type-level; exported from barrel).
2. Per-adapter `testConnectivity()` probes — write the test file first for each,
   then implement (mock the third-party client; assert ok/fail mapping + timeout).
3. `CompositeConnectivityTester` — test dispatch, `skipped` for unconfigured
   targets, parallel `testAll`, error-to-result mapping; then implement.
4. Container wiring + tRPC `testConnectivity` / `testAllConnectivity` procedures.
5. `settings/page.tsx` per-card buttons, header Test-all, status badges.
6. Playwright e2e (§7).
7. `./validate.sh` after each sub-component; bump `VERSION` + root
   `package.json` to `1.46.0`.

## 7. E2E coverage

`apps/web/e2e/enhance-settings-connectivity.spec.ts`:

- Signs in as admin, opens `/admin/settings`.
- Exercises a per-card **Test connectivity** button and asserts the result badge
  transitions to a terminal state (ok or failed) with the latency/message shown.
- Exercises **Test all** and asserts every applicable card resolves to a terminal
  badge state in parallel.

## 8. Risks / open questions

- **Live probes in CI/e2e**: external services may be unavailable in the sandbox.
  The e2e asserts the *button → terminal badge* contract (ok **or** failed), not a
  specific service being reachable, so it is deterministic regardless of network.
- **Provider probe cost/shape**: the AI/embeddings auth ping must use a
  zero/near-zero-cost endpoint (list models) — confirm the exact SDK call per
  provider in `node_modules` before implementing.
- **Timeout tuning**: pick a bound (e.g. a few seconds) short enough for a snappy
  "Test all" but long enough for a real handshake; revisit if flaky.

## 9. Acceptance criteria

- [ ] Each of the 6 external-dependency cards shows a **Test connectivity** button
      when configured; config-only cards show none.
- [ ] A header **Test all** button runs every applicable probe **in parallel**,
      with results populating per-card as they resolve.
- [ ] Each probe performs a **lightweight live check** — no email sent, no object
      written, no token-generating AI call.
- [ ] Failures surface a sanitised reason and never leak secret values.
- [ ] All cross-boundary calls use the Result pattern; nothing throws across a
      package boundary.
- [ ] No DB schema change.
- [ ] Playwright e2e (`enhance-settings-connectivity.spec.ts`) passes.
- [ ] `VERSION` and root `package.json#version` both read `1.46.0` and
      `./validate.sh` passes.
