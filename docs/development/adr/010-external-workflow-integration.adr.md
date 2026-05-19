# ADR-010 — External Workflow Integration via `INodeExecutor`

- **Status**: Accepted (Phase 5 implementation; port locked at Phase 0)
- **Date**: 2026-05-19

## Context

Wayfinder's value at MVP is the AI-guided conversation. At Phase 5, certain
nodes will trigger **external workflows** — typically n8n sub-workflows that
do real work in agency systems (vendor lookup, SharePoint write, AusTender
publish). These nodes are "auto-nodes" and may run with or without human
approval.

Locking the integration contract now — even though Phase 5 is out of MVP
scope — avoids the integration becoming a breaking change later. Two things
must be settled at Phase 0:

1. The **port shape** for triggering external work.
2. The **endpoint location** for inbound status updates from external systems.

Without that, Phase 5 is a refactor; with it, Phase 5 is an adapter swap.

## Decision

### Domain port

A new domain port, `INodeExecutor`, lives in
`packages/domain/src/ports/node-executor.ts`:

```ts
export interface INodeExecutor {
  execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>>;
  // Phase 5: status updates pushed back via the webhook endpoint, not this method
}

export interface NodeExecutionInput {
  nodeId: string;
  sessionId: string;
  userId: string;        // who is running the session
  userRole: 'admin' | 'user';
  flowId: string;
  fields: Record<string, unknown>;  // gathered from the conversation, schema set per node
}

export interface NodeExecutionOutput {
  status: 'completed' | 'pending_approval' | 'failed';
  data: Record<string, unknown>;
  message?: string;       // shown in the chat
}
```

`userId` and `userRole` are in the input **from day one** because n8n
sub-workflows must attribute actions and enforce permissions inside agency
systems.

### Implementations

| Phase   | Implementation         | Lives in                                                         |
| ------- | ---------------------- | ---------------------------------------------------------------- |
| Phase 0 | `MockNodeExecutor`     | `packages/adapters/src/node-executors/mock-node-executor.ts`     |
| Phase 5 | `N8nNodeExecutor`      | `packages/adapters/src/node-executors/n8n-node-executor.ts`      |

`MockNodeExecutor` returns hardcoded `status: 'completed'` data shaped per
node type. It exists so the rest of the system can be exercised end-to-end
without n8n.

### Inbound webhook endpoint (Phase 5)

External systems push status updates **into** Wayfinder via:

```
POST /v1/webhooks/n8n/:sessionId
Headers:
  X-N8n-Signature: <hmac-sha256 of body with N8N_WEBHOOK_SECRET>
Body:
  { nodeId, status, data, message? }
```

This endpoint lives in **`apps/api`** (Express), not `apps/web` (Next.js).
Three reasons:

1. The webhook must be independently deployable from the user-facing app; n8n
   can deliver while a Next.js build is rolling out.
2. Express already handles `apps/api`'s existing v1 routes (errors, users) —
   no second process to manage.
3. tRPC isn't a fit for external callers; Zod-validated Express is.

The endpoint validates `X-N8n-Signature` against `N8N_WEBHOOK_SECRET` (the
only secret Wayfinder holds for the n8n side). Validation is rejection-only
— a missing/invalid signature returns 401.

On success, the endpoint:

1. Writes the status to `app_session_messages` as a `'system'` role message.
2. Notifies the chat client via SSE (Phase 5 adds the streaming endpoint).

### What MVP delivers

Phase 0 ships:

- The `INodeExecutor` port in `packages/domain`.
- `MockNodeExecutor` in `packages/adapters`.
- The webhook route as a **stub** in `apps/api` returning `501 Not
  Implemented` — present so the route exists in the routing table and the
  signature middleware is tested.

`N8nNodeExecutor`, SSE streaming, approval-gate UI, and example n8n
sub-workflows all land in Phase 5.

### Environment variables

| Var                  | Phase    | Required when                | Default |
| -------------------- | -------- | ---------------------------- | ------- |
| `N8N_WEBHOOK_SECRET` | Phase 5  | n8n integration enabled      | unset   |
| `N8N_BASE_URL`       | Phase 5  | `N8nNodeExecutor` configured | unset   |

## Consequences

**Positive**

- Phase 5 lands without refactor: replace `MockNodeExecutor` with
  `N8nNodeExecutor` in the container; the application layer is untouched.
- `userId` and `userRole` in the payload mean n8n side-effects can be
  attributed and audited from the start.
- Webhook signature check is in `apps/api` where the existing middleware
  patterns live.

**Negative**

- A port we don't use at MVP. Cost is one interface and one mock
  implementation — small.
- The 501 stub route may surprise a developer who curls it. Documented in
  the route handler.

## Open question (Phase 5)

Should `NodeExecutionInput.fields` carry its own Zod schema reference so n8n
can validate inputs? Default: yes, the node config in `app_flow_nodes` (for
`auto-node` type) includes an `input_schema` field; the adapter passes it
along. Settled at Phase 5 design time.
