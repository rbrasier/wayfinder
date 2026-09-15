# Fix — no download card under an approval decision

## Symptom

A flow that routes a generated document through two approval steps ends with a
transcript that reads like this:

```
First Level supervisor
AL  Ada Lovelace granted approval.
    just now

2nd Level Supervisor
GH  Grace Hopper granted approval.
    just now

Flow complete
```

Each approval signs the document — an attestation block is written into it and a
new revision is stored — and nothing in the thread offers that document. The only
download card in the session sits on the message that generated the document,
above the approval request, so a reader who has just watched two people sign
something has to scroll back past both decisions to fetch it.

## Reproduction

1. Run a flow with a document step whose template carries a signature slot,
   followed by two approval steps.
2. Reach the first approval, send the request, and approve it as the assigned
   approver.
3. Return to the session thread. The decision renders as the approver's own
   message ("Ada Lovelace granted approval.") with a timestamp and nothing else.
4. Approve the second step. Same again, then `Flow complete`.
5. The signed document is only reachable from the card on the original document
   message, higher up the feed.

## Root cause

Not a signing failure — the signature path works. It is a rendering gap in
`apps/web/src/components/chat/message-feed.tsx`.

Three facts about the data, verified by reading the path end to end:

| Fact | Where |
| --- | --- |
| The decision message is stamped with the **approval** node, not the document's step | `DecideApproval.recordDecisionMessage` writes `stepNodeId: approval.nodeId` (`packages/application/src/use-cases/approvals/decide-approval.ts`) |
| The signature is written into the **subject** step's existing message, in place | `ApplyApprovalSignature.execute` repoints `SessionDocument.storagePath` to the next `-r{n}` revision and calls `sessionMessages.updateDocument(message.id, …)` |
| A document card is only rendered where a message carries a document | `msg.document && showsDocumentCard(…)` in the feed, and `showsDocumentCard` is `hasDocument` and nothing more |

Put together: the approval node's message has no `document` of its own — the
signed file lives on a message several steps above it — so the feed has nothing
to render a card from at the point the decision is read. The feed already solves
the same problem for an approver's *edit* announcement, which is likewise a
message with no document of its own: `resolveApproverEditDocument` resolves the
step's newest document from the messages already loaded and renders a read-only
`DocumentCard` under the notice. The decision branch was never given the
equivalent, and cannot reuse that helper as-is, because it resolves by
`stepNodeId` — which for a decision is the approval node, a node that never
produces a document.

Nothing needs to be fetched to close this. The card downloads by message id
(`/api/documents/:messageId`), and that route serves the document's current
`storagePath` — which, after signing, is the signed revision. Pointing a second
card at the same message is enough to offer the signed file.

## Fix plan

### 1. Resolve the signed document — `approval-decision-document.ts` (new)

A pure resolver beside `approver-edit-document.ts`:

```ts
resolveApprovalDecisionDocument(messages, decisionIndex): SessionMessage | null
```

It returns the newest document-carrying message **before** the decision in the
transcript — what that approver signed. Resolving by position rather than by step
is deliberate: a decision cannot name its subject step from the message alone,
and the document under review is by definition the last one produced before the
request went out. Two approvals over one document resolve to the same message,
and therefore to the same current, fully-signed revision.

### 2. Recognise a granted approval — `approval-decision-message.ts`

Add `isApprovalGranted(outcome)`, keyed on the domain's outcome sentences exactly
as the existing `VERB_PHRASE` map is, so a wording change breaks in one place.
Only `Approval granted.` and `Approval granted, with edits made by the approver.`
qualify: a rejection or a change request signs nothing, and routes the operator
back to edit rather than to download.

### 3. Render it — `message-feed.tsx`

In the decision branch, when the outcome is a granted approval and a preceding
document resolves, render `DocumentCard` under the note with `canEdit={false}`
and no `onRegenerate` — the same read-only treatment the approver-edit card gets.
The editable card on the original document message is untouched.

## Tests

- `apps/web/src/components/chat/approval-decision-document.test.ts` — a decision
  preceded by a document resolves that message; the newest of several preceding
  revisions wins; a document produced *after* the decision is not picked up; a
  decision with nothing before it resolves `null`.
- `apps/web/src/lib/approval-decision-message.test.ts` — `isApprovalGranted` is
  true for both granted sentences and false for every other outcome the domain
  writes, including an unrecognised one.
- **No Playwright e2e spec.** Nothing here falls into the six groups in
  `docs/guides/e2e-test-policy.md`: no new download mechanism is introduced, only
  a second mount point for a card whose download path is already covered. The two
  unit suites are the guard, and they run on every `./validate.sh`.

## Risks

- Where an approval step immediately follows its document step, two cards for the
  same document appear close together — the original (editable) one and the
  read-only one under the decision. Intended, and the price of the decision being
  self-contained.
- A flow that approves something with no document at all is unaffected: the
  resolver returns `null` and nothing renders.

## Out of scope

- Showing the card under rejections and change requests.
- Any change to how signatures are applied, or to which revision is stored.
- Surfacing the attestation text or verification code in the thread.
