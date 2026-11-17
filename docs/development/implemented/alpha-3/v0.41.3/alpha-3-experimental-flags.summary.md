# Implementation Summary — alpha-3 experimental features behind default-off flags

- **Version**: 0.41.2 → 0.41.3 (PATCH; no schema change, no migration)
- **Phase doc**: [`alpha-3-experimental-flags.phase.md`](./alpha-3-experimental-flags.phase.md)
- **Source**: maintainer request, no issue

## What changed

Five capabilities built after alpha-2 now sit behind feature flags that default **off**. Each
appears in Admin → Feature flags with a description, and none has a seeded row, so a fresh or
upgraded install shows them off until an admin enables them.

| Flag | UI hidden when off | Server refusal when off |
|---|---|---|
| `flow_memory` | Flow memory panel and reopen affordance | `flowMemory.*` FORBIDDEN; accepted lessons not injected into the step prompt; API memory sweep is a successful no-op |
| `flow_test_runs` | Header **Test**, step editor **Test** | `flowTest.*` FORBIDDEN |
| `view_as_user` | Sidebar "View as user" | `/api/impersonation/start` 403 (stop and extend stay open) |
| `flow_portability` | Header **Export**, admin **Import Flow**, row Duplicate/Export | `/api/flows/[id]/export`, `/api/flows/import` 403; `flow.duplicate` FORBIDDEN |
| `lookup_sources` | Admin settings Lookup sources card | Admin lookup-source procedures FORBIDDEN; operator `search`/`match` stay open |

**Triggers**: the flow editor's Triggers button shows only to an admin or a holder of
`flow:webhook_trigger` ("Start flows via webhook"); `automation.flowTriggers`,
`setTriggerInputs` and `webhookRuns` refuse anyone else. The webhook panel inside the dialog is
now always shown, since everyone who can open the dialog may manage the webhook — the
`canManageWebhook` response field became redundant and was removed.

Authoring flags (`flow_memory`, `flow_test_runs`, `flow_portability`) honour role scoping through
`IsFeatureEnabledForUser`. Prompt injection and the background sweep read `flow_memory` globally
(the lessons are the author's; whoever runs the flow sees the same prompt). `view_as_user` is read
globally; `lookup_sources` is an admin-surface flag (ADR-066 §5).

## Files

| File | Change |
|---|---|
| `packages/application/src/use-cases/get-feature-flag.ts` | `EXPERIMENTAL_FEATURE_FLAGS` + off-by-default listing |
| `packages/application/src/use-cases/memory/flag-gated-flow-memory-sweep.ts` | New — sweep runs only while `flow_memory` is on |
| `apps/api/src/container.ts` | Worker wraps the sweep in the flag gate |
| `apps/web/src/server/feature-gates.ts` | New — `requireFeatureForCaller`, `featureProcedure` |
| `apps/web/src/lib/feature-gate-response.ts` | New — 403 helper for route handlers |
| `apps/web/src/server/admin-surface-flags.ts` | `lookup_sources` added |
| `apps/web/src/server/routers/{flow-memory,flow-test,flow,lookup-source,automation}.ts` | Server gates |
| `apps/web/src/app/api/flows/{[id]/export,import}/route.ts`, `api/impersonation/start/route.ts` | Route gates |
| `apps/web/src/app/api/chat/[sessionId]/stream/flow-memory-lessons.ts` | New — lessons injected only while `flow_memory` is on |
| `apps/web/src/app/(user)/flows/[id]/config/_use-flow-header-gates.ts` | New — header visibility |
| `_flow-config-header.tsx`, `_use-step-feature-flags.ts`, `_use-flow-memory-panel.ts`, `_canvas-region.tsx`, `_content.tsx` | UI gating (`isPublished` → `showsMemory`) |
| `apps/web/src/components/sidebar.tsx`, `admin/flows/_content.tsx`, `admin/settings/_content.tsx`, `automation/flow-triggers-button.tsx` | UI gating |
| `apps/web/src/lib/e2e-fixtures.ts` | E2E seed enables the five flags |

## Tests

New: `feature-gates.test.ts`, `flow-memory.test.ts` (router), `automation.test.ts` (router),
`flow-memory-lessons.test.ts`, `flag-gated-flow-memory-sweep.test.ts`. Amended:
`get-feature-flag.test.ts`, `flow-test.test.ts`, `flow-portability.test.ts`,
`oversight-main-surfaces.test.ts`, `lookup-source.test.ts`, export and import route tests,
impersonation route tests.

**E2E**: no new spec — the gates are covered at the router, route and use-case layers. Existing
specs keep exercising the features because the e2e seed switches the five flags on; Triggers specs
run as admin.

## Known limitations

- An alpha-3 deployment already using these features loses them on upgrade until an admin turns
  the flags on — release notes must say so.
- Users without `flow:webhook_trigger` can no longer edit a flow's trigger inputs.
- Lookup sources registered while the flag was on keep resolving at runtime after it is switched off.
- A memory sweep skipped while the flag is off advances its window, so turning the flag on later
  does not capture sessions that finished while it was off.

## Deviations

- Branch/PR per `/enhance` (`enhance/…` → PR to `release/alpha-3`) rather than pushing straight to
  `release/alpha-3`, as approved.
- `/doc-review` was not run as a separate skill; the approved change summary served as the review
  gate for this small, schema-free change.
- Beyond the approved summary: the flow memory sweep is gated in the application layer
  (`FlagGatedFlowMemorySweep`) rather than in the worker adapter, and the redundant
  `canManageWebhook` field was removed.
