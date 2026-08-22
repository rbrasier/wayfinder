# ADR-018 — Approval Step Type & Approver Resolution

- **Status**: Accepted (implemented v1.37.0)
- **Date**: 2026-06-03
- **Extended**: 2026-08-02 — "Resolution always ends in human confirmation": the
  confirming human may be the preceding approver on a chained approval, not only
  the operator (v0.22.2)
- **Extended**: 2026-08-07 — "Withdrawal": the originator may take a pending
  request back, a fourth transition out of `pending` (v0.25.0)
- **Extended**: 2026-08-07 — "Reassignment": the session owner may change who an
  open request is with, without moving the session (v0.26.0)
- **Extended**: 2026-08-22 — "Directory configuration is runtime DB state": the
  Entra app registration the directory queries moves from the `M365_*`
  environment variables into a `directory_config` row an admin edits at
  `/admin/settings`, choosing to inherit the email or sign-in registration or to
  supply a separate one. `M365_*` stays as a fallback, and the Graph base URL and
  token authority stay environment-only — they decide where a client secret is
  sent, the same split ADR-042 draws for `PKI_TRUSTED_PROXY_IPS` (v0.28.6)
- **Relates to**: ADR-010 (`INodeExecutor` / `pending_approval`), ADR-016 /
  ADR-017 (pgvector RAG over the knowledge base), ADR-023 Email Notification
  Transport (`IEmailSender` + `app_notification_log` outbox, M365 app registration)

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

Add `approval` to the `FlowNode` union (`conversational` | `auto` | `scheduled` |
`approval`).
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
produces a **suggested** approver. A human must confirm before the request
is sent, because the structurally-correct manager may be on leave, acting, or
simply wrong for this matter. The confirmation UI always offers **"Someone
else"** with type-ahead auto-suggest. Only the confirmed identity is written as
the approver; the suggestion and any override are both recorded for audit.

**Who that human is depends on where the approval sits in the flow.** For the
first approval it is the operator, at the chat gate. For a *subsequent* approval
in a chain it may be the approver who just decided the previous one, confirming
from the decision modal in `/approvals` (v0.22.2).

That is a widening of "the operator", added deliberately rather than by
accident, and every guarantee above is untouched: a human still confirms, the
resolver still only suggests, "Someone else" is still offered, and the
suggestion and any override are still both recorded. What changes is only
*which* human, and the reason is that leaving it to the operator meant a chained
approval sat idle until they happened to reopen the session — with the one
person actually looking at the request unable to move it on. The approver who
has just signed is better placed to say who signs next than someone who is not
in the room.

The rule is therefore: **a human who is party to the approval confirms it**,
never the system.

### Org data: four federated sources behind one search

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
| **Existing Wayfinder accounts** | the people who can actually act | Case-insensitive match over `core_users.name` / `.email`. Listed first and preferred in the de-duplication: an approver with no account cannot decide until one exists (see *Consequences*), so a candidate who already has one is never buried under a directory record for the same address. Requires no external configuration, so it is the one source that always works. |
| **Microsoft Entra ID (Graph)** | authoritative hierarchy + people search | Reuse the Email-Notifications **M365 app registration**, adding `User.Read.All` + `Directory.Read.All`. `GET /users/{id}/manager` walked once/twice gives first/second level; `$search` powers auto-suggest. |
| **Uploaded HR dataset** | fallback / orgs without a clean directory; extra position data | Admin uploads CSV/XLSX in configuration (see below). |
| **Free-text email** | escape hatch | The operator may type *any* email address; it is validated and accepted even if it matches no known source. |

Precedence for the hierarchical *suggestion* is unchanged: Entra → HR upload
(mapped manager column) → unresolved (operator picks). For the "Someone else"
search, all four are merged and de-duplicated by lowercased email, preferring
the account-backed record. Preference is by source rank, not by search order, so
reordering the directory list cannot change which record survives.

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

### Every approver gets the same link, gated by auth

The notification to the approver carries a link to the in-app approval —
identical whether or not the address matches a `core_users` row. Clicking it
routes to the approval screen; if the recipient is not authenticated they are
redirected to login first and returned to the approval afterward. There is no
separate magic-link or approve-by-email path: decisions always happen in-app
behind normal authentication. A free-typed `approver_email` therefore needs an
account that can sign in to act; provisioning/invite of brand-new accounts is
out of scope for this phase.

### Decisions and effects

Decisions are `approved` | `rejected` | `changes_requested` with an optional
`comment`, recorded on the row and in `core_audit_log`.

- **Approved** → session advances; the approved `record_snapshot` is retained for
  the record-regeneration procedure (Scheduling) and/or export (Record-Keeping).
- **Rejected / changes requested** → comment surfaced to the operator; session
  does not advance.

On any decision the outcome and `decided_at` (plus `decided_by` and `comment`)
are also projected onto the approval node's step-output metadata, so reporting
can read the decision from the step record without joining
`app_session_approvals`. The row stays the source of truth; the metadata is a
denormalised copy.

Notifications reuse the existing `IEmailSender` port + the `app_notification_log`
outbox (ADR-023) — no new `INotificationSender` port. Triggers `approval_requested`
(→ approver), `approval_decided` (→ requester) and `approval_withdrawn`
(→ approver) write a `pending` outbox row in the acting commit; the send is
best-effort and non-blocking, with subject/body composed as application-layer
string builders.

