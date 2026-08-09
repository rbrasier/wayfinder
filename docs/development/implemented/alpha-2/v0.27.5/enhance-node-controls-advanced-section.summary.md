# Implementation summary — v0.27.5

**Enhancement:** Collapse secondary step controls behind an Advanced section
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.4` → `0.27.5`

## What changed

`NodeConfigModal` presented every control a step type has at one level of
importance — ten for a conversational step, seven for an approval. The controls
were right; the ordering was not, so an author could not tell which fields
define a step and which refine it.

Each modal now ends in a single collapsed **Advanced** disclosure. Nothing was
removed, renamed or re-keyed: every control kept its label, its behaviour, its
conditional visibility and its persisted config key.

### Moved into Advanced

| Control | Node types |
|---|---|
| Notify chat participants when step complete | all five |
| Allow manual field editing | conversational |
| Done when… + its condition textarea | conversational |
| Require confirmation before completing this step | conversational |
| Which signature does this step sign? (+ default-subject hint) | approval |
| On changes requested, return to | approval |
| Instructions (optional) | approval |

The scheduled node contributes nothing type-specific — its Advanced section
holds only the notify toggle — because it has three controls in total. Auto and
MCP likewise carry only the notify toggle, so it lives in the same place for
every step type.

### Default-open rules

- **Conversational** expands when output type is `unstructured`. That type has
  no template and no field set, so "Done when…" is its only completion control.
- **Approval** expands when the subject step declares any signature slot. Keyed
  on the slots existing rather than on their being *unclaimed*: the lone-slot
  effect claims a single signature the moment the modal opens, so an
  "unclaimed only" rule would have collapsed the commonest case — one
  signature, one approval step — on the control the author came to check.

Both rules re-open only on the rising edge, so switching output type mid-edit
reveals "Done when…" while an author who closes the section is not fought on
every re-render.

### Require confirmation now defaults on

`requireConfirmation` flips to `true` in `node-defaults.ts` and `DEFAULT_VALUES`.
This reaches **new steps only, with no migration**: the domain field is optional
and the runtime tests it explicitly (`run-turn.ts:230`), and the modal hydrates
an existing node through `Boolean(editingConfig.requireConfirmation)`
(`_content.tsx:586`), which never falls through to the defaults. A step that
advances the moment it completes carries the session past output nobody has
read; requiring the Proceed click is the safer default for a governed workflow.

## Key decisions

**`<details>`, not conditional rendering.** Children of a closed `<details>`
stay mounted. The approval view pre-selects a lone signature slot from an effect
(`node-config-modal-approval.tsx`), and that effect has to run whether or not the
author has opened the section — unmounting the subtree would silently stop
writing `signatureFieldKey`, which is the v0.26.2 defect ADR-043 §5 was amended
to close. A test asserts the collapsed controls are attached but not visible.

**One disclosure per modal, composed by the shell.** Rather than each type view
owning its own section (which would show two "Advanced" headings on a
conversational step, one type-specific and one for notify), the conversational
and approval views were split into a basic component plus an `…Advanced`
sibling. `NodeConfigModalAdvanced` composes them with the shared notify toggle
into a single `AdvancedSection`.

That composition lives in its own file rather than in the modal shell because
`node-config-modal.tsx` was already in `validate.sh`'s "split when next touched"
band at 712 lines. Extracting it left the shell at 704 — smaller than before
this change rather than 743.

**Not ADR-014.** That ADR's phase doc, still awaiting implementation in
`to-be-implemented/`, plans a flow-gated "Advanced mode" adding per-step model
selection, prompt override and confidence progression behind an
`app_flows.advanced_mode` column. That feature
shares the word and nothing else — it gates *new* controls on a flow flag, where
this re-homes *existing* ones with no flag and no schema change. They are
compatible by design: when ADR-014 lands, its per-step controls belong inside
this disclosure rather than in a second one.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/canvas/advanced-section.tsx` | **new** — shared `<details>` disclosure, `section` and `inline` variants |
| `apps/web/src/components/canvas/node-config-modal-advanced.tsx` | **new** — composes the one section from type-specific content + notify |
| `apps/web/src/components/canvas/node-config-modal.tsx` | renders `NodeConfigModalAdvanced`; notify moved into it; computes `advancedOpenWhen` |
| `apps/web/src/components/canvas/node-config-modal-conversational.tsx` | split out `NodeConfigModalConversationalAdvanced` |
| `apps/web/src/components/canvas/node-config-modal-approval.tsx` | split out `NodeConfigModalApprovalAdvanced` |
| `apps/web/src/components/canvas/node-config-modal-auto.tsx` | its inline "Advanced fields" block now uses the shared component |
| `apps/web/src/components/canvas/approval-node-config.ts` | **new** `approvalAdvancedDefaultOpen` helper |
| `apps/web/src/components/canvas/approval-node-config.test.ts` | 7 new cases for that helper |
| `apps/web/src/components/canvas/node-defaults.ts` | `requireConfirmation: true` |
| `apps/web/src/components/canvas/node-config-values.ts` | `requireConfirmation: true` |
| `VERSION`, `package.json` | `0.27.5` |

No domain, application, adapter, tRPC or schema change.

## Tests

**Unit** — `approval-node-config.test.ts` gains 7 cases for
`approvalAdvancedDefaultOpen`: no slots → closed; one slot → open; several →
open; already-claimed slot → still open; the empty subject choice resolving
through the last-completed-step default; that default resolving to a step with
no signature → closed; and no prior steps at all → closed. 38 tests pass in that
file.

**e2e** — `apps/web/e2e/enhance-node-controls-advanced-section.spec.ts` covers
the enhancement end to end:

1. A new conversational step opens collapsed, with the moved controls attached
   but not visible and the defining controls still on show.
2. Opening the disclosure reveals them, and Require confirmation is already on.
3. Switching to an unstructured conversation expands the section on its own.
4. A moved control round-trips: notify on → save → re-open → still on.

**Existing e2e updated** for the new visibility, via a local `openAdvanced`
helper targeting the `data-advanced-section` hook:

- `admin-flow-editing.spec.ts` — opens Advanced before driving `#done-when-mode`.
- `enhance-rag-node-config-chat-ui.spec.ts` — same, plus the notify-toggle
  visibility assertion.
- `fix-prior-step-fields-stripped.spec.ts` — its `isVisible()` guard around
  `#done-when-mode` replaced with an explicit open, so the step no longer
  silently skips.

Audited and deliberately unchanged: `fix-template-upload-resets-output-type.spec.ts`
and `phase-spreadsheet-templates.spec.ts` assert with `toHaveValue`, which
ignores visibility; `fix-signature-tag-lost-in-annotator.spec.ts` and
`fix-signatures-asked-for-in-chat.spec.ts` drive approval steps whose subject
declares signature slots, which is exactly the case the approval rule opens by
default.

The e2e suite was not run locally — CI runs it on the pull request against a
full stack.
