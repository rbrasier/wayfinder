# v1.36.0 — RAG node config & chat UI improvements

MINOR bump (1.35.0 → 1.36.0). New features + UI changes; no DB migration
(node `config` is jsonb; the notification `trigger` column is plain `text`).

## What changed

### 1. Context-doc limits removed
RAG now governs what reaches each prompt, so the per-flow character budget is
gone from the UI: `context-docs-strip.tsx` no longer renders the usage progress
bar, the `chars / budget (pct%)` label, or the large/over-budget warning. The
unused `CONTEXT_DOCS_TOTAL_BUDGET_CHARS` / `CONTEXT_DOCS_WARNING_THRESHOLD_CHARS`
constants were deleted, and the upload route stopped returning the budget fields.

### 2. Node configuration simplification
- **`NodeTypePickerModal`** — "+ Add step" now opens a small modal to choose the
  step type first (Conversational always; Automated / Scheduled behind their
  feature flags). The "Add Auto Node" menu items were removed (auto lives in the
  picker now).
- **Auto-save on type select** — picking a type persists the node immediately
  (blank name + type defaults via `node-defaults.ts#defaultConfigForType`) and
  opens its config. The node is real from the start, so document uploads and
  other in-modal actions no longer need a manual first save. Backing out of the
  config modal deletes the just-created node, so cancelling leaves no orphan.
- **Type is fixed when configuring** — the in-modal "Step type" selector was
  removed from `node-config-modal.tsx`.
- **Blank step name** — new nodes start with an empty name; canvas nodes render
  an "Untitled step" fallback.
- **Notify toggle** — every node type now has a "Notify chat participants when
  step complete" switch (default on for scheduled, off otherwise), stored as
  `config.notifyOnComplete`.

Both the owner flow editor (`(user)/flows/[id]/config/_content.tsx`) and the
admin editor (`(admin)/admin/flows/[id]/_content.tsx`) were updated identically.

### 2.3 Step-complete notifications (full delivery)
- `NotificationTrigger` gained `"step_complete"`; the schema's `trigger` enum
  list was extended (no migration — it is a `text` column).
- New `buildStepCompleteEmail` template and `NotifyOnStepComplete` use-case:
  skips when the node's toggle is off (default on for scheduled), notifies every
  distinct chat participant (owner + message senders), deduped per
  `(step_complete, "<sessionId>:<nodeId>", email)`, best-effort like
  `NotifyOnSessionComplete`.
- Fired fire-and-forget from all three advancement paths — `run-turn.ts`,
  `apply-auto-node-result.ts`, `advance-scheduled-node.ts` — and wired into both
  containers.

### 3. Chat 3-dot menu
- "Close" relabelled to **"Abandon"** (the action already sets status
  `abandoned`); the toast now reads "Chat abandoned".
- New **"Show data"** entry opens `ShowDataModal`, backed by a new
  `session.stepData` tRPC query. Completed steps (confidence ≥ 90, not the
  current step — the same rule as the progress rail; date = the completing
  message's timestamp) are shown in step order as collapsible sections; expanding
  a step shows its stored `app_session_step_outputs` fields in a table. The pure
  shaping lives in `lib/step-data.ts`.

## Tests
- Unit: `notify-on-step-complete.test.ts` (off → no-op; on → enqueue per
  participant; scheduled default-on; dedupe; disabled-skips-send) and
  `lib/step-data.test.ts` (ordering, current-step / threshold exclusion, blank
  name fallback). Existing notifier/advancement and scheduled-config tests
  updated for the new field. Full suite: 719 tests passing.
- E2E: `enhance-rag-node-config-chat-ui.spec.ts` covers the type picker + blank
  name + notify toggle + absent budget bar, and the chat "Abandon" / "Show data"
  menu. Existing flow-config specs were updated for the picker-first add flow.
  (E2E not executed in this environment — no live DB.)
