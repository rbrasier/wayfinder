# Phase — Step Approvals

- **Status**: Implemented (v1.37.0)
- **Target version**: 1.37.0 (bump: **MINOR** — new node type, new tables, new
  domain ports)
- **PRD**: `docs/development/prd/step-approvals.prd.md`
- **ADR**: `docs/development/adr/018-approval-step-and-approver-resolution.adr.md`
- **Depends on**: ADR-010 (`pending_approval`), ADR-016/017 (RAG over `kb_`),
  Email Notifications / ADR-023 (`IEmailSender` + `app_notification_log` outbox +
  M365 app registration)

## 1. Goal

A dedicated `approval` node that pauses a flow until a *confirmed* approver
decides. The approver is resolved by a dropdown mode — first-level supervisor,
second-level supervisor, or dynamic (policy-driven) — but is only ever
*suggested*: the operator always confirms and may pick "Someone else" via
type-ahead over Entra, an uploaded HR dataset, or any typed email.

## 2. Approach

Hexagonal, gate-on-pending, suggest-then-confirm:

1. `approval` joins the `FlowNode` union with an `ApprovalNodeConfig`
   (`approverSource`, `roleHint?`, `instructions?`).
2. Reaching the node yields `status: 'pending_approval'`, writes a `pending`
   `app_session_approvals` row with a *suggested* approver, and holds the
   session.
3. `IReportingLineResolver.suggest` walks Entra (HR upload fallback) for
   first/second level; `dynamic` retrieves the policy clause from `kb_` (RAG) and
   calls a position lookup.
4. The operator confirms or overrides via `IPeopleDirectory.search` (federated
   Entra + HR + free email). Only the confirmed identity is sent.
5. A decision use-case advances or routes back, snapshots on approve, audits,
   enqueues notifications, and writes the outcome + `decided_at` (plus
   `decided_by` and `comment`) onto the approval node's step-output metadata as a
   denormalised projection for reporting. The `app_session_approvals` row remains
   the source of truth.

See ADR-018.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/approval.ts` | New `Approval` (suggestion + confirmed approver + decision). |
| domain | `packages/domain/src/entities/flow-node.ts` | Add `approval` to union + `ApprovalNodeConfig`. |
| domain | `packages/domain/src/entities/hr-dataset.ts` | New `HrDataset` + `HrRow`. |
| domain | `packages/domain/src/ports/approval-repository.ts` | New `IApprovalRepository`. |
| domain | `packages/domain/src/ports/people-directory.ts` | New `IPeopleDirectory` (federated search). |
| domain | `packages/domain/src/ports/reporting-line-resolver.ts` | New `IReportingLineResolver.suggest`. |
| domain | `packages/domain/src/ports/hr-dataset-repository.ts` | New `IHrDatasetRepository`. |
| application | `packages/application/src/use-cases/approvals/suggest-approver.ts` | Compute suggestion by `approverSource`. |
| application | `packages/application/src/use-cases/approvals/confirm-and-send.ts` | Persist confirmed/override approver; notify. |
| application | `packages/application/src/use-cases/approvals/decide-approval.ts` | approve/reject/changes; advance or route back; audit + notify; project outcome + `decided_at`/`decided_by`/`comment` onto step-output metadata for reporting. |
| application | `packages/application/src/use-cases/approvals/list-pending-approvals.ts` | Approver inbox. |
| application | `packages/application/src/use-cases/people/search-people.ts` | Federate + de-dupe directory results. |
| application | `packages/application/src/use-cases/hr/import-hr-dataset.ts` | Parse upload → rows (as-is) + detected columns. |
| application | `packages/application/src/use-cases/hr/set-column-mapping.ts` | Persist header → field mapping. |
| adapters | `packages/adapters/src/repositories/drizzle-approval-repository.ts` | Persistence. |
| adapters | `packages/adapters/src/repositories/drizzle-hr-dataset-repository.ts` | Dataset + rows + GIN search. |
| adapters | `packages/adapters/src/directory/graph-people-directory.ts` | Entra/Graph search + manager chain. |
| adapters | `packages/adapters/src/directory/hr-people-directory.ts` | Search over `admin_hr_rows` via mapping. |
| adapters | `packages/adapters/src/directory/federated-people-directory.ts` | Merge Entra + HR; de-dupe by email. |
| adapters | `packages/adapters/src/directory/graph-reporting-line-resolver.ts` | `manager` chain; HR fallback. |
| adapters | `packages/adapters/src/hr/spreadsheet-parser.ts` | CSV/XLSX → rows (verify lib in `node_modules`). |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_session_approvals`. |
| adapters | `packages/adapters/src/db/schema/admin.ts` | New `admin_hr_datasets`, `admin_hr_rows`. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration. |
| apps/web | `apps/web/lib/container.ts` | Wire repos, directory, resolver, use-cases. |
| apps/web | `apps/web/.../trpc/routers/approval.ts` | `suggest`, `confirmAndSend`, `decide`, `listPending`. |
| apps/web | `apps/web/.../trpc/routers/people.ts` | `search`. |
| apps/web | `apps/web/.../trpc/routers/hr.ts` | `upload`, `setMapping`, `list`. |
| apps/web | `apps/web/src/app/(user)/approvals/page.tsx` | Approver inbox. |
| apps/web | `apps/web/src/app/(admin)/admin/settings/` | HR upload + column mapping + Entra/Graph config as modals on the existing admin settings page (no standalone `/admin/hr` page). |
| apps/web | session chat components | Confirm-approver card (suggestion + "Someone else" auto-suggest); decision card. |
| apps/web | canvas node config | `approval` node + `approverSource` dropdown. |
| apps/web | session-advance path | Halt on `pending_approval`; resume on approve. |

