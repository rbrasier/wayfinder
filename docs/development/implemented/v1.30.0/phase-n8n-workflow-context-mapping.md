# Phase — n8n Workflow Directory + Step-Context Field Values

- **Status**: Awaiting review
- **Target version**: 1.30.0  (bump: **MINOR** — new behaviour + port additions;
  no new table. n8n instance settings reuse `admin_system_settings`; field value
  bindings ride the existing `app_flow_nodes.config` jsonb.)
- **PRD**: _none — this phase doc is the spec; promote to a PRD only if scope grows._
- **Depends on**: the auto-node / n8n executor (v1.18 phase, `INodeExecutor`,
  `RunAutoNode`, `ApplyAutoNodeResult`, signed webhook + callback), the scheduled
  node engine (v1.26, `ScheduleNodeEvent`), the docx structured-data primitives
  (`TemplateField`, `extractStructuredFields`, `coerceStructuredFields`,
  `StepOutputField`, `session_step_outputs`), the admin settings KV store
  (`admin_system_settings` + `RuntimeConfigStore`), and the `auto_node` /
  `scheduled_node` feature flags.

## 1. Problem

Two gaps in the current auto/scheduled node experience:

1. **No reuse of earlier-step data.** Request fields sent to n8n (and the
   scheduled fire time) can only be AI-extracted from the transcript. A flow
   author cannot say "use the *Contract Value* captured in step 3" or "fire at
   the *Approved At* date from step 4", nor pin a literal value.
2. **n8n is wired by hand-typed webhook URL.** The author pastes a webhook URL
   and re-declares request/response fields from scratch, with no connection to
   the workflows that actually exist in their n8n instance, and no shared place
   to hold n8n credentials.

This phase connects Wayfinder to the n8n REST API so authors pick a workflow
from a dropdown (its inputs/outputs surfaced read-only), and lets every auto
request field and the scheduled timestamp draw its **value** from one of: AI
decides, an earlier step's field, or a specific literal. The clean
`TemplateFieldEditor` / node-config-modal UX is retained.

## 2. Goals

- **Admin n8n settings**: configure an n8n instance (base URL + API key) in a
  card on `/admin/settings`, stored and redacted like the AI / Storage cards.
- **Workflow directory**: fetch all workflows from the n8n REST API and map each
  to a clean `{ id, name, active, trigger, webhookUrl, inputs[], outputs[] }`
  summary, inferring inputs/outputs by convention.
- **Workflow picker**: the n8n auto-node config replaces the webhook-URL input
  with a workflow dropdown; the selected workflow's inputs/outputs render
  **read-only**; the **Add field** button still adds extra request fields.
- **Per-field value source** on auto request fields and the scheduled `at`
  timestamp: `AI decides or asks` (default) / an earlier step's field / a
  specific value. "Earlier step's field" is a dynamic, topology-scoped list of
  fields declared by prior nodes.
- **AI-decides priority**: when resolving an `ai` field, context priority is
  `session_step_outputs` → accumulated insights → transcript.
- **Mock executor** stays for testing: free-form request fields/values + response
  fields, with the response **AI-generated** using the configured chat model.
- All new behaviour stays behind the existing `auto_node` / `scheduled_node`
  flags. Existing flows with a hand-typed `webhookUrl` and no value bindings
  behave exactly as today (defaults to `ai`).

## 3. Non-goals

- Auto-discovering body field schemas n8n does not declare. Inputs/outputs come
  only from a **convention** (a `Set`/Edit-Fields node, or the
  `respondToWebhook` body) + trigger metadata; absent ⇒ empty, author uses
  **Add field**.
- Triggering workflows via the REST execution API. We keep the existing
  signed-POST-to-webhook + async callback; the picked workflow only **sources**
  the webhook URL.
- Per-node n8n credentials, OAuth, or multiple n8n instances (single shared
  instance config this phase).
- A model-chosen relative/cron schedule (value source applies to the `at`
  timestamp only).

