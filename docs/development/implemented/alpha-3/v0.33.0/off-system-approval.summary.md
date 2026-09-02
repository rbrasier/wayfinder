# Implementation Summary — Off-System Approval Nomination

- **Version**: 0.32.3 → **0.33.0** (MINOR — new feature plus an additive schema change)
- **Phase doc**: `off-system-approval.phase.md` (this folder)
- **PRD**: `docs/development/prd/off-system-approval.prd.md`
- **ADR**: `docs/development/adr/055-off-system-approval-nomination.adr.md`
- **Branch**: `claude/off-system-approval-nomination-3wksb3` → `main`

## What was built

The session owner, the request's originator, or an admin can record that the
assigned approver already approved outside Wayfinder, backed by an uploaded
evidence file and a confirmed approval date. The session then advances exactly
as an in-system approval does.

`DecideApproval` remains the only writer of an approval decision. It gained an
optional `offSystem` nomination on its input that changes four things and
nothing else:

1. **Authorisation** — the off-system branch authorises the *nominator* (session
   owner, requester, or admin) rather than matching the decider to the approver.
   It lives inside `isAuthorisedDecider`, so supplying `offSystem` can never be a
   route past a gate.
2. **Who is recorded** — `decided_by_user_id` is written as the approval's
   `approver_user_id` (null on an email-only assignment), never the nominator's.
   Identity resolves from that user and falls back to the row's `approver_email`.
3. **Status derivation** — the approver-edit scan is skipped, so the status is
   always plain `approved` and a nominator's edits are never attributed to the
   approver (ADR-045 §4, ADR-055 §5).
4. **What is frozen** — the evidence columns are written in the same
   `updateIfPending` patch as the decision, and the record and attestation carry
   the off-system date.

`RecordOffSystemApproval` sits in front and owns only what is specific to this
path: the node's `allowOffSystemApproval` switch, date validation, storing the
evidence bytes, the `approval.recorded_off_system` audit entry, and best-effort
cleanup of the stored object when the decision is refused or loses the pending
race.

## Files created

| Layer | File |
|---|---|
| domain | `packages/domain/src/entities/off-system-approval.ts` (+ `.test.ts`) |
| application | `packages/application/src/use-cases/approvals/record-off-system-approval.ts` (+ `.test.ts`) |
| application | `packages/application/src/use-cases/approvals/decide-approval-off-system.test.ts` |
| adapters | `packages/adapters/drizzle/0048_hard_nocturne.sql` |
| apps/web | `apps/web/src/app/api/approvals/[approvalId]/evidence/route.ts` |
| apps/web | `apps/web/src/components/chat/off-system-approval-dialog.tsx` |
| apps/web | `apps/web/src/components/chat/off-system-approval-form.ts` (+ `.test.ts`) |
| apps/web | `apps/web/src/lib/e2e-fixtures-flows.ts` (extracted — see deviations) |
| apps/web | `apps/web/e2e/phase-off-system-approval.spec.ts` |

## Files modified

- **domain** — `approval.ts` (six fields, `ApprovalUpdate`, `isOffSystemApproval`),
  `flow-node.ts` (`allowOffSystemApproval`), `approval-record.ts`
  (`offSystemApprovalAllowed`, three frozen keys), `attestation-block.ts`
  (Decision and Date rows, canonical string), `approval-decision-message.ts`,
  `entities/index.ts`.
- **application** — `decide-approval.ts`, `approvals/index.ts`,
  `__fixtures__/approval-doubles.ts` (the double now mirrors the SQL repository's
  nested-evidence-to-flat-columns mapping).
- **adapters** — `db/schema/wayfinder.ts`, `repositories/drizzle-approval-repository.ts`
  (+ `.test.ts`).
- **apps/web** — `server/routers/approval.ts` (+ `.test.ts`),
  `server/approval-router-events.test.ts`, `lib/approval-decision-message.ts`
  (+ `.test.ts`), `lib/container.ts`, `lib/container-approval-use-cases.ts`,
  `lib/e2e-fixtures.ts`, `lib/e2e-fixtures-approval.ts`,
  `components/chat/approver-picker.tsx`, `approval-gate.tsx`,
  `sent-approval-actions.ts` (+ `.test.ts`),
  `components/canvas/node-config-modal-approval.tsx`, `approval-config-mapping.ts`,
  `node-config-values.ts`, `approval-node-config.test.ts`,
  `scheduled-node-config.test.ts`, `components/approvals/approval-parts.tsx`,
  `app/(user)/chats/[sessionId]/_content.tsx`, `app/(user)/approvals/_content.tsx`,
  `app/(user)/approvals/[approvalId]/_content.tsx`, `e2e/helpers/seed.ts`.

## Migration

`packages/adapters/drizzle/0048_hard_nocturne.sql` — six nullable columns on
`app_session_approvals` plus the nominator foreign key:

```sql
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_approved_on" date;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_filename" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_mime_type" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_size_bytes" integer;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_storage_path" text;
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_nominated_by_user_id" uuid;
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_off_system_nominator_fk" ...;
```