## 4. Database changes

### New table: `app_session_approvals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `session_id` | uuid FK → `app_sessions` | |
| `flow_id` | uuid FK → `app_flows` | |
| `node_id` | uuid FK → `app_flow_nodes` | the approval node |
| `message_id` | uuid | nullable |
| `requested_by_user_id` | uuid FK → `core_users` | |
| `approver_source` | text | `first_level_supervisor`\|`second_level_supervisor`\|`dynamic` |
| `suggested_approver_user_id` | uuid FK → `core_users` | nullable |
| `approver_user_id` | uuid FK → `core_users` | nullable; confirmed |
| `approver_email` | text | nullable; free-typed address |
| `is_override` | boolean | default false |
| `status` | text | `pending`\|`approved`\|`rejected`\|`changes_requested` |
| `decided_by_user_id` | uuid FK → `core_users` | nullable |
| `decided_at` | timestamptz | nullable |
| `comment` | text | nullable |
| `record_snapshot` | jsonb | step outputs under review |
| `created_at` / `updated_at` | timestamptz | |

Index on `(approver_user_id, status)` for the inbox.

### New table: `admin_hr_datasets`

`id`, `filename`, `source_format` (`csv`|`xlsx`), `uploaded_by_user_id`,
`columns` (jsonb — original headers), `column_mapping` (jsonb — header →
email/name/manager/position/band/unit), `row_count`, `status`
(`active`|`archived`), `created_at`, `updated_at`.

### New table: `admin_hr_rows`

`id`, `dataset_id` FK → `admin_hr_datasets`, `row_index`, `data` (jsonb — row
keyed by original headers), `created_at`, `updated_at`. GIN index on `data`.

No `core_users` change (the earlier `supervisor_user_id` is dropped from scope).

## 5. Notifications

New triggers via `IEmailSender` + the `app_notification_log` outbox (ADR-023):
`approval_requested` (→ approver), `approval_decided` (→ requester). The
triggering use-case writes a `pending` outbox row inside its own commit; the
send is best-effort and non-blocking; subject/body are composed as
application-layer string builders (no new `INotificationSender` port — ADR-023
reuses the existing mailer). The approver link is the same for everyone and routes to the
in-app approval; an unauthenticated recipient is redirected to login and returned
afterward. No magic-link / approve-by-email path. A confirmed `approver_email`
with no account cannot act until one exists (provisioning deferred — see §9).

## 6. Identity integration

Reuse the Email-Notifications **M365 app registration**; add Graph application
permissions `User.Read.All` + `Directory.Read.All` (tenant admin consent). New
env: none beyond the existing `M365_*`; document the added scopes in
`.env.example`. When scopes are absent, resolution degrades to HR upload / manual
pick.

## 7. Implementation order (tests first)

1. `admin_hr_datasets` + `admin_hr_rows` schema + migration; repository test
   (store-as-is + GIN search) → repository.
2. `spreadsheet-parser` test (CSV + XLSX → rows, headers preserved) → parser;
   `import-hr-dataset` / `set-column-mapping` use-case tests → use-cases.
3. `IPeopleDirectory` adapters: Graph + HR + federated de-dupe tests → adapters;
   `search-people` use-case test.
4. `IReportingLineResolver.suggest` test (Entra chain, HR fallback, unresolved) →
   `graph-reporting-line-resolver`.
5. `app_session_approvals` schema + migration; repository test → repository.
6. `suggest-approver` / `confirm-and-send` / `decide-approval` use-case tests
   (per-mode suggestion, mandatory confirm, override flag, free email,
   no double-decision, advance vs route-back) → use-cases.
7. Halt-on-`pending_approval` in the advance path; resume on approve.
8. tRPC routers + approvals inbox + `/admin/settings` HR/Entra modals +
   confirm-approver chat card + canvas node config.

Write the test file before each implementation file (CLAUDE.md rule).

## 8. ADR required

ADR-018 (rewritten) — approval node type; `approverSource` dropdown;
suggest-then-always-confirm; federated `IPeopleDirectory` (Entra + HR + email);
schema-as-uploaded HR storage with mapping; `dynamic` policy/RAG/lookup flow.
Open question carried in the ADR: magic-link approvals for non-user approvers.

## 9. Risks / open questions

Carried from PRD §12: provisioning a free-typed approver who has no account (the
link redirects to login; auto-invite vs admin-add deferred), Graph
`Directory.Read.All` admin consent, HR mapping-before-resolution UX, and
flow-edit-under-an-open-approval (mitigated by `record_snapshot`).

## 10. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] `approval` node + `approverSource` dropdown configurable and saveable;
      reaching it halts the session and writes a `pending` row with a suggestion.
- [ ] Operator must confirm; "Someone else" searches Entra + HR + accepts any
      typed email; override sets `is_override`.
- [ ] First/second-level from Entra (HR fallback); `dynamic` retrieves policy and
      proposes the holder.
- [ ] CSV/XLSX upload stored as-uploaded, searchable; mapping settable.
- [ ] Approve advances + snapshots; reject/changes surface comment and hold.
- [ ] On decision, the approval node's step-output metadata reflects the outcome
      and `decided_at` (and `decided_by`/`comment`) for reporting.
- [ ] Email on request and decision; audit on both; no double-decision.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