## 4. Approach

Build strictly bottom-up (domain → application → adapters → web), test file
before implementation file (CLAUDE.md rule). Field bindings and `workflowId`
ride the node `config` jsonb (no migration); n8n credentials ride
`admin_system_settings` (no migration). The only structural additions are
domain ports/types and a `listBySession` read on the step-output repository.

### n8n inference convention (adapter)

For each workflow's `nodes` array:

- **Trigger**: a `n8n-nodes-base.webhook` node → `{ method: parameters.httpMethod
  ?? "GET", path: parameters.path, auth: parameters.authentication }` and
  `webhookUrl = "{baseUrl}/webhook/{path}"`. A `manualTrigger` / `scheduleTrigger`
  → trigger `"manual_or_scheduled"`, no `webhookUrl` (workflow not selectable for
  n8n dispatch, or selectable with a manual URL fallback — see step 7).
- **Inputs**: the first `n8n-nodes-base.set` node named `Inputs` (case-insensitive)
  if present, else the first `Set` node wired after the trigger. Its
  `parameters.assignments.assignments[]` (each `{ name, type }`) map to
  `TemplateField` via `name → label`, `type → TemplateFieldType`
  (`string→text`, `number→number`, `boolean→yesno`, default `text`).
- **Outputs**: a `Set` node named `Outputs`, else the `respondToWebhook` node's
  body fields (best-effort: object keys of a JSON `responseBody`, or `$json.x`
  references). Absent ⇒ `[]`.

