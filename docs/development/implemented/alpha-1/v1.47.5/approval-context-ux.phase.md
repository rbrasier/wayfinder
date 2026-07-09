# Enhancement — Approval screen context & decision UX

## Why

The approvals screen (`apps/web/src/app/(user)/approvals/_content.tsx`) asks a
user to approve, reject, or request changes on a request, but gives them **no
context for what they are deciding on**. The card shows only "Approval
requested", the raised timestamp, and an inline comment box with reject radios.
There is no chat name, no originator, and none of the work being approved.

Five concrete problems to fix:

1. **No context.** The card must show the **chat name**, **who it is from**
   (originator), and the **key output of the previous step**. When that step
   produced a **document**, show the same document card used in the chat —
   including the info icon that opens the rationale/confidence details. When
   there is no document, show the previous step's **output field metadata**.
2. **Decision then comment.** The comment box is always visible. Instead the
   user should click **Approve**, **Reject**, or **Request changes** first, and
   *only then* be shown a modal to enter a comment. For **Reject**, the modal
   shows two buttons — **Route back to user** (primary) and **Close request**
   (secondary). A recorded decision triggers the originator notification; when
   email is not configured, the modal illustrates this and offers two buttons —
   one to **email the user** (mailto) and one to **copy the link** — exactly
   like the operator-side approval gate already does for the *requested* email.
3. **Decision not in chat.** The decision and the reason given must be visible
   in the chat thread, not only in the Show-data / step-output metadata.
4. **"Open session" 404s.** The link 404s ("not found") because `session.get`
   rejects any viewer who is not the session owner. An approver is normally not
   the owner. Approvers must be able to open the session **read-only**.
5. **Reopen flicker.** When a session that is parked on an approval step is
   closed and re-opened, the operator-side approval gate renders the empty
   "confirm the approver" form first and only fills in "sent to {name}" a second
   later — so the operator feels they must re-enter it. The gate must show a
   loading state until that information has loaded.

## Scope / non-goals

- No DB schema change — every field needed already exists
  (`app_session_approvals`, `app_sessions`, `core_users`,
  `app_session_messages`, `app_session_step_outputs`).
- Approver decision-making stays on the `/approvals` page; "Open session" is for
  read-only context only.
- Version: **PATCH** `1.47.4` → `1.47.5` (behaviour/UI, no schema impact).

## Design

### A. Enriched pending-approvals API

`approval.listPending` currently returns raw `Approval[]`. Replace it with an
enriched payload, one entry per pending approval, built by a new application
use case `ListPendingApprovalsWithContext` (tests-first) that takes the repos it
needs (approvals, sessions, users, session messages, session step outputs) plus
`GetSession` for the pinned flow definition (nodes/edges):

```ts
interface PendingApprovalContext {
  approval: Approval;            // existing entity
  sessionId: string;
  chatName: string;             // session.title, fallback "Untitled chat"
  originatorName: string | null;// requestedByUserId -> users.name
  originatorEmail: string | null;
  previousStep: {
    stepName: string;
    // Exactly one of the two is populated:
    document: {
      messageId: string;
      document: SessionDocument;
      documentGenerationConfidence: DocumentGenerationConfidence | null;
    } | null;
    fields: StepOutputField[] | null;  // when there is no document
  } | null;
}
```

**Previous step resolution.** The approval row carries `nodeId` (the approval
node), `flowId`, `sessionId`. Order the flow's nodes with `orderStepIds(nodes,
edges)` and take the node immediately before the approval node. For that node:

- If an assistant message exists whose `stepNodeId` is the previous node and
  which carries a `document`, use the most recent such message →
  `{ messageId, document, documentGenerationConfidence }` (same shapes
  `message-feed.tsx` feeds into `DocumentCard`).
- Otherwise use the most recent `app_session_step_outputs` row for that node →
  `fields`.

The web router (`apps/web/src/server/routers/approval.ts`) wires the use case,
resolving the logged-in user's email for approver matching exactly as today.

### B. Approval card with context (UI)

`approvals/_content.tsx`:

- Header line shows **chat name** and **"from {originator}"** alongside the
  existing "Raised …" / "Open session".
- Render the previous step output: when `previousStep.document` is present, reuse
  `DocumentCard` (read-only — `canEdit={false}`, no regenerate) so the info-icon
  `DocumentInfoModal` for rationale comes for free. When only `fields` exist,
  render a compact field table (Field / Value), mirroring `show-data-modal.tsx`.

### C. Decision → comment modal (UI)

Replace the always-visible comment box and inline reject radios with three
buttons — **Approve**, **Reject**, **Request changes** — each opening a modal
(reuse `@/components/ui/dialog`):

- **Approve / Request changes:** comment textarea (required for Request changes,
  optional for Approve) + a confirm button. Calls `approval.decide`.
- **Reject:** comment textarea + two buttons — **Route back to user** (primary,
  `routeBack: true`) and **Close request** (secondary, `routeBack: false`).
- **After a decision:** if email is configured, toast success and close. If not
  configured, the modal switches to a "notify the originator manually" state
  with **Email user** (mailto to `originatorEmail`, prefilled subject/body with
  the session link) and **Copy link** (copies the session URL) — the same
  pattern as `approval-gate.tsx`'s sent-state fallback. `approval.emailStatus`
  already exists for the configured check.

### D. Decision recorded in chat

In `DecideApproval.execute`, after the decision is persisted and projected,
append a `system`-role `app_session_messages` row to the session summarising the
decision and the comment, e.g. _"Approval approved by {decider}. Comment: …"_ /
_"Changes requested…"_ / _"Rejected — routed back to originator / request
closed."_ Best-effort (a message-write failure must not fail the decision, like
the existing projection). This makes the decision and reason visible in the chat
thread for everyone who opens the session.

### E. Read-only session access for approvers

`session.get` (and `session.stepData`) authorisation currently throws
`FORBIDDEN` for non-owners. Relax it: if the viewer is not the owner/admin but
**is the approver** of an approval on that session (matched by `approverUserId`
or `approverEmail` per ADR-018), allow the read and return a `readOnly: true`
flag. The chat page (`chats/[sessionId]/_content.tsx`) uses the flag to render a
read-only view for approvers: hide the `ApprovalGate`, the confirm-step cards,
branch override, and disable the composer. This fixes the "Open session" 404.

### F. Reopen loading state

`approval-gate.tsx` calls `suggest` in a mount `useEffect` and immediately
renders the confirm form. While that initial mutation is in-flight
(`suggest.isPending` and no resolution yet), render a loading state for the whole
gate instead of the empty form, so the already-sent "Awaiting approval — sent to
{name}" appears without flashing the confirm form.

## Tests

- **Unit (application, fail-first):** `list-pending-approvals-with-context.test.ts`
  — asserts chat name, originator, and previous-step resolution (document branch
  and fields branch).
- **Unit (application):** extend `decide-approval` tests to assert a `system`
  chat message capturing decision + comment is written for each decision type.
- **E2E (Playwright):** `apps/web/e2e/enhance-approval-context.spec.ts` — drives
  an approval to the approvals screen, asserts the chat name / originator /
  previous-step output render, that clicking Reject opens the modal with the two
  routing buttons, and that recording a decision clears the request. Skips
  gracefully when infra / AI keys are unavailable.

## Version

PATCH bump: `1.47.4` → `1.47.5` (behaviour + UI, no schema change).
