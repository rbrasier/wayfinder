# Phase — Off-System Approval Nomination

- **Status**: Ready to build
- **Target version**: **MINOR** — 0.32.3 → **0.33.0** (new feature + additive schema change)
- **PRD**: `docs/development/prd/off-system-approval.prd.md`
- **ADR**: `docs/development/adr/055-off-system-approval-nomination.adr.md`
- **Depends on**: ADR-018 (approval step), ADR-040 (subject + decision-time
  snapshot), ADR-043 (signature slot + attestation block), ADR-045 (derived
  `approved_with_edits`)
- **Base branch**: `main`

## 1. Goal

Let the session owner, the request's originator, or an admin record that the
assigned approver already approved off system — backed by a filed evidence
attachment and a confirmed approval date — so the session advances with an
honest, evidenced record instead of stalling or being withdrawn.

## 2. Approach

There is **one writer of an approval decision** and it stays that way.
`DecideApproval` already owns the atomic commit, the session advance, the
projection, the chat message, the signature write and the notification. Rather
than duplicating any of that, it gains an optional `offSystem` nomination on its
input, which changes four things inside it and nothing else:

1. **Authorisation** — the off-system branch authorises the *nominator* (session
   owner, requester, or admin) instead of matching the decider to the approver.
   Keeping it inside `isAuthorisedDecider` means there is no way to pass
   `offSystem` and skip a gate.
2. **Who is recorded** — `decidedByUserId` is written as the approval's
   `approverUserId` (null on an email-only assignment), never the nominator's
   id. Identity for the record and the block resolves from that user, falling
   back to the row's `approverEmail`.
3. **Status derivation** — the approver-edit scan is skipped, so the status is
   plain `approved` and a nominator's edits are never attributed to the approver.
4. **What is frozen** — the evidence columns are written in the same
   `updateIfPending` patch as the decision, and the record and attestation carry
   the off-system date.

`RecordOffSystemApproval` sits in front of it and owns only what is specific to
this path: the node's `allowOffSystemApproval` switch, date validation, storing
the evidence bytes, the `approval.recorded_off_system` audit entry, and
best-effort cleanup of the stored object if the decision loses the pending race.

## 3. What is built

### `packages/domain`

| File | Change |
|---|---|
| `entities/approval.ts` | Add `OffSystemApprovalEvidence`; add `offSystemApprovedOn`, `offSystemEvidence*`, `offSystemNominatedByUserId` to `Approval` and `ApprovalUpdate`. Add `isOffSystemApproval(approval)`. |
| `entities/flow-node.ts` | Add `ApprovalNodeConfig.allowOffSystemApproval?: boolean`. |
| `entities/approval-record.ts` | Add `offSystemApprovalAllowed(config)` (absent ⇒ `true`). Add `offSystemApprovedOn`, `offSystemEvidenceFilename`, `recordedAt` to `ApprovalRecordInput`, frozen as `<step_key>.off_system_approved_on`, `.off_system_evidence`, `.recorded_at`. |
| `entities/attestation-block.ts` | Add `offSystemApprovedOn: string \| null` to `AttestationInput`; Decision row renders `Approved (recorded off system)`, Date row renders the off-system date as `DD-MM-YYYY` with no time. It joins the canonical hash string. |
| `entities/approval-decision-message.ts` | Add `offSystemApprovedOn`; the outcome line reads "Approval granted — recorded off system (approved on DD-MM-YYYY)." |
| `entities/off-system-approval.ts` *(new)* | `offSystemDateError(approvedOn, requestedAt, now)` — the pure date rule: parseable, not in the future, not before the request was raised. |

### `packages/application`

| File | Change |
|---|---|
| `use-cases/approvals/decide-approval.ts` | Add `offSystem?: OffSystemNomination` to the input; the four behaviours in §2. |
| `use-cases/approvals/record-off-system-approval.ts` *(new)* | Config gate, date validation, evidence storage, delegation to `DecideApproval`, audit entry, orphan cleanup. |
| `use-cases/approvals/list-approvals-with-context.ts` | Surface the off-system fields on the context rows the queue, modal and detail page read. |
| `use-cases/approvals/index.ts` | Export the new use case and its types. |

