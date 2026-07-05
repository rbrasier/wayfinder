# Phase — Node Configuration Improvements

- **Status**: Awaiting review
- **Target version**: 1.33.0  (bump: MINOR — new authoring behaviour, no schema change; all node config rides the `app_flow_nodes.config` jsonb)
- **Depends on**: existing flow/node config (jsonb), n8n workflow directory
  (`IN8nWorkflowDirectory`), field value sources (`FieldValueSource`,
  `PriorStepField`), schedule engine (`ScheduleNodeEvent`, `computeNextFireAt`)

## 1. Problem

Node configuration has several rough edges:

- n8n **expected outputs** are inferred from only two conventions (a Set node
  named "Output(s)" or a RespondToWebhook node); **expected inputs** from only a
  Set node named "Input(s)" or the first Set node. Workflows that express their
  schema another way (pinned data, `$json` references, or only via past
  executions) surface nothing, with no explanation to the author.
- The cross-step **data-selection** control is a flat three-option dropdown
  (`ai` / one "earlier step" group / `literal`). It lacks a "No value" choice and
  does not group available variables by step.
- The config **modal is narrow** (`max-w-md`), too cramped for a field-on-left /
  value-on-right request-field layout.
- The scheduled node exposes **recurrence** authoring (complex recurring loops),
  which we are deliberately disabling to keep flow execution predictable. Its
  "When should this run?" control is also low-level (raw `relative`/`at`/cron
  inputs) rather than a guided sentence.
- When a flow is edited so a previously-referenced prior-step field (in a request
  field binding or a schedule anchor) **no longer exists**, nothing warns the
  author.

## 2. Goals

1. **n8n expected outputs** — extract via a 4-method fallback chain (auto):
   ① Set node "Output(s)" ② RespondToWebhook ③ `pinData` on the last node
   ④ most-recent execution output of the last node. If no method yields anything
   and the workflow has never run, show a small message with a **"More info"**
   dialog explaining how outputs are understood.
2. **n8n expected inputs** — extract via a 4-method fallback chain (auto):
   ① Set node "Input(s)" ② `pinData` on the trigger node ③ `$json.<key>`
   expression scan across all nodes ④ execution history. If no inputs are found,
   show a "no inputs found" message with the same **"More info"** dialog
   (parameterised for inputs).
3. **Wider modal** to accommodate the request-field rows.
4. **Data-selection dropdown** with grouped options:
   A "AI decides (or asks the user)", B contextual per-step variables (step name +
   number as non-selectable category headers; items read
   `{Step#} {StepName} — {Variable} ({type})`), C "Type anything" (free text),
   D "No value".
   - **4.1 Expected outputs (read-only)** shown *below* the request-fields block;
     still persisted as step outputs (unchanged). Never-run/empty case shows the
     §1 message + "More info".
   - **4.2 Add request fields** — each extracted input field on the left
     (non-removable) with the §4 dropdown on the right; a bottom **"+ Add field"**
     row lets the author add custom key/value pairs (value uses the same dropdown,
     **X** to remove). Each field defaults to **"AI decides"**.
5. **Remove scheduler recurrence** authoring (UI removed; domain enum/compute
   retained for back-compat rendering of existing schedules).
6. **Scheduled "When should this run?"** becomes three options: "AI Decides (or
   asks the user)", "Pick a date and time", "Type anything".
   - **6.2 Pick a date and time** uses an inline mad-lib sentence builder:
     `[Number] [Unit ▼] [Modifier ▼] [Anchor ▼]`. Selecting modifier **On** hides
     Number + Unit. Anchor options: "This step reached", "Flow started", and any
     prior-step field (§4B).
   - **6.3 Type anything** reveals a free-text box describing how the date should
     be calculated, resolved by AI at runtime.
7. **Stale-reference warning**: if a flow edit invalidates a selected anchor (6.2)
   or request-field binding (4.2), show a warning label at the bottom of the
   canvas.

## 3. Non-goals

- No DB schema change (the `app_session_schedules.kind` enum already covers
  `relative`/`at`; new anchors live in jsonb config).
- No removal of the legacy `recurrence`/`cron` compute paths — only the authoring
  UI is withdrawn.
- No change to how step outputs are persisted or coerced.

## 4. Approach

