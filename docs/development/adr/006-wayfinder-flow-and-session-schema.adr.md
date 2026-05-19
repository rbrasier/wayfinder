# ADR-006 — Wayfinder Flow & Session Schema

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Wayfinder persists three kinds of state:

1. **Flow configuration** — flows, nodes, edges, context documents, ownership.
   Owned by admins and flow owners; read by everyone running a session.
2. **Session state** — per-user runs of a flow: messages, current step,
   confidence score, generated documents, the LangGraph checkpoint.
3. **Document outputs** — generated DOCX files referenced from the chat UI.

The existing template has `core_users`, `core_sessions` (Better Auth),
`ai_conversations`, `ai_messages`, `app_error_log`, etc. None of them suit
Wayfinder's needs: `ai_messages` has no `confidence` or `step_node_id`, and
`ai_conversations` has no `flow_id` or `current_node_id`.

Per CLAUDE.md, application-specific tables use the `app_` prefix.

## Decision

Eight new tables, all `app_*`, snake_case columns, every table has
`id uuid primary key default gen_random_uuid()`, `created_at timestamp`,
`updated_at timestamp`. The single exception is `app_session_messages`, which
is append-only (chat messages are never edited) — no `updated_at`.

| Table                   | Purpose                                       | Notes |
| ----------------------- | --------------------------------------------- | ----- |
| `app_flows`             | Flow definitions                              | `status` is `'draft' \| 'published'`; only published flows appear in the New Chat modal |
| `app_flow_nodes`        | Nodes belonging to a flow                     | `type` enum: `'conversational'` (MVP) `\| 'auto'` (Phase 5). `config jsonb` holds per-type data (see below) |
| `app_flow_edges`        | Directed edges                                | `from_node_id`, `to_node_id`. Branching = multiple rows with the same `from_node_id` |
| `app_flow_context_docs` | Flow-level uploaded reference documents       | `storage_path` references `/tmp` for MVP; durable storage is Phase 4+ |
| `app_flow_permissions`  | Per-flow access (see ADR-005)                 | `permission` enum: `'owner' \| 'viewer'` |
| `app_sessions`          | Live + completed user sessions                | `status` enum: `'active' \| 'complete' \| 'abandoned'`. `current_node_id` advances as steps complete. `graph_checkpoint jsonb` holds LangGraph state (see ADR-007) |
| `app_session_messages`  | Append-only chat history                      | `role`: `'user' \| 'assistant' \| 'system'`. `confidence smallint` (0–100, null for user/system). `step_node_id` records which step produced the message |
| `app_documents`         | Generated DOCX records                        | `summary text` is the AI-generated 2-line preview shown on the document card |

### Node `config` JSON shape

For `type = 'conversational'`:

```jsonc
{
  "ai_instruction": "Ask the user about procurement category, value, timeframe.",
  "done_when": "I have category, estimated value, and timeframe.",
  "output_type": "conversation_only", // or "generate_document"
  "document_template_markdown": "## Background\n...",  // present only if output_type = generate_document
  "advance_confidence_threshold": 90 // optional override, default 90
}
```

For `type = 'auto'` (Phase 5):

```jsonc
{
  "executor": "n8n",
  "n8n_webhook_url": "...",
  "input_schema": { /* zod-like */ },
  "approval_required_for": ["write"]
}
```

### Why `jsonb` for node config?

- At MVP we don't know which fields a future node type will need (auto-node,
  decision-node, retrieval-node, ...).
- Promoting fields to columns later is a straightforward migration.
- Querying inside node config is rare — the canvas loads the whole node row
  and the AI consumes the whole row at session start.

### Indexes

| Table                   | Index                                              | Why |
| ----------------------- | -------------------------------------------------- | --- |
| `app_flow_nodes`        | `(flow_id)`                                        | Canvas load |
| `app_flow_edges`        | `(flow_id)`, `(from_node_id)`                      | Canvas load + advance lookup |
| `app_flow_permissions`  | `(flow_id, user_id)` unique                        | Permission check per request |
| `app_sessions`          | `(user_id, created_at desc)`, `(flow_id)`          | Session list |
| `app_session_messages`  | `(session_id, created_at asc)`                     | Chat reload |
| `app_documents`         | `(session_id)`                                     | Document re-render on reload |

## Consequences

**Positive**

- `jsonb` keeps the canvas-editor data model flexible without prematurely
  carving columns.
- Append-only `app_session_messages` makes audit trivial — no `UPDATE` path.
- `graph_checkpoint` lets a session resume after a server restart without
  replaying messages.

**Negative**

- `jsonb` config is invisible to ESLint and TypeScript without parsing
  through Zod. Discipline required: every `flow_nodes.config` read passes
  through a `parseConversationalConfig(node)` helper in the domain layer.
- Branching logic (edges out from one node) is correct in the schema but
  needs careful UI to prevent orphans. Canvas tests cover this.

## Migration plan

One Drizzle migration `app_wayfinder_schema.sql` in Phase 0 creates all
eight tables in one go. Phase 4 ships the seed data migration with the AU
Gov procurement flow rows.

## Naming sanity check

All table names match `^app_[a-z_]+$` and use the `app_` prefix per
CLAUDE.md. No collisions with `core_*` or `ai_*`. `validate.sh`
`table-prefix-check` will pass.
