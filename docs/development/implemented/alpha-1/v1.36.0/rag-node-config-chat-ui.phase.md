# Phase: RAG-era node config & chat UI improvements

**Version target:** 1.36.0 (MINOR — new features + UI changes, no DB migration)

## Why

Now that retrieval (RAG) governs what context reaches each prompt, the per-flow
context-document character budget is obsolete and its UI (progress bar + warning)
is misleading. Separately, node configuration is harder than it needs to be:
authors pick a type inside the same modal they configure in, the step name is
pre-filled, and a node must be saved before a document can be uploaded. Finally,
the chat 3-dot menu mislabels the abandon action and offers no way to inspect the
structured data a session has produced.

## What changes

### 1. Remove context-document limits (UI)
- `context-docs-strip.tsx`: delete the usage progress bar, the
  `chars / budget (pct%)` label, and the over-budget / large-context warning.
  Keep the doc chips (with per-doc size + char count) and the uploader; file
  size / MIME errors stay.
- `packages/shared/src/schemas/context-docs.ts`: remove the now-unused
  `CONTEXT_DOCS_TOTAL_BUDGET_CHARS` and `CONTEXT_DOCS_WARNING_THRESHOLD_CHARS`.
- `api/flows/[id]/context-docs/route.ts`: drop `flowBudgetChars` /
  `flowTotalChars` from the response (server already stores full text).

### 2. Node configuration simplification
- **Node-type picker first.** "+ Add step" (and the menu's "Add Auto Node")
  open a small `NodeTypePickerModal` listing the available types
  (Conversational always; Automated / Scheduled gated by their feature flags).
- **Auto-save on type select (2.2).** Choosing a type immediately persists a new
  node (blank name + type defaults) via the existing `flow.node.create`
  mutation, then opens the config modal for that already-saved node. Because the
  node exists, document upload and field config no longer require a manual Save
  first; the "Save the step first" placeholder is removed.
- **Type is fixed when configuring.** The "Step type" selector is removed from
  `node-config-modal.tsx`; the type is supplied by `initialValues` only.
- **Blank step name (2.1).** New nodes start with an empty name (the "New step"
  prefill is dropped). Canvas node components render an "Untitled step" fallback
  when the name is empty.
- **Notify toggle (2.3).** Every node type gains a "Notify chat participants when
  step complete" toggle at the bottom of its config, stored as
  `config.notifyOnComplete`. Default **on for scheduled**, **off** otherwise.

### 2.3 wiring — step-complete notifications (full delivery)
- Add `"step_complete"` to `NotificationTrigger` (TS text enum on a `text`
  column — no migration) and to the schema's `trigger` enum list.
- New `buildStepCompleteEmail` template.
- New `NotifyOnStepComplete` use-case (`ISessionStepCompleteNotifier`):
  - Loads the completed node; effective flag is
    `config.notifyOnComplete ?? (node.type === "scheduled")`. If off → no-op.
  - Recipients = the session owner plus every distinct message sender
    (chat participants), resolved to emails.
  - Deduped per `(step_complete, "<sessionId>:<nodeId>", email)`; enqueues an
    outbox row, sends best-effort, marks sent/failed, audit-logs — mirroring
    `NotifyOnSessionComplete`.
- Fired fire-and-forget from all three advancement paths for the node that just
  completed: `run-turn.ts` (`session.currentNodeId`),
  `apply-auto-node-result.ts` (`input.nodeId`),
  `advance-scheduled-node.ts` (`input.scheduledNodeId`).
- Wired into both containers (`apps/web`, `apps/api`).

### 3. Chat 3-dot menu
- **3.1** Relabel "Close" → "Abandon" (handler already sets status `abandoned`;
  the success toast is updated to match).
- **3.2** New "Show data" button → `ShowDataModal`. A new `session.stepData`
  tRPC query returns each completed step (reusing the confidence ≥ 90 / not-current
  rule; completion date = the completing assistant message's timestamp) joined
  with its stored `app_session_step_outputs` fields, ordered by step order. The
  modal renders one collapsible section per completed step (name + date);
  expanding shows that step's outputs in a table (empty-state when none).

## Entities / use-cases touched
- Domain: `NotificationTrigger`; new email template input type.
- Application: new `NotifyOnStepComplete`; `RunTurn`, `ApplyAutoNodeResult`,
  `AdvanceScheduledNode` gain an optional step-complete notifier.
- Web: `context-docs-strip`, `node-config-modal`, flow config `_content`, new
  `NodeTypePickerModal`, `chat-actions-menu`, new `ShowDataModal`, `session`
  router (`stepData`), both containers.

## DB
No migration. `config.notifyOnComplete` lives in the existing `config` jsonb;
the `trigger` column is plain `text` so the new enum value needs no schema change.

## Tests
- Unit (tests-first): `NotifyOnStepComplete` (off → no-op; on → enqueues per
  participant, deduped); `session.stepData` resolver shaping.
- Playwright e2e `enhance-rag-node-config-chat-ui.spec.ts`: node-type picker +
  blank name + auto-save, absence of the context-doc usage bar, and the chat
  "Abandon" / "Show data" menu entries.

## Version bump
`1.35.0` → `1.36.0` (MINOR). Update `VERSION` and root `package.json`.