Build strictly bottom-up (domain → application → adapters → web), writing the
test file before each implementation file (CLAUDE.md). Everything rides the node
`config` jsonb; no migration. The costly n8n execution-history methods run
**lazily and automatically** only when the cheaper (free) methods yield nothing
for the *selected* workflow, via a new `getWorkflowSchema(workflowId)` port
method — `listWorkflows` keeps using only the free methods so the dropdown stays
cheap.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/field-value-source.ts` | add `{ kind: "none" }` to `FieldValueSource`; extend `PriorStepField` with `stepNumber: number` and `stepName: string` (keep `stepLabel` for back-compat) |
| domain | `packages/domain/src/entities/session-schedule.ts` | extend `ScheduleAnchor` with `"flow_started"` and `"step_field"` |
| domain | `packages/domain/src/entities/flow-node.ts` | `ScheduledNodeConfig`: add `anchorSource?: FieldValueSource` (for `step_field` anchor), `relativeDirection?: "after" \| "before"`, `describeText?: string \| null` (for "Type anything"); `AutoNodeConfig`: add `customRequestFieldKeys?: string[]` (author-added, removable) |
| domain | `packages/domain/src/entities/n8n-workflow.ts` | add `N8nWorkflowSchema { inputs; outputs; inputsMethod; outputsMethod; hasExecutions }` with method enums (`"set"\|"pin"\|"expression"\|"respond"\|"execution"\|"none"`) |
| domain | `packages/domain/src/ports/n8n-workflow-directory.ts` | add `getWorkflowSchema(workflowId: string): Promise<Result<N8nWorkflowSchema>>` |
| application | `packages/application/src/services/resolve-field-values.ts` | handle `{ kind: "none" }` → omit the field (blank) |
| application | `packages/application/src/use-cases/scheduling/schedule-node-event.ts` | `resolveAnchor`: support `flow_started` (session start time) and `step_field` (`anchorSource` via `lookupStepField`, parsed as date); thread author `describeText` into `resolveAiSpec`; apply `relativeDirection` |
| application | `packages/application/src/use-cases/scheduling/compute-next-fire.ts` | `ComputeNextFireInput`: add `direction?: "after" \| "before"`; subtract duration for `before` on the `relative` kind |
| adapters | `packages/adapters/src/n8n/n8n-workflow-directory.ts` | parse `connections` + `pinData`; add terminal-node + trigger-node resolution; implement `getWorkflowSchema` fallback chain incl. pinData, `$json` expression scan, and a new executions-API fetch helper |
| adapters | `packages/adapters/src/n8n/n8n-execution-client.ts` *(new)* | `GET /api/v1/executions?workflowId=…&includeData=true` → last execution `runData` for a node; returns `hasExecutions` |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | `max-w-md` → `max-w-3xl`; rework auto-node section (request fields list + "+ Add field"; read-only outputs below; never-run/no-inputs messages + "More info"); replace schedule section ("When should this run?" 3-way + mad-lib; remove recurrence UI) |
| web | `apps/web/src/components/canvas/field-value-selector.tsx` | grouped dropdown (A/B/C/D); per-step non-selectable optgroups; "No value" + "Type anything"; encode/decode `none` |
| web | `apps/web/src/components/canvas/schedule-sentence-builder.tsx` *(new)* | the `[Number][Unit][Modifier][Anchor]` mad-lib row; `On` hides Number+Unit |
| web | `apps/web/src/components/canvas/n8n-extraction-info-dialog.tsx` *(new)* | "More info" dialog explaining the 4 methods, parameterised inputs vs outputs |
| web | `apps/web/src/components/canvas/scheduled-node-config.ts` | config ↔ values mapping for the new 3-way / mad-lib / describe shapes; drop recurrence authoring path |
| web | `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` | extend `priorStepFields` with step number/name/type; lazily fetch `getWorkflowSchema` on workflow select; compute stale references; render canvas warning banner |
| web | `apps/web/src/server/routers/*` (n8n router) | add `getWorkflowSchema` query wrapping the port |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types.** Add `none` to `FieldValueSource`; extend `PriorStepField`,
   `ScheduleAnchor`, `ScheduledNodeConfig`, `AutoNodeConfig`; add
   `N8nWorkflowSchema` + the port method. Update any exhaustive switches/guards
   over `FieldValueSource` and `ScheduleAnchor`.

2. **Application — field resolution.** `resolve-field-values.test.ts` first:
   `none` source yields an omitted/blank value and never calls the model; existing
   `ai`/`literal`/`step_field` behaviour unchanged. Implement.

3. **Application — schedule anchors & direction.** `compute-next-fire.test.ts`:
   `relative` + `direction: "before"` subtracts; `after`/absent unchanged.
   `schedule-node-event.test.ts`: `flow_started` anchors to session start;
   `step_field` anchor resolves a prior-step date (and fails safely via Result
   when missing/unparseable); `describeText` is threaded into the AI spec
   instruction. Implement.

4. **Adapters — n8n extraction.** `n8n-workflow-directory.test.ts` +
   `n8n-execution-client.test.ts`: each output method (set → respond → pin →
   execution) and input method (set → pin → expression → execution) in priority
   order, fallthrough, and `hasExecutions` / `method = "none"` signalling.
   Implement `getWorkflowSchema`, the `connections`/`pinData`/`$json` parsing, and
   the executions fetch (free methods first; execution call only on empty).

5. **Web — tRPC.** Add the `getWorkflowSchema` query; cover with the router test
   style already in the repo.

6. **Web — field-value selector.** Grouped dropdown with A/B/C/D, per-step
   optgroups, `none` encode/decode, "Type anything" free-text. Component/unit
   test for encode/decode round-trips.

7. **Web — modal & schedule builder.** Widen to `max-w-3xl`; request-fields list
   (extracted left + dropdown right, non-removable) and "+ Add field" custom rows;
   read-only outputs below with never-run/no-inputs messages + "More info" dialog;
   replace schedule section with the 3-way selector + `schedule-sentence-builder`
   (mad-lib, `On` hides number/unit); remove recurrence authoring. Update
   `scheduled-node-config.ts` mapping. Keep `Save`-disabled validation coherent.

8. **Web — canvas.** Extend `priorStepFields` (step number/name/type); lazy
   `getWorkflowSchema` on workflow select; compute stale anchor/request-field
   references and render the bottom-of-canvas warning banner.

9. **e2e.** `apps/web/e2e/enhance-node-config-improvements.spec.ts`: configure an
   auto node — confirm the wider modal, extracted request fields with the grouped
   value dropdown ("AI decides" default, "Type anything", "No value"), read-only
   outputs section; then a scheduled node — confirm the mad-lib sentence builder
   (number/unit/modifier/anchor, `On` hiding number+unit) and the absence of
   recurrence. Must pass against the updated code.

10. **Version + validate + ship.** Bump `VERSION` and `package.json#version` to
    `1.33.0`. Run `./validate.sh`; fix all failures. Move this doc to
    `docs/development/implemented/v1.33.0/` with an implementation summary (note
    the e2e file). Commit, push, open a PR.

## 7. Acceptance criteria

- [ ] n8n outputs resolve via the 4-method chain; never-run/empty shows the
      message + "More info" dialog.
- [ ] n8n inputs resolve via the 4-method chain; empty shows the message +
      "More info" dialog.
- [ ] Execution-history methods fire only when free methods yield nothing, lazily
      per selected workflow.
- [ ] Modal is visibly wider (`max-w-3xl`).
- [ ] Data-selection dropdown shows groups A/B/C/D; B groups variables by step
      with non-selectable headers reading `{Step#} {StepName} — {Variable} ({type})`.
- [ ] 4.1 outputs render read-only below request fields and still persist as step
      outputs.
- [ ] 4.2 extracted fields are non-removable with a value dropdown; custom fields
      add/remove via "+ Add field"/"X"; default is "AI decides".
- [ ] Recurrence authoring is gone from the scheduled node; legacy schedules still
      render.
- [ ] "When should this run?" offers the three options; "Pick a date and time"
      uses the mad-lib (`On` hides number/unit); anchors include "This step
      reached", "Flow started", and prior-step fields; "Type anything" reveals a
      free-text box resolved by AI.
- [ ] A stale anchor or request-field reference shows a warning at the bottom of
      the canvas.
- [ ] Architecture boundaries intact (domain dependency-free; Result pattern at
      boundaries); `VERSION` = `package.json#version` = `1.33.0`; `./validate.sh`
      passes; the e2e test passes.

## 8. Risks / open questions

- **Execution-history cost & permissions.** The n8n executions API may be
  disabled or rate-limited; treat failures as a soft "no schema found" (Result),
  never a throw, and fall through to the "none" message.
- **`$json` expression scan fragility.** Heuristic key extraction can over- or
  under-collect; scope it to obvious `$json.<key>` / `$json["key"]` forms and
  de-duplicate, accepting best-effort.
- **Terminal/trigger node resolution** relies on `connections`; workflows with
  multiple sinks pick the deepest reachable node — document the heuristic.
- **Stale-reference detection** must compare against the *current* flow graph and
  the selected workflow's live schema; ensure it does not false-positive while a
  workflow schema is still loading.
- **"Type anything" schedule** depends on a configured language model at fire
  time; fail safely (Result) when absent.
