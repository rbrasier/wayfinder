# PRD — Off-System Approval Nomination

- **Status**: Accepted
- **Date**: 2026-09-02
- **Author**: Wayfinder team
- **Target version**: 0.33.0 (bump: MINOR — new feature plus an additive schema change)

## 1. Problem

An approval step stalls whenever the approval genuinely happened somewhere else
— a signed memo, an email from a delegate, a minuted committee decision, a
verbal sign-off recorded in the file note. Today the operator has exactly two
ways out: chase the approver until they log in, or withdraw the request and lose
the step. The first leaves sessions parked for days; the second throws away the
approval trail the product exists to keep.

The approval *did* happen. Wayfinder simply has no way to say so.

## 2. Users / Personas

- **Session operator** (procurement officer, HR manager, ops lead) — runs the
  flow, watches it park on an approval, and holds the evidence that the approval
  already happened. Needs the session to move without faking a decision.
- **Flow author** — designs the approval step. Needs to forbid off-system
  recording on the steps where only an in-system decision will do.
- **Auditor / reviewer** — reads the finished document and the record later.
  Needs to see, without digging, that a given signature was recorded off system,
  on what date, by whose nomination, and against what evidence.

## 3. Goals

- The operator can record that the assigned approver approved off system, and
  the session advances exactly as a normal approval does.
- Recording is impossible without both a filed evidence attachment and a
  confirmed approval date.
- The signature written into the document names the approver, carries a
  verification code, and states on its face that it was recorded off system.
- The flow author can disable off-system recording per approval step; it is
  enabled by default.
- The record distinguishes the date the approval happened from the moment it was
  entered into Wayfinder, and names the nominator separately from the approver.

## 4. Non-goals

- Verifying the evidence. Nothing parses, extracts from, or validates the file.
- Recording an off-system **rejection** or **change request**. Approval only.
- Multiple evidence files, or replacing evidence after the record is frozen.
- Any claim that this is a qualified or PKI signature. It remains an advanced
  electronic signature under ADR-043, with its provenance stated honestly.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| --- | --- | --- | --- |
| `Approval` | `packages/domain/src/entities/approval.ts` | existing — extended | Gains the six `offSystem*` fields and `OffSystemApprovalEvidence`. |
| `ApprovalNodeConfig` | `packages/domain/src/entities/flow-node.ts` | existing — extended | Gains `allowOffSystemApproval?: boolean` (absent means allowed). |
| `AttestationInput` | `packages/domain/src/entities/attestation-block.ts` | existing — extended | Gains `offSystemApprovedOn`, which changes the Decision and Date rows. |
| `ApprovalRecordInput` | `packages/domain/src/entities/approval-record.ts` | existing — extended | Gains the off-system keys frozen into `record_snapshot`. |
| `RecordOffSystemApproval` | `packages/application/src/use-cases/approvals/` | new | Owns its own authorisation; delegates the commit to the decision path. |

## 6. User stories

1. As an operator, when a session is awaiting approval and I hold the approver's
   signed memo, I can press **Approved off system**, attach the memo, confirm
   the date it was approved, and watch the session advance.
2. As an operator, I cannot record an off-system approval without attaching
   evidence and confirming a date — the button stays disabled until both exist.
3. As a flow author, I can uncheck "Allow recording approval that happened off
   system" in the approval step's Advanced section, and the button disappears
   for that step.
4. As an auditor reading the generated document, I can see that the signature
   block says `Approved (recorded off system)` and carries the date the approval
   actually happened.
5. As an auditor reading the approval record, I can download the filed evidence,
   see who nominated it, and see both the off-system date and the moment it was
   entered into Wayfinder.

## 7. Pages / surfaces affected

- Chat, awaiting-approval panel (`approver-picker.tsx`, `mode === "sent"`) — new
  **Approved off system** action and its modal.
- Canvas, approval node config modal, Advanced disclosure — new checkbox.
- `/approvals` queue, decision modal, and the approval detail page — an "Off
  system" chip beside the outcome, with the evidence as a download link.
