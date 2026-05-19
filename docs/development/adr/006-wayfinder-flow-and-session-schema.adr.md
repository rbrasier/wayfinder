# ADR-006 — Wayfinder Flow & Session Schema

- **Status**: Accepted (revised — consolidated from 8 to 5 tables)
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

Five new tables, all `app_*`, snake_case columns. Every table has
`id uuid primary key default gen_random_uuid()`, `created_at timestamp`,
`updated_at timestamp`. The single exception is `app_session_messages`, which
is append-only (chat messages are never edited) — no `updated_at`.

Permissions, context documents, and generated document metadata are embedded
as `jsonb` columns on their parent rows rather than in separate tables.
This reduces join complexity and query count for the two most common reads
(load a flow for canvas editing; reload a session for chat).

| Table                  | Purpose                                        | Notes |
| ---------------------- | ---------------------------------------------- | ----- |
| `app_flows`            | Flow definitions + embedded permissions + context docs | `status` is `'draft' \| 'published'`. `permissions jsonb` holds `[{userId, role}]`. `context_docs jsonb` holds `[{id, filename, mimeType, sizeBytes, storagePath}]` |
| `app_flow_nodes`       | Nodes belonging to a flow                      | `type` enum: `'conversational'` (MVP) `\| 'auto'` (Phase 5). `config jsonb` holds per-type data (see below) |
| `app_flow_edges`       | Directed edges                                 | `from_node_id`, `to_node_id`. Branching = multiple rows with the same `from_node_id` |
| `app_sessions`         | Live + completed user sessions                 | `status` enum: `'active' \| 'complete' \| 'abandoned'`. `current_node_id` advances as steps complete. `graph_checkpoint jsonb` holds LangGraph state (see ADR-007) |
| `app_session_messages` | Append-only chat history + optional document   | `role`: `'user' \| 'assistant' \| 'system'`. `confidence smallint` (0–100, null for user/system). `step_node_id` records which step produced the message. `document jsonb` is non-null only on assistant messages that triggered document generation |

### Embedded JSON shapes

**`app_flows.permissions`** (default `[]`):
```jsonc
[
  { "userId": "<uuid>", "role": "owner" },
  { "userId": "<uuid>", "role": "viewer" }
]
```
`owner_user_id` column remains the canonical creator. `permissions` holds
additional grants. Permission check: `role === 'admin' OR flow.owner_user_id === userId OR flow.permissions[].userId === userId && role === 'owner'`.

**`app_flows.context_docs`** (default `[]`):
```jsonc
[
  {
    "id": "<uuid>",
    "filename": "CPR-summary.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 204800,
    "storagePath": "/tmp/uploads/<uuid>.pdf"
  }
]
```

**`app_session_messages.document`** (default `null`):
```jsonc
{
  "filename": "ProcurementFlow-StepName-<sessionId>-2026-05-19.docx",
  "storagePath": "/tmp/docs/<uuid>.docx",
  "summary": "Two-line AI-generated preview of the document content.",
  "generatedAt": "2026-05-19T10:00:00.000Z"
}
```

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

### Why `jsonb` for permissions, context docs, and documents?

- **Permissions** — a flow typically has 1–5 permission entries. A separate
  table adds a join to every canvas mutation check. Embedding keeps the
  permission check in the already-loaded flow row. If permission sets grow
  large, promotion to a table is a straightforward migration.
- **Context docs** — a flow typically has 1–10 reference documents. The whole
  set is loaded together whenever a session starts (to build the AI context).
  A separate table adds a join on every session start; embedding avoids it.
- **Documents** — a generated document is logically the output of the specific
  assistant message that triggered it. Embedding on the message row means the
  chat history load (a single query) also retrieves document metadata. The
  file is stored on disk (`/tmp` at MVP); the jsonb holds only the metadata.
- **Node config** — same rationale as before; future node types have unknown
  fields.

The tradeoff: these fields are invisible to SQL indexes and TypeScript without
Zod parsing. Discipline required — all reads go through typed helpers in the
domain layer.

### Indexes

| Table                  | Index                                         | Why |
| ---------------------- | --------------------------------------------- | --- |
| `app_flow_nodes`       | `(flow_id)`                                   | Canvas load |
| `app_flow_edges`       | `(flow_id)`, `(from_node_id)`                 | Canvas load + advance lookup |
| `app_sessions`         | `(user_id, created_at desc)`, `(flow_id)`     | Session list |
| `app_session_messages` | `(session_id, created_at asc)`                | Chat reload |

## Consequences

**Positive**

- 5 tables instead of 8 — fewer joins, simpler migration, simpler repository
  implementations.
- Canvas load (flow + nodes + edges) and session reload (session + messages)
  are each satisfied by 3 queries with no joins to auxiliary tables.
- `graph_checkpoint` lets a session resume after a server restart without
  replaying messages.
- `document` on the message row keeps the chat history and document cards in
  a single query.

**Negative**

- `permissions` and `context_docs` cannot be efficiently queried by userId or
  filename without loading the whole flow row. Acceptable at MVP scale.
- `document` jsonb on a message is append-only; a "regenerate" action produces
  a new assistant message rather than updating the old one.
- All jsonb reads pass through Zod helpers — discipline required to avoid
  silent type drift.

## Migration plan

One Drizzle migration `0004_app_wayfinder_schema.sql` in Phase 0 creates all
five tables in one go. Phase 4 ships the seed data migration with the AU Gov
procurement flow rows.

## Naming sanity check

All table names match `^app_[a-z_]+$` and use the `app_` prefix per
CLAUDE.md. No collisions with `core_*` or `ai_*`. `validate.sh`
`table-prefix-check` will pass.