All inference is best-effort and **never throws**; a malformed workflow yields a
summary with empty `inputs`/`outputs`.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/field-value-source.ts` (new) | `FieldValueSource = { kind: "ai" } \| { kind: "step_field"; nodeId; fieldKey } \| { kind: "literal"; value }` |
| domain | `packages/domain/src/entities/flow-node.ts` | `AutoNodeConfig`: add `workflowId?: string \| null`, `requestFieldValues?: Record<string, FieldValueSource>`. `ScheduledNodeConfig`: add `specSource?: FieldValueSource` |
| domain | `packages/domain/src/entities/n8n-workflow.ts` (new) | `N8nWorkflowSummary`, `N8nTrigger` |
| domain | `packages/domain/src/ports/n8n-workflow-directory.ts` (new) | `IN8nWorkflowDirectory.listWorkflows(): Promise<Result<N8nWorkflowSummary[]>>` |
| domain | `packages/domain/src/ports/node-executor.ts` | `NodeExecutionInput`: add `responseFields?: TemplateField[]` |
| domain | `packages/domain/src/ports/session-step-output-repository.ts` | add `listBySession(sessionId): Promise<Result<SessionStepOutput[]>>` |
| domain | `packages/domain/src/config/*` (with the other `*_SETTING_KEY`) | add `N8N_CONFIG_SETTING_KEY`, `N8nConfig { baseUrl; apiKey }` |
| application | `packages/application/src/services/resolve-field-values.ts` (new) | resolve `literal`/`step_field` directly; batch `ai` fields through `extractStructuredFields`; merge into `Record<string,string>` |
| application | `packages/application/src/use-cases/document/structured-fields.ts` | extend context to include prior step outputs + insights (priority order) |
| application | `packages/application/src/use-cases/session/run-auto-node.ts` | use the resolver; read prior outputs via `listBySession`; pass `responseFields`; if executor returns `completed` synchronously, apply inline via `ApplyAutoNodeResult` |
| application | `packages/application/src/use-cases/scheduling/schedule-node-event.ts` | resolve `specSource` for `at` (literal/step-field direct; `ai` via single-date extraction) |
| adapters | `packages/adapters/src/n8n/n8n-workflow-directory.ts` (new) | `N8nHttpWorkflowDirectory` — paginated `GET /api/v1/workflows` w/ `X-N8N-API-KEY`; node→summary mapping |
| adapters | `packages/adapters/src/node-executors/mock-node-executor.ts` | inject `ILanguageModel`; `generateObject` a mocked response against `responseFields`; return `completed` |
| adapters | `packages/adapters/src/config/runtime-config-store.ts` | add `getN8nConfig()` / `invalidateN8n()` / `redactN8n()` (DB-over-env) |
| adapters | `packages/adapters/src/repositories/drizzle-session-step-output-repository.ts` | implement `listBySession` |
| web | `apps/web/src/server/routers/settings.ts` | `getN8nConfig` / `setN8nConfig` (admin, redacted, merge-keeps-key) |
| web | `apps/web/src/server/routers/n8n.ts` (new) + `router.ts` | `n8n.listWorkflows` (admin) for the dropdown |
| web | `apps/web/src/app/(admin)/admin/settings/page.tsx` | new **n8n Integration** card |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | workflow dropdown (n8n); read-only inputs/outputs; per-request-field value selector; same selector on scheduled `at` timestamp; mock keeps free-form |
| web | `apps/web/src/components/canvas/field-value-selector.tsx` (new) | compact AI/prior-step/literal selector reused by request fields + schedule |
| web | `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` | compute `priorStepFields` from the graph; build/read new config keys; pass workflow list |
| web | `apps/web/src/lib/container.ts`, `apps/api/src/container.ts` | wire `N8nHttpWorkflowDirectory`, inject chat model into `MockNodeExecutor`, expose `listBySession` |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types & ports.** Add `FieldValueSource`, `N8nWorkflowSummary` /
   `IN8nWorkflowDirectory`, `N8nConfig` + key, `responseFields?` on
   `NodeExecutionInput`, `listBySession` on the step-output port, and the
   `AutoNodeConfig` / `ScheduledNodeConfig` fields. Pure additive types; update
   any exhaustive guards. Domain stays dependency-free.

2. **Application — field-value resolver.** Write `resolve-field-values.test.ts`
   first: (a) `literal` returned verbatim; (b) `step_field` pulled from the
   matching prior `StepOutputField`, blank when missing; (c) only `ai` fields go
   to `extractStructuredFields`; (d) merge order/keys correct; (e) empty bindings
   default every field to `ai` (today's behaviour). Then implement.

3. **Application — extractStructuredFields context.** Extend its prompt to
   include prior step outputs + accumulated insights ahead of the transcript;
   assert priority ordering. Existing `generate-document` tests stay green.

4. **Application — RunAutoNode.** Tests: (a) resolver output forms the `fields`
   map; (b) prior outputs read via `listBySession`; (c) `responseFields` passed
   to the executor; (d) synchronous `completed` result is applied inline and
   advances; (e) `pending` (n8n) unchanged. Implement.

5. **Application — ScheduleNodeEvent specSource.** Tests: (a) `at` + `literal`
   ISO; (b) `at` + `step_field` resolves an ISO from a prior output;
   (c) `at` + `ai` extracts a date; (d) `relative`/`cron` ignore `specSource`;
   (e) unparseable resolved value → `failed` row (no silent skip). Implement.

6. **Adapters — n8n directory.** `n8n-workflow-directory.test.ts` (mock fetch):
   (a) maps webhook trigger → method/path/auth + `webhookUrl`; (b) `Set`-node
   `Inputs`/`Outputs` → `TemplateField[]`; (c) `respondToWebhook` fallback for
   outputs; (d) `manualTrigger` → `manual_or_scheduled`; (e) missing nodes ⇒
   empty lists, never throws; (f) pagination via `nextCursor`; (g) non-2xx /
   network error → Result error. Implement.

7. **Adapters — mock executor + runtime config + repo.** Mock executor test:
   `generateObject` called with a schema from `responseFields`, returns
   `completed` with the object; LM error → Result error (no throw). Runtime
   config test: DB-over-env, redaction, cache invalidation. Repo test:
   `listBySession` round-trip + ordering. Implement all three.

8. **Web — settings + workflow list tRPC.** `settings.getN8nConfig` /
   `setN8nConfig` (redacted, blank-key keeps stored). `n8n.listWorkflows`
   (admin) returns mapped summaries; surfaces a typed error when n8n config is
   missing. Cover with router tests.

9. **Web — UI.** New **n8n Integration** settings card (base URL + API key,
   pattern-matched to the AI/Storage cards). In `node-config-modal.tsx`: replace
   the webhook input with the workflow dropdown (n8n executor), render the
   selected workflow's inputs/outputs read-only, add the
   `FieldValueSelector` to each request field and the scheduled `at` timestamp;
   keep `TemplateFieldEditor` for **Add field** and keep the mock free-form path.
   In `_content.tsx`: compute `priorStepFields` from prior nodes
   (conversational `documentTemplateFields` + auto `responseFields`), pass the
   workflow list, and build/read the new config keys. Gate new controls behind
   the existing flags.

10. **Container wiring + e2e + validate.** Wire the directory, mock-model
    injection, and `listBySession` in both containers. Add
    `apps/web/e2e/enhance-n8n-workflow-context-mapping.spec.ts`: with `auto_node`
    enabled, configure an auto node by picking a workflow and setting a request
    field to a prior-step value + a literal, and save. Bump `VERSION` +
    `package.json#version` to `1.30.0`. Run `./validate.sh`; fix all failures.
    Move this phase doc to `docs/development/implemented/v1.30.0/` with an
    implementation summary.

## 7. Acceptance criteria

- [ ] Admin can configure an n8n instance (base URL + API key) on
      `/admin/settings`; the key is redacted on read and preserved when the
      field is left blank on save.
- [ ] `n8n.listWorkflows` returns one clean summary per workflow with inferred
      `inputs`/`outputs` and a derived `webhookUrl`; malformed workflows yield
      empty field lists rather than errors.
- [ ] An n8n auto node is configured by picking a workflow; its inputs/outputs
      show read-only; **Add field** still adds extra request fields.
- [ ] Each auto request field and the scheduled `at` timestamp can be set to
      `AI decides` (default), an earlier step's field (topology-scoped list), or
      a specific value; bindings persist in node `config`.
- [ ] At runtime, `literal`/`step_field` values resolve directly; `ai` fields
      resolve via the model with priority `session_step_outputs` → insights →
      transcript.
- [ ] Mock executor produces an AI-generated response (configured chat model)
      shaped by the declared response fields and advances the session.
- [ ] Existing flows (hand-typed `webhookUrl`, no bindings) behave byte-for-byte
      as today; all new UI/behaviour stays behind `auto_node` / `scheduled_node`.
- [ ] Architecture boundaries intact (types/ports in domain, n8n HTTP +
      inference in adapters, Result pattern at every boundary); no new table.
- [ ] One Playwright e2e covers the workflow-pick + value-source path.
- [ ] `VERSION` = `package.json#version` = `1.30.0`; `./validate.sh` passes.

## 8. Risks / open questions

- **Inference coverage.** The `Set`-node convention only works when authors
  follow it; document the convention and rely on **Add field** otherwise.
- **`manual_or_scheduled` triggers** have no webhook URL — decide in step 9
  whether to hide them from the dropdown or allow a manual URL fallback.
- **`responseFields?` on `NodeExecutionInput`** ripples to every `INodeExecutor`
  mock — keep additive, update doubles.
- **AI-decided schedule time** is the riskiest value source; validate the
  extracted timestamp strictly and fail to a `failed` row on unparseable output.
- **n8n API shape/pagination** (`limit`, `cursor`, `X-N8N-API-KEY`) must be
  verified against a live instance / n8n docs, not assumed — confirm at build.
- **Egress**: the admin-authored `baseUrl` is a server-side fetch target; note
  the SSRF consideration and run the security-review skill before done.
```