- tRPC: `approval.recordOffSystem` (new mutation), `approval.listPending` /
  `listDecided` / `getById` (widened output).
- `GET /api/approvals/[approvalId]/evidence` — new authenticated download route.

## 8. Database changes

| Table | Change | Prefix valid? |
| --- | --- | --- |
| `app_session_approvals` | add `off_system_approved_on date` | n/a (existing `app_`) |
| `app_session_approvals` | add `off_system_evidence_filename text` | n/a |
| `app_session_approvals` | add `off_system_evidence_mime_type text` | n/a |
| `app_session_approvals` | add `off_system_evidence_size_bytes integer` | n/a |
| `app_session_approvals` | add `off_system_evidence_storage_path text` | n/a |
| `app_session_approvals` | add `off_system_nominated_by_user_id uuid` (FK → `core_users`, `ON DELETE SET NULL`) | n/a |

All six are nullable and additive. No `DROP`, no `SET NOT NULL`, no unique
index, no type change — so the migration carries no `-- data-impact:`
declaration under `migration-safety.test.ts`.

Evidence bytes go to the existing MinIO bucket through `IObjectStorage`, keyed
`approval-evidence/<approvalId>/<timestamp>-<safe-filename>`. Deliberately not
`app_session_uploads`: rows there are extracted into the session's AI context,
and a governance artefact must never become prompt input.

## 9. Architectural decisions

- Assumes ADR-018 (approval step and approver resolution), ADR-040 (approval
  subject and the decision-time snapshot), ADR-043 (signature slot and the
  attestation block), ADR-045 (approver field editing, and the rule that
  `approved_with_edits` is derived and never claimed).
- Introduces **ADR-055 — Off-System Approval Nomination**: who may nominate, why
  the decision is recorded against the approver rather than the nominator, and
  how the attestation block states its own provenance.

## 10. Acceptance criteria

- [ ] `allowOffSystemApproval` absent or `true` shows the button; `false` hides
      it and the server rejects the mutation with `FORBIDDEN`.
- [ ] Nomination without evidence, or without a date, fails
      `VALIDATION_FAILED` and writes nothing — no row change, no stored object.
- [ ] A future date, or a date before the request was raised, fails
      `VALIDATION_FAILED`.
- [ ] Only the session owner, the row's requester, or an admin may nominate;
      anyone else gets `FORBIDDEN`.
- [ ] A nomination on a non-`pending` row fails, and a real decision landing
      first wins the race.
- [ ] The recorded status is `approved` — never `approved_with_edits`.
- [ ] `decidedByUserId` is the assigned approver's id, or null on an email-only
      assignment, and never the nominator's.
- [ ] The attestation block reads `Approved (recorded off system)` and renders
      the off-system date as `DD-MM-YYYY` with no clock time.
- [ ] `record_snapshot` carries `<step_key>.off_system_approved_on`,
      `.off_system_evidence` and `.recorded_at`.
- [ ] The session advances, the decision message posts, the signature is written
      and the approver is notified, exactly as an in-system approval does.
- [ ] An `approval.recorded_off_system` audit entry names the nominator.
- [ ] The evidence route refuses a caller who cannot see the approval.

## 11. Out of scope / future work

- Evidence verification, virus scanning, or content extraction.
- Off-system rejection and change request.
- Bulk nomination across several parked sessions.
- An admin report of every off-system approval in a period — the record keys
  exist for it, but no surface is built here.

## 12. Risks / open questions

- Recording an approval on someone else's behalf is the feature's point and also
  its abuse surface. Mitigated by the per-node switch, the three-way gate,
  mandatory evidence, and a dedicated audit action naming the nominator.
- The attestation hash gains a field. Only off-system records include it, and
  decided records are read back never recomputed (ADR-043 §6), so existing
  verification codes are unaffected — but nothing may start recomputing them.
- An email-only assignment has no user row, so the block must fall back to
  `approverEmail` or it renders "Unknown approver".
