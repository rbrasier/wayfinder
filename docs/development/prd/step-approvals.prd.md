# PRD — Step Approvals

- **Status**: Draft
- **Date**: 2026-06-03
- **Author**: Richy Brasier
- **Target version**: 1.24.0  (bump: **MINOR** — new node type, new tables, new
  domain ports; additive)

## 1. Problem

Document-heavy processes routinely reach a point where work cannot proceed until
the right authority signs off. Sometimes that authority is the operator's own
manager; often it is a *policy-defined* role (e.g. "the SES Band 1 delegate per
the Delegations Instrument"). Today a Wayfinder flow advances through every node
automatically; there is no way to pause a flow, route it to the correct person,
and continue only once they approve. The `pending_approval` status exists in the
`INodeExecutor` contract and the n8n webhook schema but is unused (ADR-010).

## 2. Users / Personas

- **Operator** — runs a flow; needs to submit a step for approval, confirm/adjust
  who it goes to, and see where it is.
- **Approver** — the confirmed authority; needs an inbox of pending requests and a
  way to approve, reject, or request changes with a comment.
- **Flow author** — designs the flow; needs to drop an approval step on the canvas
  and pick *how* the approver is resolved.
- **Administrator** — maintains org/HR data so resolution works; uploads an HR
  spreadsheet and (optionally) maps its columns.

## 3. Goals

- A flow author can place an **`approval` node** and choose an `approverSource`
  from a dropdown: **first-level supervisor**, **second-level supervisor**, or
  **dynamic** (resolved from policy/context).
- When a session reaches the node it **pauses** and does not advance until a
  decision is recorded.
- The resolver only ever **suggests** an approver; for *every* mode the operator
  **must confirm**, and can always choose **"Someone else"** via type-ahead
  auto-suggest.
- Auto-suggest federates **three sources** — Microsoft Entra (Graph), an
  uploaded HR dataset, and any free-text email address.
- Administrators can **upload an HR file (CSV/XLSX)** in configuration, stored in
  the structure it was uploaded (original columns preserved), with a column
  mapping for resolution.
- The approver is notified by email; decisions are audited in `core_audit_log`.
- On approval, the approved record snapshot is recorded for the
  record-regeneration procedure (Scheduling PRD).

## 4. Non-goals

- Multi-stage / parallel approval chains or quorum (single approver per node).
- Delegation / out-of-office routing.
- Building the org chart; we sync hierarchy from Entra and accept an HR upload,
  but do not provide org-management CRUD.
- Two-way HR sync or writing back to Entra/HR systems.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Approval` | `packages/domain/src/entities/approval.ts` | new | Request + suggestion + decision. |
| `FlowNode` (type `approval`) | `packages/domain/src/entities/flow-node.ts` | existing | Add `approval` to union + `ApprovalNodeConfig`. |
| `IApprovalRepository` | `packages/domain/src/ports/approval-repository.ts` | new | CRUD + `listPendingForApprover`. |
| `IPeopleDirectory` | `packages/domain/src/ports/people-directory.ts` | new | Federated people search (Entra + HR + email). |
| `IReportingLineResolver` | `packages/domain/src/ports/reporting-line-resolver.ts` | new | Walks N levels; returns a *suggestion*. |
| `HrDataset` / `HrRow` | `packages/domain/src/entities/hr-dataset.ts` | new | Uploaded spreadsheet + raw rows. |
| `IHrDatasetRepository` | `packages/domain/src/ports/hr-dataset-repository.ts` | new | Store dataset + rows + mapping; search. |

## 6. User stories

1. As a flow author, I pick the approver source from a dropdown so the flow halts
   for the right kind of sign-off.
2. As an operator, when I reach an approval node I'm shown a *suggested* approver
   and must confirm or choose someone else before it's sent.
3. As an operator, when I choose "Someone else" I can search my org (Entra), the
   uploaded HR list, or just type any email address.
4. As an administrator, I upload our HR spreadsheet and it's usable for search
   immediately, with a mapping for first/second-level resolution.
5. As an approver, I see requests awaiting me and can approve, reject, or request
   changes with a comment.
6. As an operator, approval advances the flow; changes-requested shows me the
   feedback to revise.

## 7. Pages / surfaces affected

- `/approvals` (web) — approver inbox.
- `/admin/settings` (web) — HR file upload, detected-column review, mapping, and
  Entra/Graph configuration are surfaced here as modals, following the existing
  admin settings pattern (no standalone `/admin/hr` page).
- Flow canvas — `approval` node with the `approverSource` dropdown + config.
- Session chat — a "confirm approver" card (suggestion + "Someone else"
  auto-suggest), then "awaiting approval" / decision result.
- tRPC: `approval.suggest`, `approval.confirmAndSend`, `approval.decide`,
  `people.search`, `hr.upload`, `hr.setMapping` — new.
- `apps/api` — no new external route; approvals are in-app.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_approvals` | NEW | yes (app_) |
| `admin_hr_datasets` | NEW | yes (admin_) |
| `admin_hr_rows` | NEW | yes (admin_) |
| `app_flow_nodes` | no schema change; `type` gains `approval`, `config` gains approval shape (JSONB) | n/a |

**`app_session_approvals`**: `id`, `session_id`, `flow_id`, `node_id`,
`message_id` (nullable), `requested_by_user_id`, `approver_source`
(`first_level_supervisor`|`second_level_supervisor`|`dynamic`),
`suggested_approver_user_id` (nullable), `approver_user_id` (nullable, the
confirmed user), `approver_email` (text — for a free-typed address),
`is_override` (bool — operator chose someone other than the suggestion),
`status` (`pending`|`approved`|`rejected`|`changes_requested`),
`decided_by_user_id` (nullable), `decided_at` (nullable), `comment` (nullable),
`record_snapshot` (jsonb), `created_at`, `updated_at`. Index on
`(approver_user_id, status)` for the inbox.

**`admin_hr_datasets`**: `id`, `filename`, `source_format` (`csv`|`xlsx`),
`uploaded_by_user_id`, `columns` (jsonb — original headers), `column_mapping`
(jsonb — header → email/name/manager/position/band/unit), `row_count`,
`status` (`active`|`archived`), `created_at`, `updated_at`.

**`admin_hr_rows`**: `id`, `dataset_id` FK, `row_index`, `data` (jsonb — the row
keyed by original headers), `created_at`, `updated_at`. GIN index on `data` for
search.

The earlier `core_users.supervisor_user_id` column is **dropped** from scope —
hierarchy comes from Entra/HR and every route is operator-confirmed (ADR-018).

## 9. Architectural decisions

- **ADR-018 — Approval step type & approver resolution** (rewritten): approval as
  a node type; `approverSource` dropdown; suggest-then-always-confirm; the
  federated `IPeopleDirectory` over Entra + HR upload + free email; schema-as-
  uploaded HR storage with a mapping; the `dynamic` (policy + RAG + lookup) flow.
- Assumes ADR-010 (`pending_approval`), ADR-016/017 (RAG over `kb_`), and the
  Email Notifications `INotificationSender` + M365 app registration.
- Hands the approved snapshot to the Scheduling record-regeneration procedure.

## 10. Acceptance criteria

- [ ] An `approval` node with an `approverSource` dropdown can be added and saved.
- [ ] Reaching the node creates a `pending` row, computes a *suggestion*, and the
      session does not advance.
- [ ] The operator must confirm; choosing "Someone else" searches Entra + HR +
      accepts any typed email; overrides set `is_override`.
- [ ] First/second-level suggestions come from Entra (HR upload as fallback);
      `dynamic` retrieves the policy clause and proposes the position holder.
- [ ] Admin can upload a CSV/XLSX; rows are stored as-uploaded and searchable;
      a column mapping can be set.
- [ ] Approve advances + snapshots; reject/changes surface the comment and hold.
- [ ] Approver emailed on request; requester emailed on decision; audit on both.
- [ ] No double-decision; deciding an already-decided approval is rejected.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.

## 11. Out of scope / future work

- Multi-stage chains, quorum, delegation.
- Auto-detecting HR column mappings (manual mapping for v1).
- Auto-inviting / provisioning a free-typed approver who has no account (see §12).
- Scheduled HR re-import / live HR sync.

## 12. Risks / open questions

- **Free-typed approver with no account.** Every approver gets the same in-app
  link; an unauthenticated recipient is redirected to login (no magic-link, no
  approve-by-email). So a typed email with no account cannot act until one
  exists — auto-invite vs admin-add is deferred (ADR-018).
- **Graph scopes.** `Directory.Read.All` is privileged and needs tenant admin
  consent; until granted, resolution falls back to the HR upload / manual pick.
- HR mapping UX: require explicit mapping before a dataset is usable for
  resolution (search works regardless of mapping).
- Flow edited under an open approval — mitigated by `record_snapshot`.
