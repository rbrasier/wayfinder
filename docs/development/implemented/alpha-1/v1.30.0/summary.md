# v1.30.0 — n8n Workflow Directory + Step-Context Field Values — Implementation Summary

- **Version bump**: **MINOR** (`1.29.2` → `1.30.0`) — new behaviour + domain port
  additions; no new table. n8n credentials reuse `admin_system_settings`; field
  value bindings ride the existing `app_flow_nodes.config` jsonb.
- **Phase doc**: `phase-n8n-workflow-context-mapping.md` (this directory).
- **Feature flags**: gated behind the existing `auto_node` / `scheduled_node`
  DB flags — existing flows behave exactly as before.

## What was built

Auto-node request fields and the scheduled-node fire time can now draw their
**value** from one of three sources — AI decides (default), an earlier step's
field, or a specific literal — and n8n auto nodes are configured by **picking a
workflow** from a directory fetched over the n8n REST API instead of typing a
webhook URL. The mock executor now produces an AI-generated response for
testing.

### Domain (`packages/domain`)
- `entities/field-value-source.ts` — `FieldValueSource` (`ai` | `step_field` |
  `literal`) and `PriorStepField`.
- `entities/n8n-workflow.ts` — `N8nWorkflowSummary`, `N8nTrigger`.
- `entities/flow-node.ts` — `AutoNodeConfig` gains `workflowId`,
  `requestFieldValues`; `ScheduledNodeConfig` gains `specSource`.
- `entities/runtime-config.ts` — `N8nConfig` + `N8N_CONFIG_SETTING_KEY`.
- `ports/n8n-workflow-directory.ts` — `IN8nWorkflowDirectory`.
- `ports/node-executor.ts` — `NodeExecutionInput.responseFields?`.
- `ports/session-step-output-repository.ts` — `listBySession`.

### Application (`packages/application`)
- `services/resolve-field-values.ts` — resolves `literal`/`step_field` directly
  and routes only `ai` fields to the model; exports `lookupStepField`.
- `use-cases/document/structured-fields.ts` — `extractStructuredFields` now
  accepts prior step outputs + insights as higher-priority context than the
  transcript (priority: step outputs → insights → transcript). Document
  generation prompt unchanged when these are absent.
- `use-cases/session/run-auto-node.ts` — uses the resolver, reads prior outputs
  via `listBySession`, passes `responseFields`, selects the executor by
  `config.executor` (`NodeExecutors` map), and returns the executor's data.
- `use-cases/scheduling/schedule-node-event.ts` — resolves `at`-kind `specSource`
  (literal/step-field directly; `ai` via a single-field extraction); injects an
  optional language model.

### Adapters (`packages/adapters`)
- `n8n/n8n-workflow-directory.ts` — `N8nHttpWorkflowDirectory`: paginated
  `GET /api/v1/workflows` with `X-N8N-API-KEY`; maps each workflow to
  `{ id, name, active, trigger, webhookUrl, inputs, outputs }` by convention
  (webhook trigger metadata; an `Inputs`/`Outputs` Edit-Fields `Set` node;
  `respondToWebhook` body fallback). Never throws on a malformed workflow.
- `node-executors/mock-node-executor.ts` — AI-generates a response shaped by
  `responseFields` using the configured chat model; echoes request fields when
  none are declared. `index.ts` exposes `createNodeExecutors`.
- `config/runtime-config-store.ts` — `getN8nConfig` / `invalidateN8n` /
  `redactN8n` (DB-over-env).
- `repositories/drizzle-session-step-output-repository.ts` — `listBySession`.

### Web (`apps/web`) + API
- `/admin/settings` — new **n8n Integration** card (base URL + API key, redacted,
  blank-key-keeps-stored) via `settings.getN8nConfig` / `setN8nConfig`.
- `server/routers/n8n.ts` — `n8n.listWorkflows` (admin) feeding the dropdown.
- `components/canvas/field-value-selector.tsx` — `FieldValueSelector`,
  `FieldValueList`, `ReadOnlyFieldList` + encode/decode helpers.
- `components/canvas/node-config-modal.tsx` — n8n executor shows a workflow
  dropdown (replacing the URL input), renders the selected workflow's
  inputs/outputs read-only, a per-request-field value selector, and the same
  selector on the scheduled `at` timestamp; **Add field** and the mock free-form
  path are retained.
- `flows/[id]/config/_content.tsx` and `admin/flows/[id]/_content.tsx` — compute
  topology-scoped `priorStepFields`, build/read the new config keys.
- `lib/container.ts` — wires `N8nHttpWorkflowDirectory`, the mock-model
  injection, `ApplyAutoNodeResult`, and `ScheduleNodeEvent`'s language model.
- chat stream `turn-helpers.ts` / `route.ts` — applies a synchronous (mock)
  completion inline so the session advances, and threads `specSource` context
  into the scheduled dispatch.

## Migrations run
- **None.** n8n credentials use the existing `admin_system_settings` KV table;
  field bindings and `workflowId` ride `app_flow_nodes.config` jsonb.

## Tests
- Tests-first per sub-component: `resolve-field-values.test.ts`,
  extended `run-auto-node.test.ts` and `schedule-node-event.test.ts`
  (application); `n8n-workflow-directory.test.ts`, rewritten
  `mock-node-executor.test.ts`, `runtime-config-store` n8n cases (adapters).
  `./validate.sh` passes (typecheck, lint, full unit suite, domain purity,
  table naming, version sync, coverage ≥ thresholds).
- **E2E**: `tests/e2e/enhance-n8n-workflow-context-mapping.spec.ts` — the admin
  n8n Integration settings card/dialog, and (behind `auto_node`) configuring an
  auto step with the Mock executor and binding a request field to a specific
  value. Skips gracefully when the surface/DB is unavailable, matching the
  suite's conventions.

## Known limitations / deferred
- **Input/output inference is convention-based.** Fields are read only from a
  webhook trigger + an `Inputs`/`Outputs` Edit-Fields `Set` node (or the
  `respondToWebhook` body); workflows without that convention surface empty
  lists and rely on **Add field**.
- **Triggering is unchanged** — selecting a workflow only sources its webhook
  URL; the signed-POST + async callback path is reused. `manual_or_scheduled`
  workflows have no webhook URL and are flagged as not auto-callable.
- **Single shared n8n instance** (no per-node credentials / multiple instances).
- **SSRF note**: the admin-authored base URL is a server-side fetch target —
  appropriate for an admin-only setting; revisit if non-admins gain access.
