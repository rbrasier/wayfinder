# ADR-055 — Off-System Approval Nomination

- **Status**: Accepted (scoped by `off-system-approval.prd.md`)
- **Date**: 2026-09-02
- **Builds on**: ADR-018 (approval step & approver resolution), ADR-033
  (append-only audit log, hash chain), ADR-040 (approval subject &
  decision-time snapshot), ADR-043 (signature slot & attestation block),
  ADR-045 (approver field editing, derived `approved_with_edits`)

## Context

An approval node parks a session until the assigned approver decides in
Wayfinder. Often they already decided somewhere else — a signed memo, a
delegate's email, a committee minute. The approval exists; only the record of it
is missing.

The two existing exits are both wrong for this. Chasing the approver leaves the
session parked indefinitely for a decision that has already been made.
Withdrawing throws the step away, and with it the request, the assignment and
the subject — the exact trail the product exists to keep.

There is a third thing an operator does today, and it is worse than either:
sign in as, or ask the approver for, whatever it takes to press the button in
the app. That produces a record which claims an in-system decision that never
happened, and nothing in the trail says otherwise.

So the question is not whether off-system approvals happen. It is whether
Wayfinder records them honestly or launders them.

## Decision

### 1. Off-system nomination is a first-class, evidenced path — not a decision shortcut

Recording an off-system approval requires **both**:

- an uploaded evidence attachment, of any accepted type, filed against the
  approval; and
- a confirmed **date the approval happened**, which is a date, not a timestamp,
  because that is what a memo or a minute actually carries.

Neither is optional and neither has a default that stands in for the other. An
approval recorded with no evidence is indistinguishable from an assertion, and
an approval recorded with today's date is indistinguishable from an in-system
one. Both together are what make the record answerable later.

Validation on the date: not in the future, and not before the request was
raised. An approval cannot pre-date the thing it approves.

### 2. The decision is recorded against the approver; the nomination against the nominator

`decided_by_user_id` is set to the **assigned approver** — `approver_user_id`,
or null where the assignment is email-only and no account has claimed it. The
approver's name, email and role are copied into the record exactly as an
in-system decision copies them (ADR-040 §5), so the signature names the person
who approved.

The person who pressed the button is recorded separately, in
`off_system_nominated_by_user_id`. Conflating the two would either credit the
approval to someone who did not give it, or lose who entered it. Both facts
matter and neither substitutes for the other.

### 3. Who may nominate

The session owner, the row's requester, or an admin.

The requester is included because on a chained approval that is the *previous
approver*, who nominated this signer and is the person holding the
correspondence. The session owner is included because they are the one watching
the chat when it stalls — the same reasoning that gates **Update approver**.
Everyone else, including an ordinary session participant, is refused.

The assigned approver is not in the list, and deliberately: an approver present
enough to press the button should press **Approve**, which records a stronger
fact.

### 4. The flow author can forbid it, per step

`ApprovalNodeConfig.allowOffSystemApproval?: boolean`. Absent means allowed —
the same "absent is the permissive default" shape as `allowManualEdit`, so every
approval node authored before this feature keeps working unedited and gains the
capability.

The control lives in the approval node's existing **Advanced** disclosure,
beside the signature slot and the return target. It is a governance setting, not
a day-one authoring decision, so it belongs where the other ones already are.

The switch is enforced server-side, not just in the UI. A hidden button is a
convenience; the `FORBIDDEN` is the rule.

### 5. The recorded status is `approved`, never `approved_with_edits`

`approved_with_edits` means the approver who signed also changed their own
subject step while it was pending (ADR-045 §4). A nominator's edits are not the
approver's, so the approver-edit derivation is skipped entirely on this path and
the status is plain `approved`.

Deriving it here would attribute someone else's edits to the approver, which is
precisely the misattribution ADR-045 exists to prevent.

### 6. The attestation block states its own provenance, in rows it already has

The block gains no new rows. Two existing ones change:

```
Approved by:   Dana Okonjo (dana@example.gov)
Role:          Director, Procurement
Decision:      Approved (recorded off system)
Date:          14-08-2026
Verification:  WF-3F91C0A22B4E
```

- **Decision** reads `Approved (recorded off system)`. A reader takes the
  outcome line in first, and the provenance belongs where the outcome is, not in
  a footnote they may not reach.
- **Date** shows the off-system approval date, rendered `DD-MM-YYYY` with no
  clock time. An in-system block shows `DD-MM-YYYY HH:MM UTC` because the system
  observed the minute; here it did not, and inventing one would assert a
  precision the evidence does not carry.

The moment it was entered into Wayfinder is not lost — it is frozen in the
record as `<step_key>.recorded_at`, alongside `<step_key>.off_system_approved_on`
and `<step_key>.off_system_evidence`. The document shows what was approved and
when; the record shows when the system learned of it.

`AttestationInput` gains `offSystemApprovedOn`, which joins the canonical string
the verification code hashes. Only off-system records carry it, and decided
records are read back never recomputed (ADR-043 §6), so no existing verification
code changes. Nothing may start recomputing them.

### 7. Evidence is object storage, not a session upload

Bytes go through the existing `IObjectStorage` port, keyed
`approval-evidence/<approvalId>/<timestamp>-<safe-filename>`, following the
`session/<sessionId>/…` convention already used by chat uploads. The filename,
MIME type, size and key live in columns on `app_session_approvals`.

Not `app_session_uploads`: rows in that table are extracted and injected into
the session's AI system prompt on every subsequent turn. A signed memo is a
governance artefact, and turning it into model context would let its contents
steer the rest of the flow.

One file, filed once. The columns hold a single evidence object rather than a
child table, because the record is frozen at decision time and there is no
second moment at which a second file could legitimately arrive.

### 8. It is audited twice, deliberately

The commit writes the ordinary `approval.decided` entry, so an off-system
approval appears in the decision trail beside every other decision, and a
separate `approval.recorded_off_system` entry whose actor is the **nominator**,
carrying the off-system date and the evidence filename.

One entry could not carry both actors. Two entries mean neither reading of the
trail — "what decisions were made" and "who entered them" — has to reconstruct
the other.

## Consequences

**Good.** A stalled session has an honest exit. The document says what happened
on its face. The trail names the approver, the nominator, the date, and the
evidence, and an auditor can pull the file. Flow authors can forbid it where
only an in-system decision will do.

**Bad.** Someone with session-owner rights can record an approval that did not
happen, and the system cannot tell — the evidence is filed, not verified. That
risk is inherent to the capability, not to this design; what the design buys is
that doing so leaves an attributable, evidenced trail rather than an
indistinguishable one.

**Also.** Two dates now exist for one approval, and every surface that shows one
must be clear about which. The block shows the approval date; the record keeps
both.
