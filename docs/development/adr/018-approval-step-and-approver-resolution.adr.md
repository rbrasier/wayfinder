# ADR-018 — Approval Step Type & Approver Resolution

- **Status**: Proposed
- **Date**: 2026-06-03
- **Relates to**: ADR-010 (`INodeExecutor` / `pending_approval`), ADR-016 /
  ADR-017 (pgvector RAG over the knowledge base), Email Notifications
  (`INotificationSender`, M365 app registration)

## Context

Flows must halt at a point of human sign-off and only continue once the right
person decides. The `pending_approval` status already exists in
`NodeExecutionOutput` and the n8n webhook schema but was deferred (ADR-010).

Two questions must be settled:

1. **Where does "approval" live in the flow** — config on an existing step, or
   its own node type?
2. **How is the approver chosen**, given approvers are not always the operator's
   own manager — sometimes they are a *policy-defined* role (e.g. "the SES Band 1
   delegate per the Delegations Instrument")?

## Decision

### Approval is its own node type

Add `approval` to the `FlowNode` union (`conversational` | `auto` | `approval`).
It is a first-class node — its own inbound/outbound edges (approve routes
forward; reject can route back), visible on the canvas — not a flag on another
step. Reaching it produces `status: 'pending_approval'` (the reserved value is
now used), writes an `app_session_approvals` row, and holds the session.

### Approver is a dropdown of resolution *modes*, never a hard-coded person

The `approval` node `config`:

```ts
interface ApprovalNodeConfig {
  approverSource:
    | 'first_level_supervisor'
    | 'second_level_supervisor'
    | 'dynamic';        // resolved from policy/context at run time
  roleHint?: string;     // optional steer for the dynamic case
  instructions?: string; // shown to the operator and approver
}
```

- **`first_level_supervisor` / `second_level_supervisor`** are *structural*:
  walk the reporting chain N hops up from the operator. Deterministic — never
  AI-guessed — so the route is auditable.
- **`dynamic`** is *policy-driven*: the approver is named by policy, not by the
  operator's own chain. The agent retrieves the governing clause from the
  knowledge base (RAG, ADR-016/017), extracts the role/band/business-unit, and
  looks up who holds it. The AI **proposes**; it never invents a name.

### Resolution always ends in human confirmation

For **every** mode — including `first_level_supervisor` — the resolver only ever
produces a **suggested** approver. The operator must confirm before the request
is sent, because the structurally-correct manager may be on leave, acting, or
simply wrong for this matter. The confirmation UI always offers **"Someone
else"** with type-ahead auto-suggest. Only the confirmed identity is written as
the approver; the suggestion and any override are both recorded for audit.

### Org data: three federated sources behind one search

Resolution and the "Someone else" picker draw on a federated people directory:

```ts
export interface IPeopleDirectory {
  search(input: { query: string; limit: number }): Promise<Result<Person[]>>;
}

export interface IReportingLineResolver {
  // walks N levels up; returns a SUGGESTION only
  suggest(input: { level: 1 | 2; userId: string }):
    Promise<Result<{ suggestedApproverUserId: string } | { unresolved: true }>>;
}
```

| Source | Role | How |
| ------ | ---- | --- |
| **Microsoft Entra ID (Graph)** | authoritative hierarchy + people search | Reuse the Email-Notifications **M365 app registration**, adding `User.Read.All` + `Directory.Read.All`. `GET /users/{id}/manager` walked once/twice gives first/second level; `$search` powers auto-suggest. |
| **Uploaded HR dataset** | fallback / orgs without a clean directory; extra position data | Admin uploads CSV/XLSX in configuration (see below). |
| **Free-text email** | escape hatch | The operator may type *any* email address; it is validated and accepted even if it matches no known source. |

Precedence for the hierarchical *suggestion*: Entra → HR upload (mapped manager
column) → unresolved (operator picks). For the "Someone else" search, all three
are merged and de-duplicated by email.

### HR upload is stored as-uploaded, not into fixed columns

Admin-managed HR data is uploaded as CSV/XLSX and stored **in the structure it
arrived in** — original headers preserved, each row as `jsonb` — not coerced into
a prescribed schema. A thin, separately-editable **column mapping** records which
headers carry email / display name / manager reference / position / band /
business unit. Rationale:

- Agencies hand over wildly different spreadsheet shapes; forcing a schema at
  upload time loses columns and rejects valid files.
- The raw rows remain fully searchable (GIN index on the `jsonb`) for the
  "Someone else" picker even before any mapping exists.
- Resolution and the dynamic position-lookup read *through* the mapping, so the
  same upload serves both people-search and reporting-line/position needs without
  re-importing.

Two tables: `admin_hr_datasets` (file metadata + `columns` + `column_mapping`)
and `admin_hr_rows` (one `jsonb` row each).

### Dynamic case: policy in the KB + a lookup tool the agent calls

For `approverSource: 'dynamic'` the delegations/approvals policy is indexed into
the `kb_` layer. At the node the agent (1) retrieves the clause naming the
approving role, (2) extracts band/role/unit, (3) calls a
`findPositionHolder({ band, role, businessUnit })` lookup backed by the directory
sources, and (4) surfaces the candidate(s). One match → suggested and confirmed
by the operator; zero or several → "Someone else" search. The AI reads the role
out of policy prose; the person↔approval binding stays deterministic and
human-ratified.

### Decisions and effects

Decisions are `approved` | `rejected` | `changes_requested` with an optional
`comment`, recorded on the row and in `core_audit_log`.

- **Approved** → session advances; the approved `record_snapshot` is retained for
  the record-regeneration procedure (Scheduling) and/or export (Record-Keeping).
- **Rejected / changes requested** → comment surfaced to the operator; session
  does not advance.

Notifications reuse `INotificationSender` (`approval_requested` → approver,
`approval_decided` → requester), non-blocking via the outbox model.

### Superseded earlier sketch

This replaces the first draft's `core_users.supervisor_user_id` column. Hierarchy
now comes from Entra (live) with the HR upload as fallback, and the always-
confirm rule means no single stored edge is treated as ground truth.

## Consequences

**Positive**

- One picker, three sources: structural levels, policy-driven roles, and a free
  email escape hatch all resolve through the same confirmable UI.
- Reuses the existing M365 app registration — no new identity integration to
  stand up, just added Graph scopes.
- Schema-flexible HR upload accepts any spreadsheet and is useful immediately for
  search, with mapping layered on for resolution.
- Always-confirm keeps a human (and the audit log) on every routing decision.

**Negative**

- A federated directory with de-duplication and three adapters is more moving
  parts than a single column.
- Graph scopes (`Directory.Read.All`) are privileged and need tenant admin
  consent.
- Free-email approvers may not be Wayfinder users (see open question).

## Open questions

- **Approver who is not a known user.** A typed email may match no
  account. Options: restrict to authenticable users, or send a secure
  magic-link approval to external/not-yet-onboarded approvers. Leaning toward
  magic-link, but it expands auth scope — flagged for `/doc-review`.
- HR-upload mapping UX: auto-detect likely columns vs require explicit mapping
  before the dataset is usable for *resolution* (search works regardless).
- Whether `dynamic` ever needs more than band/role/unit to disambiguate (e.g.
  cost-centre) — start minimal.