### Withdrawal: the originator's own way out (v0.25.0)

The three decisions above all belong to the approver. That left the originator
with no route out of a request they had already sent: a wrong approver, or a
mistake spotted a moment after sending, parked the session until someone else
acted. **Withdrawal is the fourth transition out of `pending`, and the only one
initiated by the person who raised the request.**

- **Recorded, not deleted.** `ApprovalStatus` gains `withdrawn`. The row stays,
  so the trail keeps who asked whom and that it was pulled before a decision.
  Deleting it would leave the node looking as though no request was ever made —
  precisely the history an approval trail exists to hold. `APPROVED_STATUSES` is
  untouched, so nothing downstream counts a withdrawal as an approval.
- **Who.** The originator (`requested_by_user_id`), or an admin — the same
  widening that lets an admin decide on an approver's behalf. Nobody else.
- **Guarded like a decision.** The status flip goes through the same
  `updateIfPending` guard, in one transaction with the session move. An approver
  who decides first wins the race; the withdrawal fails and runs no side effect.
- **Where the work goes.** Back to the nearest prior *conversational* step, via
  the `nearest_editable` resolver ADR-044 §2 defines. The node's authored
  `changesRequestedTarget` is deliberately not consulted: that answers where an
  *approver* wants work returned to, and this is not the approver's move. When
  nothing resolves, the session is **held** on the approval node with the reason
  in the thread — never cancelled (ADR-044 §3).
- **Re-entry raises a fresh row**, exactly as ADR-044 §5 specifies for
  re-approval after changes. A withdrawn row is never reopened.
- **The approver is told.** They may already be part-way through a review, so a
  request that silently vanishes from their queue is worse than one they are
  told was pulled.

### Reassignment: changing who an open request is with (v0.26.0)

Withdrawal answers "the work needs to change". It is the wrong instrument for
"the right person is someone else": withdrawing moves the session back a step it
has no reason to leave, and on a chained approval it would drag the work back
past a completed signature that is still perfectly valid.

**Reassignment moves the addressee and nothing else.** The session stays on the
approval node; the row stays `pending`; the decided chain behind it is untouched.

- **Who.** The **session owner**, or an admin. Deliberately *not* the row's
  requester: on a chained approval the requester is the previous approver, who
  nominated the next signer from their decision modal — and the person who needs
  to fix a wrong assignment is the one watching the chat. This is why the gate
  offers the author *Update approver* where it does not offer *Withdraw*.
- **Only an open request.** Guarded by the same `updateIfPending` check the
  decision and the withdrawal use, so an approver deciding first wins and the
  move is refused rather than rewriting a decided row's approver. A decided
  approval's record is immutable (ADR-040 §3) and reassignment cannot touch it.
- **Audited with both identities.** `approval.reassigned` names who moved it,
  from whom, and to whom. This is the answer to the audit question that kept
  in-place reassignment out of scope when withdrawal shipped.
- **Announced.** A thread message names the new approver, so the author's own
  chat answers "who is this with now" without opening anything.
- **Both approvers told.** The new one gets the ordinary request email — a
  different recipient, so the outbox's (trigger, resource, recipient) dedupe does
  not swallow it. The old one gets `approval_reassigned`, saying plainly that no
  decision is needed from them.

Every guarantee at the top of this ADR still holds: a human who is party to the
approval confirms it, the resolver still only suggests, "Someone else" is still
offered, and the override is still recorded.

### The request carries a message from the originator (v0.25.0)

`instructions` on the node is authored once, by the flow author, for everyone who
ever reaches the step. It cannot say why *this* request is with *this* approver
now. A nullable `request_message` on the row carries the originator's own note,
captured when they confirm the approver and shown to the approver both in the
request email and in their queue.

It is stored apart from `comment` on purpose: `comment` is the approver's
decision comment, written to the same row, and one column would have the decision
overwrite the request.

### Superseded earlier sketch

This replaces the first draft's `core_users.supervisor_user_id` column. Hierarchy
now comes from Entra (live) with the HR upload as fallback, and the always-
confirm rule means no single stored edge is treated as ground truth.

## Consequences

**Positive**

- One picker, four sources: structural levels, policy-driven roles, and a free
  email escape hatch all resolve through the same confirmable UI.
- Reuses the existing M365 app registration — no new identity integration to
  stand up, just added Graph scopes.
- Schema-flexible HR upload accepts any spreadsheet and is useful immediately for
  search, with mapping layered on for resolution.
- Always-confirm keeps a human (and the audit log) on every routing decision.

**Negative**

- A federated directory with de-duplication and four adapters is more moving
  parts than a single column.
- Graph scopes (`Directory.Read.All`) are privileged and need tenant admin
  consent.
- A free-typed approver who has no account cannot act until one exists (the link
  redirects to login); account provisioning is deferred.

## Open questions

- **Onboarding a free-typed approver.** The link-behind-login decision means an
  approver without an account is blocked until one is created. Whether to
  auto-invite/provision on first use, or require an admin to add them, is left
  for a later phase.
- HR-upload mapping UX: auto-detect likely columns vs require explicit mapping
  before the dataset is usable for *resolution* (search works regardless).
- Whether `dynamic` ever needs more than band/role/unit to disambiguate (e.g.
  cost-centre) — start minimal.
