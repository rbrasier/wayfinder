# PRD — Flow Step Prompt Preview

- **Status**: Draft
- **Date**: 2026-05-22
- **Author**: richy.brasier@gmail.com
- **Target version**: 1.5.7  (bump: PATCH — UI addition, no schema change)

## 1. Problem

Flow authors have no way to see the exact system prompt that will be sent to
the AI when a step runs. After filling in the "Instructions for the AI" and
"Done when…" fields, they must start a live chat session to observe the AI's
behaviour — there is no preview. This makes it slow to iterate, hard to
catch mistakes in phrasing, and impossible to verify how the base system
instructions combine with their authored content.

## 2. Users / Personas

- **Flow author** — configures steps on the canvas and needs confidence that
  the assembled prompt accurately reflects their intent before publishing the
  flow.

## 3. Goals

- The user can open a step's config modal and switch to a read-only prompt
  preview with a single click.
- The preview shows the exact system prompt string that `FlowSessionGraph.buildSystemPrompt()`
  would produce given the current `aiInstruction`, `doneWhen`, and the flow's
  attached context documents (filenames only, as in production).
- The preview is read-only — it cannot be edited directly; the user must
  return to edit mode to change anything.
- The user can copy the full prompt to the clipboard.
- Switching between edit and preview modes does not discard unsaved edits.
- The feature is available to any user who can open the step config modal
  (owner, admin).

## 4. Non-goals

- No storage of prompt snapshots or history.
- No preview of the confidence-evaluation prompt (`buildConfidenceSystemPrompt`).
- No preview outside the `NodeConfigModal` (no canvas-card hover affordance).
- No editable prompt field — the preview is strictly read-only.
- No diff view between saved and unsaved prompt states.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
|--------|----------|----------------|-------|
| `NodeConfigModal` | `apps/web/src/components/canvas/node-config-modal.tsx` | existing | Add view-toggle state and preview panel |
| `FlowSessionGraph.buildSystemPrompt()` | `packages/adapters/src/agents/flow-session-graph.ts` | existing | Called server-side from the new tRPC query |
| `node.previewPrompt` tRPC query | `apps/web/src/server/routers/flow.ts` (`nodeRouter`) | new | Accepts `{ nodeId, aiInstruction, doneWhen }`, returns `{ systemPrompt: string }` |

## 6. User stories

1. As a flow author, I can click a preview icon in the top-right of the step
   config modal so that I can see the exact prompt the AI will receive for
   this step.
2. As a flow author, I can click back to the edit view from the preview panel
   so that my unsaved form edits are still intact.
3. As a flow author, I can copy the full system prompt to my clipboard from
   the preview panel so that I can paste it into an external tool for review.

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal.tsx` — add preview toggle
  button and preview panel; new `view: "edit" | "preview"` local state
- tRPC: `flow.node.previewPrompt` — new query procedure added to `nodeRouter`
  in `apps/web/src/server/routers/flow.ts`

## 8. Database changes

None.

## 9. Architectural decisions

- No new ADR required. The feature reuses the existing `ISessionAgent` port
  and its `FlowSessionGraph` adapter implementation without modification.
- The tRPC procedure accepts the **current (possibly unsaved) field values**
  directly — `aiInstruction` and `doneWhen` — so the preview reflects what
  the author sees in the form, not what is persisted. This avoids a save-first
  requirement and keeps the preview honest about unsaved drafts.
- Context document filenames are fetched server-side from the flow's
  `contextDocs`, matching production behaviour. The procedure needs `flowId`
  to load them.
- `gatheredContext` is passed as an empty string — the preview shows the
  initial turn prompt, before any context has been gathered.

## 10. Acceptance criteria

- [ ] `NodeConfigModal` header shows a subtle eye (`Eye`) icon button in the
      top-right corner (next to the close button) when the modal is in its
      normal edit state (not the delete-confirm state).
- [ ] Clicking the eye button triggers a tRPC query and switches the modal
      body to a read-only preview panel. The button changes to a pencil/edit
      icon to indicate the current state.
- [ ] The preview panel contains a scrollable, read-only `<pre>` or
      `<textarea readonly>` element displaying the full assembled system prompt.
- [ ] A "Copy" button in the preview panel copies the full prompt to the
      clipboard and shows a brief "Copied!" confirmation.
- [ ] Clicking the edit icon returns the modal to the edit view with all
      field values unchanged.
- [ ] The preview uses the **current form values** (`aiInstruction`,
      `doneWhen`) — not the last-saved values — so edits are reflected
      without saving first.
- [ ] Context document filenames from the flow appear in the preview prompt
      under "## Reference documents" when any are attached, matching the
      production prompt exactly.
- [ ] If the tRPC query fails, the preview panel shows a clear error message
      instead of crashing.
- [ ] The eye icon button is not rendered in the delete-confirm sub-view.
- [ ] `aiInstruction` or `doneWhen` being empty does not crash the preview
      — the prompt renders with the empty string in the appropriate section.
- [ ] `VERSION` and root `package.json#version` = `1.5.7`. `validate.sh`
      passes.

## 11. Out of scope / future work

- Confidence-prompt preview (shows the evaluator prompt for step-completion
  assessment).
- Side-by-side diff between saved and current draft prompt.
- Canvas-node hover affordance that opens the preview without entering the
  full config modal.

## 12. Risks / open questions

- **Unsaved-edit UX**: Previewing before saving is the intentional design.
  The tRPC query accepts form values directly so no implicit save is needed.
  The risk is users previewing stale values if they are confused about what
  has been saved vs. typed — mitigated by the modal's existing "Save" call-to-action.
- **Context doc fetch**: The preview requires `flowId` to load context doc
  filenames. The `NodeConfigModal` currently receives `nodeId` and `flowId`
  indirectly through the canvas page. These must be threaded through as props
  to the modal (or passed via the tRPC mutation caller in the page).
