# Phase — Put alpha-3's experimental features behind default-off flags

- **Status**: Implemented (v0.41.3) — see `alpha-3-experimental-flags.summary.md`
- **Type**: Enhancement
- **Target version**: 0.41.3 (bump: **PATCH** — base is `release/alpha-3`; no schema change)
- **Base branch**: `release/alpha-3`
- **Source issue**: none (maintainer request)
- **ADRs**: ADR-022 (feature flags and role scoping), ADR-041 §4 (automation flags default off),
  ADR-066 §5 (admin-surface flags), ADR-064 §3 (webhook-trigger permission)

## 1. Problem

alpha-3 carries several capabilities that were built on `main` after alpha-2 and are still
experimental. They are visible to every eligible user from the moment a deployment upgrades. A
deployment should get a conservative surface by default and switch the experiments on deliberately.
Separately, the flow editor's **Triggers** button is shown to every flow editor although it governs
webhook starts, which the `flow:webhook_trigger` permission ("Start flows via webhook") exists to
control.

## 2. Approved change summary

Five alpha-3 features move behind new feature flags that default **off**: Flow memory, flow test
runs, Admin "View as user", flow export/import/duplicate, and external lookup sources. Each is
switched on from Admin → Feature flags by a Technical Admin. Separately, the flow editor's **Triggers**
button and its endpoints now require the "Start flows via webhook" permission (admins always pass).
No database change — a flag without a persisted row already reads as off — so this ships as a PATCH on
`release/alpha-3`.

### Business rules changing

| Flag | Kind | When off |
|---|---|---|
| `flow_memory` | authoring (role-scopable) | Panel and reopen affordance hidden; `flowMemory.*` FORBIDDEN; accepted lessons not injected into the step prompt; memory worker tick skips |
| `flow_test_runs` | authoring (role-scopable) | Header **Test** and per-step **Test** hidden; `flowTest.start` FORBIDDEN |
| `view_as_user` | global | Sidebar "View as user" hidden; `/api/impersonation/start` 403. Stop/extend stay open |
| `flow_portability` | authoring (role-scopable) | Header **Export**, admin **Import**, row **Duplicate** hidden; export/import routes and `flow.duplicate` refuse |
| `lookup_sources` | admin surface (ADR-066 §5) | Admin Lookup sources card hidden; admin lookup-source procedures FORBIDDEN. Runtime resolution of existing sources is unchanged |

- **Triggers**: without admin or `flow:webhook_trigger`, the Triggers button is hidden and
  `automation.flowTriggers`, `setTriggerInputs`, `webhookRuns` return FORBIDDEN.

### Database & migration impact

None. Defaults live in `DEFAULT_FEATURE_FLAGS` (listed, off). No migration.

### Risks

- An alpha-3 deployment already using these features loses them on upgrade until an admin enables
  the flags — call out in release notes.
- Users without the webhook permission can no longer edit trigger inputs (accepted).
- E2E specs exercising these features need the flags on: the seed fixture enables them.

### Out of scope

Off-system approval; disabling runtime lookup-source resolution; changing the
`FLOW_MEMORY_ENABLED` env gate.

## 3. Build plan

1. `get-feature-flag.ts` — list the five keys in `DEFAULT_FEATURE_FLAGS` (off). Test first.
2. A shared server helper `requireFeatureForUser(ctx, key)` in the web app used by tRPC routers;
   route handlers check `isFeatureEnabledForUser` / `isFeatureEnabled` directly.
3. Gate each surface (UI + server) per the table.
4. `lookup_sources` joins `ADMIN_SURFACE_FLAGS`.
5. Lesson injection: the chat stream route drops accepted lessons when `flow_memory` is off.
6. API memory worker: the sweep is wrapped so the tick is a no-op while the flag is off.
7. E2E seed fixture enables the five flags.