### `packages/adapters`

| File | Change |
|---|---|
| `db/schema/wayfinder.ts` | Six new nullable columns on `app_session_approvals`, with the nominator FK declared by explicit name (the 63-character reason that already applies to `suggested_approver_user_id`). |
| `repositories/drizzle-approval-repository.ts` | Map the columns in `toEntity` and in the `update` / `updateIfPending` patches. |
| `drizzle/<generated>.sql` | Generated migration. |

### `apps/web`

| File | Change |
|---|---|
| `server/routers/approval.ts` | New `recordOffSystem` mutation: `approvalId`, `approvedOn` (ISO date), `comment`, `evidenceFilename`, `evidenceMimeType`, `evidenceContentBase64`. Publishes `session.updated` like `decide` does. |
| `app/api/approvals/[approvalId]/evidence/route.ts` *(new)* | Authenticated download, reusing the approval's own read authorisation. |
| `components/chat/off-system-approval-dialog.tsx` *(new)* | The modal: required file, required date, optional note. |
| `components/chat/approver-picker.tsx` | The **Approved off system** action in the sent-state row, and the dialog. |
| `components/chat/sent-approval-actions.ts` | `canNominateOffSystem`, gated on owner/requester/admin **and** `offSystemAllowed`. |
| `components/chat/approval-gate.tsx` | Thread `offSystemAllowed` from the node config to the picker. |
| `components/canvas/node-config-modal-approval.tsx` | The Advanced checkbox, checked by default. |
| `components/canvas/approval-config-mapping.ts` + `node-config-modal.tsx` | `allowOffSystemApproval` in `NodeConfigValues`, encode/decode with absent ⇒ allowed. |
| `components/approvals/approval-parts.tsx` | "Off system" chip and evidence download link on the decided surfaces. |

## 4. Database changes

One generated migration, additive only:

```sql
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_approved_on" date;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_filename" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_mime_type" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_size_bytes" integer;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_storage_path" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_nominated_by_user_id" uuid;
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_off_system_nominated_by_user_id_fk" ...;
```

All nullable, no `DROP`, no `SET NOT NULL`, no unique index, no type change — so
**no `-- data-impact:` declaration is required**. `migration-safety.test.ts`
must pass unchanged.

Evidence bytes: `IObjectStorage.put("approval-evidence/<approvalId>/<timestamp>-<safe-filename>", …)`.
No new port, no new bucket, and deliberately not `app_session_uploads`
(ADR-055 §7).

## 5. Implementation order

Each sub-component is tests-first, and `./validate.sh` must exit 0 before the
next one starts.

1. **Domain rules** — `off-system-approval.ts` (date rule),
   `offSystemApprovalAllowed`, `Approval` / `ApprovalNodeConfig` fields.
2. **Attestation, record & message** — the block's two changed rows, the frozen
   record keys, the decision message line.
3. **Persistence** — schema columns, repository mapping, generated migration.
4. **Decision path** — `DecideApproval`'s `offSystem` branch.
5. **Use case** — `RecordOffSystemApproval` and its container wiring.
6. **Transport** — the tRPC mutation and the evidence route.
7. **UI** — the sent-state action, the dialog, the Advanced checkbox, the
   decided-surface chip.

## 6. Tests

Written before each implementation file.

