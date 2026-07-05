# Implementation Summary — Step Approvals (v1.37.0)

- **Version bump**: **MINOR** (1.36.0 → 1.37.0) — new node type, new tables, new
  domain ports; additive.
- **Phase doc**: `step-approvals.phase.md` (this directory)
- **PRD**: `docs/development/prd/step-approvals.prd.md`
- **ADR**: `docs/development/adr/018-approval-step-and-approver-resolution.adr.md`

## What was built

A first-class `approval` flow node that pauses a session until a *confirmed*
approver decides. The approver is *suggested* by a dropdown-selected mode
(first/second-level supervisor, or dynamic/policy-driven) and the operator always
confirms or overrides via a federated people search (Entra + uploaded HR + free
email). Decisions (approve / reject / request-changes) advance or hold the
session, snapshot the record on approve, audit, notify by email, and project the
outcome onto the node's step-output metadata for reporting.

### Domain (`packages/domain`)
- `entities/approval.ts` — `Approval`, `NewApproval`, `ApprovalUpdate`,
  `ApproverSource`, `ApprovalStatus`, `ApprovalDecision`.
- `entities/person.ts` — `Person` (federated directory record).
- `entities/hr-dataset.ts` — `HrDataset`, `HrRow`, `HrColumnMapping`, `HrFieldKind`.
- `entities/flow-node.ts` — `approval` added to `FlowNodeType`; `ApprovalNodeConfig`.
- `entities/notification-log.ts` — `approval_requested` / `approval_decided`
  triggers and the `approval` resource type.
- Ports: `approval-repository.ts`, `people-directory.ts`,
  `reporting-line-resolver.ts`, `hr-dataset-repository.ts`, `spreadsheet-parser.ts`.

### Application (`packages/application`)
- `use-cases/approvals/` — `suggest-approver` (idempotent pending row + suggestion),
  `confirm-and-send` (persist confirmed/override approver + notify),
  `decide-approval` (approve/reject/changes; advance or hold; snapshot; audit;
  notify; project outcome/decided-at/decided-by/comment onto step-output metadata),
  `list-pending-approvals`.
- `use-cases/people/` — `search-people` + `merge-people` (federate + de-dupe by
  email; free-typed email escape hatch).
- `use-cases/hr/` — `import-hr-dataset` (parse → store as-uploaded),
  `set-column-mapping`.
- `use-cases/notifications/` — `approval-templates`, `notify-on-approval-requested`,
  `notify-on-approval-decided` (reuse the `IEmailSender` + `app_notification_log`
  outbox; best-effort, fire-and-forget).

### Adapters (`packages/adapters`)
- Repositories: `drizzle-approval-repository`, `drizzle-hr-dataset-repository`
  (GIN-backed jsonb search).
- Directory: `graph-client`, `graph-people-directory`, `hr-people-directory`,
  `graph-reporting-line-resolver` (Graph manager chain with HR fallback +
  `findPositionHolder`). Injectable `fetch` for unit testing.
- `hr/spreadsheet-parser` — CSV (hand-parsed, quote-aware) + XLSX (via PizZip,
  already a dependency — no SheetJS added).
- Schema: `app_session_approvals` (wayfinder.ts), `admin_hr_datasets` +
  `admin_hr_rows` (admin.ts); `app_flow_nodes.type` and
  `app_notification_log.trigger/resource_type` enums extended.

### Web (`apps/web`)
- `lib/container.ts` — wired repos, directory, resolver, parser, notifiers, and
  use-cases. Graph config read from existing `M365_*` env (degrades to HR/manual).
- tRPC routers: `approval` (suggest/confirmAndSend/decide/listPending),
  `people` (search), `hr` (list/upload/setMapping); registered in `router.ts`.
- Canvas: `approval-node.tsx`; `approval` added to the node-type picker, config
  modal (approverSource dropdown + role hint + instructions), node styles,
  defaults, and both flow editors (admin + user).
- `app/(user)/approvals/` — approver inbox with approve/reject/request-changes.
- `components/chat/approval-gate.tsx` — operator confirm-approver card (suggestion
  + "Someone else" federated search), wired into the session chat; composer
  disabled while parked on an approval node.
- Admin settings: HR Directory upload + column-mapping modal, and an Entra/Graph
  status card.
- Sidebar: Approvals link.

## Migrations
- `packages/adapters/drizzle/0022_empty_misty_knight.sql` — creates
  `admin_hr_datasets`, `admin_hr_rows` (+ GIN index on `data`), and
  `app_session_approvals` (+ index on `(approver_user_id, status)` and
  `(session_id)`). Generated via `drizzle-kit generate`; journal/snapshots updated.

## Tests
- Unit (vitest): people merge/search, HR import + mapping, approval suggest /
  confirm-and-send / decide (advance, hold, no-double-decision, forbidden) /
  list-pending, spreadsheet parser (CSV + XLSX), directory adapters (HR mapping,
  Graph mapping via fake fetch, reporting-line HR fallback + position holder).
- E2E (Playwright): `tests/e2e/phase-step-approvals.spec.ts` — approvals inbox
  loads, admin HR/Entra cards render, an `approval` node persists with its
  `approverSource`, and deciding a non-existent approval is a client-visible
  error. (Runs in CI against a live app + DB; skips gracefully without seed /
  TEST_AUTH_BYPASS.)

## Known limitations / deferred
- **Dynamic (`dynamic`) resolution** uses the node's `roleHint` against the HR
  position lookup; full RAG retrieval of the governing policy clause from `kb_`
  is deferred (the port shape supports layering it on without API changes).
- **Free-typed approver with no account** is recorded but cannot act until an
  account exists; auto-invite/provisioning is deferred (carried open question).
- **Graph `Directory.Read.All`** needs tenant admin consent; until granted,
  resolution degrades to the HR upload / manual pick.
- **Reject / changes-requested holds** the session at the node (comment surfaced);
  automatic route-back along a dedicated edge is not implemented this phase.
- HR column mapping is manual (no auto-detection), per PRD §11.
