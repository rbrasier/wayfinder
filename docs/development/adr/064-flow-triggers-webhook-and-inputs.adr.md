# ADR-064 — Flow Triggers: Webhook Start and Declared Trigger Inputs

- **Status**: Proposed (scoped by `unattended-automation.prd.md`)
- **Date**: 2026-10-22
- **Assumes**:
  - ADR-015 (flow versioning snapshots)
  - ADR-063 (Event Watch input mapping)
  - ADR-065 (unattended run start)
- **Numbering**: 064. See ADR-063 for why the range starts at 063.

## Context

Watches and outside systems both start flows with data such as a hearing ID.
Two things need deciding: how that data enters a flow in a way steps can rely
on, and how an outside system authenticates a call that starts a flow.

## Decision

### 1. Flows declare trigger inputs, versioned with the flow

```ts
interface TriggerInput {
  key: string;           // [a-z][a-z0-9_]{0,63}, unique per flow
  label: string;
  type: "text" | "number" | "date" | "boolean" | "json";
  required: boolean;
}
```

Inputs are stored on `app_flows.trigger_inputs jsonb` (nullable, where absent
means none) and copied into `FlowSnapshotMeta.triggerInputs?` at publish. A
session pinned to a version reads that version's inputs. Snapshots published
before this change have no key, which reads as `[]`.

`validateTriggerPayload(inputs, payload)` is a pure domain function. It returns
`Result<Record<string, unknown>>`. It coerces numbers and booleans from
strings, parses ISO dates, rejects a missing required input, and **drops**
undeclared keys from the validated record. The raw payload is still kept (§4).

### 2. Steps read inputs through a new `FieldValueSource` kind

`FieldValueSource` gains `{ kind: "trigger_input"; inputKey: string }`. The
resolver that already handles `step_field` resolves it from
`session.triggerPayload.inputs[inputKey]`. A manually started session has no
inputs, so the source resolves to empty, the same as an unanswered
`step_field`. Every existing value picker gains a **Trigger inputs** group
above prior steps. The group appears only when the flow declares inputs.

Rejected: dumping the raw payload into session context for the AI to read. It
is unvalidated, can't be bound to a document field deterministically, and
pushes arbitrary external text into prompts.

### 3. Webhook: one per flow, token plus optional HMAC

`app_flow_triggers` has a unique `(flow_id, kind)`. `kind` is `'webhook'` today,
and the column is there so a scheduled-start kind can be added later without a
new table. Columns: `enabled`, `token_hash`, `token_last_four`,
`hmac_secret_encrypted` (null means HMAC is off), `run_as_user_id`,
`created_by`, `last_triggered_at`.

- **Token.** 32 random bytes, base64url, prefixed `wf_wh_`. It is shown
  **once**, at enable or rotate. Only a SHA-256 hash is stored, and comparison
  uses `timingSafeEqual`. The UI then shows `wf_wh_…abcd`. Rotating replaces
  the hash at once, so the old token stops working.
- **HMAC.** When enabled, callers must also send
  `X-Wayfinder-Signature: sha256=<hex>` over the raw body. This is the same
  scheme as the n8n callback in `apps/api/src/routes/webhooks.ts`; the
  `verifySignature` helper moves to a shared module. The HMAC secret is shown
  once and stored encrypted (ADR-063 §1).

**Endpoint.** `POST /triggers/:flowId`, with
`Authorization: Bearer wf_wh_…` and a JSON body of `{ "inputs": { … } }`:

| Case | Response |
| ---- | -------- |
| No trigger, trigger disabled, or flow unpublished/deleted | `404` (does not reveal whether the flow exists) |
| Bad or missing token, or bad HMAC | `401` |
| Inputs fail validation | `400` with per-field reasons; no session |
| Rate limit exceeded (60/min per flow, existing `IRateLimiter`) | `429` |
| Run started | `202 { sessionId }` |

The route only validates and calls `StartUnattendedRun` (ADR-065). The run
proceeds asynchronously and the caller does not wait for steps.

**Who may enable it.** A new registry permission, `flow:webhook_trigger`
(label "Start flows via webhook"), is granted to **Power Users** by default.
Admins hold it through the ADR-021 wildcard. A user may enable, disable,
rotate or set HMAC on a flow's webhook only if they hold the permission
**and** own the flow. Admins may do so on any flow. The `flowTrigger.*`
mutations enforce this server-side, and the Triggers tab hides the webhook
panel for anyone without it.

`workflow:create_own` is deliberately **not** enough. It is granted to
Everyone (`seed-roles.ts`), and an inbound endpoint that starts runs needs
more trust than authoring a flow.

The permission is granted to Power Users in two places:

- **Fresh installs:** in `seed-roles.ts`.
- **Upgraded installs:** in the migration's backfill (phase doc §7), because
  `seed-roles.ts` only writes default grants for roles it creates.

The run-as user defaults to whoever enabled the webhook and can be changed
only by an admin. Enable, disable, rotate and the HMAC toggle are audit-logged
as `flow_trigger.*`.

Rejected: reusing `flow:advanced_config`. It would couple two unrelated
capabilities, so an admin could not grant one without the other.

Rejected: a token in the URL query string. It ends up in proxy and access
logs. Rejected: HMAC only. Many low-code callers can't compute it.

### 4. What a triggered session records

`app_sessions` gains:

- `origin text not null default 'manual'`: one of `'manual' | 'watch' |
  'webhook'`.
- `trigger_source_id uuid`: the watch ID or flow-trigger ID. This is what run
  history is queried by.
- `trigger_payload jsonb`: `{ inputs, raw, itemId? }`. `raw` is capped at
  256 KB and kept for audit and debugging.

## Consequences

- Any step type can consume trigger inputs, with no change to the steps
  themselves.
- An admin can remap a watch's inputs without republishing the flow. Adding or
  removing an input does require publishing.
- If a published version drops an input a watch maps, the watch editor flags
  the mapping as stale. Polls carry on, and the dropped key is ignored.