| Layer | File | Covers |
|---|---|---|
| domain | `off-system-approval.test.ts` | Future date, pre-request date, unparseable date, valid date. |
| domain | `attestation-block.test.ts` (extend) | Decision row reads `Approved (recorded off system)`; Date row is date-only; the code differs from the same input without the flag; in-system blocks are byte-identical to today. |
| domain | `approval-record.test.ts` (extend) | The three new keys; `offSystemApprovalAllowed` absent ⇒ `true`. |
| domain | `approval-decision-message.test.ts` (extend) | The off-system outcome line. |
| application | `record-off-system-approval.test.ts` (new) | Happy path; missing evidence; missing/invalid date; node switch off ⇒ `FORBIDDEN`; wrong nominator ⇒ `FORBIDDEN`; already-decided row; email-only assignment; orphan cleanup on a lost race. |
| application | `decide-approval.test.ts` (extend) | `decidedByUserId` is the approver, not the nominator; status is `approved`, never `approved_with_edits`; the evidence columns commit with the decision. |
| adapters | `drizzle-approval-repository.test.ts` (extend) | Round-trip of the six columns through `update` and `updateIfPending`. |
| apps/web | `sent-approval-actions.test.ts` (extend) | `canNominateOffSystem` across owner / requester / admin / other, and with the switch off. |
| apps/web | `approval-node-config.test.ts` (extend) | Encode/decode of `allowOffSystemApproval`, absent ⇒ checked. |
| apps/web | `server/routers/approval.test.ts` (extend) | The mutation's authorisation and validation shapes. |

**E2E:** qualifies under group 3 of `docs/guides/e2e-test-policy.md` — file
upload and download cross the browser boundary. One spec covering the happy path
(park a session on an approval, nominate off system with an attached file,
assert the session advances and the evidence is downloadable) and one
user-visible error path (submit with no file ⇒ blocked). Everything else —
authorisation, date rules, record contents, block rendering — is covered at the
layers above and must not be re-tested through the browser.

## 7. Risks

- The attestation hash gains a field. Only off-system records carry it, and
  decided records are read back never recomputed (ADR-043 §6) — the extended
  test asserts in-system blocks are unchanged.
- Evidence bytes are stored before the decision commits, so a lost pending race
  can orphan an object. Cleanup is best-effort and the object is unreferenced.
- An email-only assignment leaves `decided_by_user_id` null; the block must fall
  back to `approverEmail` or it renders "Unknown approver".
- The evidence route is a new read surface over governed data and must reuse the
  approval's own authorisation, not a session-level one.

## 8. Out of scope

Evidence verification or scanning; off-system rejection and change request;
multiple or replaceable evidence files; a cross-session off-system report.

---

## Approved build summary (Step 0 / Step 1, approved 2026-09-02)

`DecideApproval` stays the only writer of an approval decision. It gains an
optional `offSystem` nomination on its input that changes four things inside it
— who is authorised, who is recorded as deciding, whether the approver-edit scan
runs, and what gets frozen — and nothing else. A new `RecordOffSystemApproval`
sits in front owning only the per-node switch, the date rule, the evidence bytes
and the audit entry. The panel gains an **Approved off system** button, the
node's Advanced section gains a checkbox that is on by default, and the
signature block says `Approved (recorded off system)` over the real approval
date.

**Build order (each sub-component tests-first, `./validate.sh` green before the next):**

1. Domain rules — `off-system-approval.ts`, `offSystemApprovalAllowed`, entity fields.
2. Attestation, record & message — the two changed block rows, the frozen keys, the message line.
3. Persistence — schema columns, repository mapping, generated migration.
4. Decision path — `DecideApproval`'s `offSystem` branch.
5. Use case + wiring — `RecordOffSystemApproval`, exports, container.
6. Transport — the tRPC mutation and the evidence download route.
7. Config UI — the Advanced checkbox and its encode/decode.
8. Panel UI — the dialog, the sent-state action, the gate threading.
9. Decided surfaces — the "Off system" chip and evidence link.
10. E2E — `phase-off-system-approval.spec.ts` (group 3: file upload/download), written not run.

**Version:** MINOR, 0.32.3 → 0.33.0. **Branch:** `claude/off-system-approval-nomination-3wksb3`. **PR target:** `main`.