**No `-- data-impact:` declaration.** Every column is nullable and additive —
no `DROP`, no `SET NOT NULL`, no `ADD COLUMN … NOT NULL`, no unique index, no
type change — so the rule in `CLAUDE.md` does not apply and
`migration-safety.test.ts` passes unchanged. Generated with `drizzle-kit
generate`; `drizzle-kit push` was never used.

Evidence bytes go through the existing `IObjectStorage` to
`approval-evidence/<approvalId>/<timestamp>-<safe-filename>`. No new port, no
new bucket, and deliberately not `app_session_uploads` — rows there are
extracted into the session's AI system prompt, and a governance artefact must
not become model context (ADR-055 §7).

## Tests

All written before their implementation file.

| Layer | File | Count |
|---|---|---|
| domain | `off-system-approval.test.ts` (new) | 11 |
| domain | `attestation-block.test.ts` (extended) | +7 |
| domain | `approval-record.test.ts` (extended) | +3 |
| domain | `approval-decision-message.test.ts` (extended) | +3 |
| application | `decide-approval-off-system.test.ts` (new) | 14 |
| application | `record-off-system-approval.test.ts` (new) | 15 |
| adapters | `drizzle-approval-repository.test.ts` (extended) | +4 |
| apps/web | `off-system-approval-form.test.ts` (new) | 12 |
| apps/web | `sent-approval-actions.test.ts` (extended) | +8 |
| apps/web | `approval-node-config.test.ts` (extended) | +6 |
| apps/web | `routers/approval.test.ts` (extended) | +6 |
| apps/web | `lib/approval-decision-message.test.ts` (extended) | +3 |

One assertion is worth naming: `attestation-block.test.ts` pins the exact
verification code an in-system approval produced *before* this change
(`138E648F1D5F`). The off-system date joins the canonical string only when it is
set, so no existing or future in-system code moves.

**E2E:** `apps/web/e2e/phase-off-system-approval.spec.ts` — qualifies under
**group 3 (file upload and download)** of `docs/guides/e2e-test-policy.md`: the
evidence crosses the browser boundary going in (file picker) and coming back out
(download stream). Three tests: the action is offered, recording is blocked
until evidence is attached (the visible error path), and recording advances the
session and files the evidence for download. Serial, with the mutating test
last. Authorisation, date rules, record contents and block rendering are covered
at the layers above and are deliberately not re-tested through the browser.
Written, not run — CI runs the suite.

A seed fixture (`seedOffSystemApprovalSession`) was added with its own flow
rather than reusing the withdrawable one, because recording advances the session
and two specs mutating one seeded session is how a suite starts depending on the
order it runs in.

## Deviations from the approved change summary

1. **The date's lower bound is the session start, not the moment the request was
   raised.** The approved summary said "before the request was raised". While
   implementing it, that turned out to reject the commonest legitimate case: an
   operator often secures sign-off while the flow is still running and only
   reaches the approval step afterwards. The rule is now "not before the work
   being approved existed", with the session's `createdAt` as the floor, supplied
   by the caller so the domain rule stays pure. Documented in ADR-055 §1 and
   `off-system-approval.ts`.
2. **`apps/web/src/lib/e2e-fixtures-flows.ts` was extracted.** Adding the seed
   fixture pushed `e2e-fixtures.ts` from 800 to 804 lines, past validate.sh's
   source-size ceiling. `seedForkFlow` and `seedConfirmationSession` moved out —
   neither is about approvals or extraction, and neither touches the ORM, so the
   split needed no change to any architecture gate.
3. **`decisionVerbPhrase` gained an off-system branch.** Not in the plan. The
   chat feed renders the outcome as a verb phrase after the approver's name via a
   literal lookup map; the off-system line carries a date and so cannot be a map
   key, and without a branch the feed read stilted.
4. **The decision-path tests went in `decide-approval-off-system.test.ts`**
   rather than extending `decide-approval.test.ts`, which is at 1588 lines
   against validate.sh's 1600-line test ceiling.

## Known limitations

- **The evidence is filed, not verified.** Nothing parses, scans, or validates
  the uploaded file. Someone with session-owner rights can record an approval
  that did not happen; what the design buys is that doing so leaves an
  attributable, evidenced trail rather than an indistinguishable one.
- **A refused nomination can orphan a stored object.** Bytes are written before
  the decision is attempted so the guarded patch stays atomic; cleanup on refusal
  is best-effort, and a failed delete leaves an object nothing references.
- **One evidence file, filed once.** No replacement after the record is frozen,
  and no second file.
- **Approval only.** No off-system rejection or change request.
- **No cross-session report.** The record keys (`<step_key>.off_system_approved_on`,
  `.off_system_evidence`, `.recorded_at`) exist for one, but no surface was built.
- **Pre-existing, unrelated:** `./scripts/audit-check.sh` reports three high
  advisories (jsondiffpatch GHSA-j4fx-xxwh-2485, browserslist GHSA-c83g-rgw3-j3cx
  and GHSA-73wf-gq98-2v4g). They reproduce on a clean tree at this commit's base
  and are untouched by this phase. Every other validate.sh check passes.
