# Implementation Summary — Node Configuration Improvements (v1.33.0)

## What & Why

Several rough edges in node configuration were smoothed:

- **n8n schema extraction** now follows full fallback chains for both inputs and
  outputs, including pinned data, a `$json` expression scan, and (lazily) the
  most recent execution. When nothing is found, the author gets a clear message
  and a "More info" dialog explaining how the schema is understood.
- The cross-step **value selector** is now a grouped dropdown — AI decides /
  per-step variables / Type anything / No value — replacing the flat list.
- The config **modal** is wider (`max-w-3xl`) to fit field-on-left /
  value-on-right rows, and auto-node request fields are authored as a list with
  a "+ Add field" row; expected outputs render read-only beneath them.
- **Scheduler recurrence authoring** is withdrawn (the runtime/compute paths and
  legacy rendering remain). "When should this run?" is now three options — AI
  decides, Pick a date and time (a `[Number][Unit][Modifier][Anchor]` mad-lib),
  and Type anything (AI-resolved free text).
- A **stale-reference warning** appears at the bottom of the canvas when a step
  binds a value or schedule anchor to a prior-step field that no longer exists.

Everything rides the existing `app_flow_nodes.config` jsonb — **no DB migration**.

## Version Bump

**MINOR — 1.32.0 → 1.33.0.** New authoring behaviour, no schema change.

## Files Created

| File | Purpose |
|------|---------|
| `packages/adapters/src/n8n/n8n-execution-client.ts` | Fetches the latest execution's per-node JSON output; reports `hasExecutions`. |
| `packages/adapters/src/n8n/n8n-execution-client.test.ts` | Tests for the execution client. |
| `apps/web/src/components/canvas/schedule-sentence-builder.tsx` | The `[Number][Unit][Modifier][Anchor]` mad-lib row; "on" hides number+unit. |
| `apps/web/src/components/canvas/n8n-extraction-info-dialog.tsx` | "More info" dialog explaining the 4 methods, parameterised inputs vs outputs. |
| `apps/web/src/components/canvas/field-value-selector.test.ts` | Encode/decode round-trips + step grouping. |
| `tests/e2e/enhance-node-config-improvements.spec.ts` | e2e for the wider modal, grouped dropdown, outputs section, and mad-lib scheduler. |
| `docs/development/implemented/v1.33.0/summary.md` | This summary. |

## Files Modified

| File | Change |
|------|--------|
| `packages/domain/src/entities/field-value-source.ts` | Added `{ kind: "none" }`; extended `PriorStepField` with `stepNumber`/`stepName`. |
| `packages/domain/src/entities/session-schedule.ts` | Extended `ScheduleAnchor` with `flow_started` and `step_field`. |
| `packages/domain/src/entities/flow-node.ts` | `ScheduledNodeConfig`: `anchorSource`, `relativeDirection`, `describeText`; `AutoNodeConfig`: `customRequestFieldKeys`. |
| `packages/domain/src/entities/n8n-workflow.ts` | Added `N8nWorkflowSchema` + `N8nSchemaMethod`. |
| `packages/domain/src/ports/n8n-workflow-directory.ts` | Added `getWorkflowSchema(workflowId)`. |
| `packages/application/src/services/resolve-field-values.ts` | `none` source omits the field; never calls the model. |
| `packages/application/src/use-cases/scheduling/compute-next-fire.ts` | `direction: "before"` subtracts the relative duration. |
| `packages/application/src/use-cases/scheduling/schedule-node-event.ts` | `flow_started`/`step_field` anchors; `relativeDirection`; `describeText` threaded into the AI spec; `none` specSource. |
| `packages/adapters/src/n8n/n8n-workflow-directory.ts` | `getWorkflowSchema` fallback chains; connections/pinData parsing; trigger/terminal resolution; `$json` scan; lazy execution call. |
| `apps/web/src/server/routers/n8n.ts` | Added the `getWorkflowSchema` query. |
| `apps/web/src/components/canvas/field-value-selector.tsx` | Grouped A/B/C/D dropdown; `none` encode/decode; removable custom rows. |
| `apps/web/src/components/canvas/scheduled-node-config.ts` | New 3-way / mad-lib / describe mapping; anchor choice encode/decode; recurrence authoring removed. |
| `apps/web/src/components/canvas/node-config-modal.tsx` | `max-w-3xl`; reworked auto + schedule sections; info dialogs; recurrence/calendar UI removed. |
| `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` | `priorStepFields` with step number/name; stale-reference banner; persist `customRequestFieldKeys`. |
| `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` | Same canvas changes as the user editor. |
| `tests/e2e/phase-scheduling.spec.ts` | Updated to the mad-lib builder and the describe-mode validation. |
| `tests/e2e/enhance-n8n-workflow-context-mapping.spec.ts` | Updated to the new value-dropdown labels/placeholder. |
| `VERSION`, `package.json` | Bumped to `1.33.0`. |

## Files Removed

- `tests/e2e/enhance-scheduled-step-plain-language.spec.ts` — its premise
  (recurrence authoring) was withdrawn by this phase.

## Tests

- Unit/integration: domain, application, adapters and web suites all pass
  (`pnpm test`). New tests cover the `none` source, the schedule direction and
  anchors, the n8n execution client, the `getWorkflowSchema` fallback chains, and
  the field-value-selector encode/decode + grouping.
- e2e (`tests/e2e/enhance-node-config-improvements.spec.ts`): the auto-node block
  asserts the wider modal, the grouped value dropdown (AI default, "Type
  anything", "No value") and the outputs section; the scheduled-node block
  asserts the three "when" options, the mad-lib builder ("on" hiding number+unit)
  and the absence of recurrence. The e2e suite requires the full stack
  (Postgres/Redis/MinIO + a running app) and was not executed in the build
  sandbox.

## Known Limitations / Scoping

- **Stale-reference detection** is scoped to prior-step-field bindings (request
  field values and schedule anchors) checked against the live flow graph. It does
  not re-fetch every workflow's n8n schema, which avoids false positives while a
  schema is still loading.
- **Legacy `at` schedules** with a literal date or step-field spec open as "AI
  decides"; legacy recurrence/cron rows open in the mad-lib builder with defaults
  (re-saving converts them). Their runtime compute paths and canvas rendering are
  unchanged.
- Auto-node **custom request fields** authored before this phase (without
  `customRequestFieldKeys`) are not separated from workflow inputs when re-opened;
  new saves record the keys explicitly.
