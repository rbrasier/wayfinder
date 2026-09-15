# Implementation Summary — download card under an approval decision

**Version:** 0.28.19 (PATCH) · **Branch:** `fix/approval-note-download-card` → `release/alpha-2`

## Root cause

A rendering gap in `apps/web/src/components/chat/message-feed.tsx`, not a failure
of the signing path.

`DecideApproval.recordDecisionMessage` stamps the decision message with the
**approval** node (`stepNodeId: approval.nodeId`), while `ApplyApprovalSignature`
writes the signature into the **subject** step's existing message — repointing
that message's `SessionDocument.storagePath` to the next `-r{n}` revision. The
feed renders a document card only where a message carries a document
(`showsDocumentCard` is `hasDocument`, nothing more), so the approval node's
message had nothing to render from. The signed file was only reachable from the
card on the generating message, above the approval request and out of view.

The feed already solves the same problem for an approver's *edit* notice via
`resolveApproverEditDocument`, but that helper resolves by `stepNodeId` — which
for a decision is an approval node, a node that never produces a document.

## Fix applied

1. **`apps/web/src/components/chat/approval-decision-document.ts`** (new) —
   `resolveApprovalDecisionDocument(messages, decisionIndex)` walks back from the
   decision and returns the newest document-carrying message before it: what that
   approver signed. Resolving by position rather than by step is what the decision
   message supports; two approvals over one document resolve to the same message,
   so both cards download the current, fully-signed revision.
2. **`apps/web/src/lib/approval-decision-message.ts`** — added
   `isApprovalGranted(outcome)`, keyed on the domain's outcome sentences like the
   existing `VERB_PHRASE` map, matching `Approval granted.` and `Approval granted,
   with edits made by the approver.` only. It fails closed: an unrecognised
   sentence is not a grant, so a future domain wording loses the card rather than
   offering a download under a refusal.
3. **`apps/web/src/components/chat/message-feed.tsx`** — the decision branch now
   renders `DocumentCard` beneath the approver's note when the outcome is a
   granted approval and a document resolves, with `canEdit={false}` and no
   `onRegenerate` — the same read-only treatment the approver-edit card gets. It
   reuses the existing card and its `/api/documents/:messageId` download, which
   already serves the document's current `storagePath`.

Rejections and change requests are unchanged: nothing is signed there, and the
operator is being routed back to edit rather than to download. An approval over a
step that produced no document resolves `null` and renders nothing.

## Files modified

- `apps/web/src/components/chat/approval-decision-document.ts` (new)
- `apps/web/src/components/chat/approval-decision-document.test.ts` (new)
- `apps/web/src/lib/approval-decision-message.ts`
- `apps/web/src/lib/approval-decision-message.test.ts`
- `apps/web/src/components/chat/message-feed.tsx`
- `VERSION`, `package.json` (0.28.18 → 0.28.19)

No migration: no schema change. No `domain`, `application` or `adapters` change —
the defect and the fix are both on the read side.

## Regression tests added

- `approval-decision-document.test.ts` — the document preceding a decision
  resolves; the newest of several preceding revisions wins; both approvals in a
  chain resolve the same message; a document produced *after* the decision is not
  picked up; an approval over a document-less step resolves `null`.
- `approval-decision-message.test.ts` — `isApprovalGranted` is true for both
  granted sentences and false for `changes_requested`, both rejection wordings,
  `withdrawn`, and an unrecognised sentence. Built through the domain's own
  `buildApprovalDecisionMessage`, as the file's existing tests are, so a wording
  change on either side fails here rather than in the feed.

Both suites failed before the fix (7 failures) and pass after.

## E2E test

**None.** Nothing here falls into the six groups in
`docs/guides/e2e-test-policy.md`: no new download mechanism is introduced, only a
second mount point for a card whose download path is already covered. The two
unit suites are the guard and run on every `./validate.sh`.

## Validation

`./validate.sh` — 24 passed, 0 failed.

## Known limitations

- Where an approval step immediately follows its document step, two cards for the
  same document appear close together: the original editable one, and the
  read-only one under the decision. Intended — the decision reads as
  self-contained.
- The card is resolved from the messages already loaded, so it names the document
  by position in the transcript rather than by the approval's recorded
  `subject_node_id`. Equivalent for every flow shape the product supports today,
  and it needs no extra query.

## Deviations from the approved summary

None.
