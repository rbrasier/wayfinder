# Enhancement — Collapse secondary step controls behind an Advanced section

**Status:** Awaiting review
**Base branch:** `release/alpha-2`
**Version bump:** PATCH — `0.27.4` → `0.27.5`
**ADRs touched:** none new. Relates to ADR-026 (operator-confirmed step
completion) and ADR-043 §5 (signature slots).

## 1. Problem

`NodeConfigModal` shows every control a step type has, flat, at one level of
importance. A conversational step presents ten controls before the author has
decided what the step is for; an approval step presents seven, three of which
only matter once the author has a signed document or a branching flow.

The controls themselves are right — the ordering is what fails. An author
opening a step cannot tell which two fields define the step and which five
refine it, so the modal reads as harder than the product is.

## 2. Goals

- One collapsed **Advanced** disclosure per modal, holding the controls an
  author can ignore on first pass.
- Every control stays reachable and keeps its current behaviour, label and
  persisted key. Nothing is removed.
- The section opens by default in the two cases where its contents are the
  point of the step, so progressive disclosure never hides the next action.
- New conversational steps require confirmation before completing.

## 3. Non-goals

This is **not** the flow-gated "Advanced mode" of ADR-014, whose phase doc is
still awaiting implementation in `to-be-implemented/` and which adds per-step
model selection, prompt override and confidence progression behind an
`app_flows.advanced_mode` column. That feature shares the word "advanced" and
nothing else: it gates *new* controls on a flow flag, whereas this phase
re-homes *existing* controls with no flag and no schema change.

The two are compatible, and deliberately so — when ADR-014 lands, its per-step
controls belong inside the disclosure this phase introduces rather than in a
second one. Non-goals here: model/prompt overrides, confidence progression, any
flow-level flag, any change to the scheduled node's own controls.

## 4. Approach

A single `<details>`-based disclosure rendered by the modal shell, below the
type-specific body and above the footer. The shell composes type-specific
advanced content with the shared notify toggle, so an author sees one Advanced
section per step, never two.

`<details>` rather than conditional rendering is load-bearing: children of a
closed `<details>` stay mounted. The approval view pre-selects a lone signature
slot from an effect (`node-config-modal-approval.tsx:66`), and that effect must
run whether or not the author has opened the section. Unmounting the subtree
would silently stop writing `signatureFieldKey` — the exact v0.26.2 defect
ADR-043 §5 was amended to close.

## 5. What moves

| Item | Control | Node types |
|---|---|---|
| S3 | Notify chat participants when step complete | all five |
| C9 | Allow manual field editing | conversational |
| C10/C11 | Done when… + its condition textarea | conversational |
| C12 | Require confirmation before completing this step | conversational |
| A5 | Which signature does this step sign? (+ its default-subject hint) | approval |
| A6 | On changes requested, return to | approval |
| A7 | Instructions (optional) | approval |

Everything else stays where it is. The scheduled node contributes no
type-specific advanced controls — its Advanced section holds only S3 — because
it has three controls in total and hiding one would leave the node emptier than
it is comprehensible.

The auto node keeps its existing inner "Advanced fields" disclosure for n8n
request fields (`node-config-modal-auto.tsx:236`). That is a different scope —
low-level HTTP fields within the request-field list, not step-level config — and
it is nested inside that list rather than beside the new section.

## 6. Default-open rules

Both rules answer the same question: would a closed section hide the thing this
author most likely came to do?

**Conversational — open when `outputType === "unstructured"`.** An unstructured
conversation has no template and no field set, so "Done when…" is the only thing
that decides when the step ends. It is the primary control for that output type
and a secondary one for the other two. Opening the section for unstructured is
chosen over rendering C10/C11 in two places: one home for the control, one
persisted key, no duplicated JSX.

**Approval — open when the subject step declares any signature slot.** This is
the in-modal counterpart of the canvas's amber unclaimed-signatures advisory
(`unclaimed-signatures-warning.tsx`, `findUnclaimedSignatureSlots`): a slot
nothing signs renders blank on the finished document, and nothing fails at run
time to say so. The canvas warning tells the author to open the approval step
and set the signature; the section holding that control must therefore be open
when they arrive.

The rule keys on the slots existing, not on their being unclaimed. Narrowing it
to unclaimed slots was considered and rejected: the lone-slot effect
(`node-config-modal-approval.tsx:66`) claims a single signature the moment the
modal opens, so the commonest case — one signature, one approval step — would
collapse the very control the author came to check. Signing is the point of an
approval step on a signed document; when there is a slot, the section is worth
opening whether or not it is already bound.

New pure helper `approvalAdvancedDefaultOpen` in `approval-node-config.ts`,
tested alongside the existing slot helpers.

**Both rules re-open a section the author has closed, but only on the transition
into the condition.** The section keeps its own open state and syncs on the
rising edge of the rule, so switching output type to unstructured mid-edit
reveals "Done when…" rather than leaving it buried, while an author who closes
the section again is not fought on every re-render.

## 7. Require-confirmation default

`requireConfirmation` flips to `true` for newly created conversational steps —
`node-defaults.ts:64` and `DEFAULT_VALUES` in `node-config-values.ts:98`.

This reaches **new steps only, with no migration**:

- The domain field is optional (`flow-node.ts:65`,
  `requireConfirmation?: boolean`) and the runtime tests it explicitly
  (`run-turn.ts:230`, `input.requireConfirmation === true`), so an existing node
  that never stored the key keeps auto-advancing.
- The modal hydrates an existing node through
  `Boolean(editingConfig.requireConfirmation)` (`_content.tsx:586`), which
  supplies an explicit boolean and so never falls through to `DEFAULT_VALUES`.

A step that ends without the operator confirming is the failure this default
prevents: the session advances past a completed step before anyone has read what
it produced. Requiring the click is the safer default for a governed workflow,
and the toggle is one disclosure away for authors who want the old behaviour.

## 8. Key files

| Layer | File | Change |
|---|---|---|
| web | `apps/web/src/components/canvas/advanced-section.tsx` | **new** — shared `<details>` disclosure |
| web | `apps/web/src/components/canvas/node-config-modal-auto.tsx` | use the shared component for its inner "Advanced fields" block |
| web | `apps/web/src/components/canvas/approval-node-config.ts` | **new** `approvalAdvancedDefaultOpen` helper |
| web | `apps/web/src/components/canvas/approval-node-config.test.ts` | cases for the new helper |
| web | `apps/web/src/components/canvas/node-config-modal-conversational.tsx` | split out `NodeConfigModalConversationalAdvanced` (C9, C10/C11, C12) |
| web | `apps/web/src/components/canvas/node-config-modal-approval.tsx` | split out `NodeConfigModalApprovalAdvanced` (A5, A6, A7) |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | render one `AdvancedSection`; move S3 into it; compute `defaultOpen` |
| web | `apps/web/src/components/canvas/node-defaults.ts` | `requireConfirmation: true` |
| web | `apps/web/src/components/canvas/node-config-values.ts` | `requireConfirmation: true` |
| e2e | `apps/web/e2e/enhance-node-controls-advanced-section.spec.ts` | **new** |
| e2e | `apps/web/e2e/admin-flow-editing.spec.ts` | open Advanced before driving `#done-when-mode` / `#done-when` |
| e2e | `apps/web/e2e/enhance-rag-node-config-chat-ui.spec.ts` | same, plus the notify-toggle visibility assertion |
| e2e | `apps/web/e2e/fix-prior-step-fields-stripped.spec.ts` | replace the `isVisible()` guard around `#done-when-mode` |

`fix-signature-tag-lost-in-annotator.spec.ts` and
`fix-signatures-asked-for-in-chat.spec.ts` need no change: both drive approval
steps whose subject declares signature slots, which is exactly the case §6 opens
by default.

No domain, application, adapter, tRPC or schema change. No persisted config key
changes shape, so a step authored before this phase opens on exactly the
behaviour it already had.

## 9. Implementation steps (test-first per CLAUDE.md)

1. **Helper + tests.** Write the `approvalAdvancedDefaultOpen` cases in
   `approval-node-config.test.ts` first: (a) subject step declares no signature
   slots → closed; (b) it declares one → open; (c) it declares several → open;
   (d) open regardless of whether the slot is already claimed; (e) the empty
   subject choice resolves through the same last-completed-step default that
   `signatureSlotsFor` uses, rather than reporting no slots. Then implement.
2. **Shared component.** Add `AdvancedSection`; move the auto node's inline
   `<details>` onto it so there is one implementation.
3. **Split the two views.** Extract the advanced sub-components, keeping each
   control's existing conditional visibility intact (C9 document/structured
   only, C12 only when Done-when ≠ never, A5 only when slots exist).
4. **Shell.** Render one `AdvancedSection` for every node type with S3 inside it;
   pass `defaultOpen` from the two rules.
5. **Defaults.** Flip `requireConfirmation`.
6. **Existing e2e.** Update the three specs in §8 that drive or assert on a
   moved control. A closed `<details>` hides its contents, so `click`, `fill`,
   `selectOption` and `toBeVisible` all fail against them; `toHaveValue` does
   not, which is why `fix-template-upload-resets-output-type.spec.ts` and
   `phase-spreadsheet-templates.spec.ts` need no change.
7. **New e2e.** Write `enhance-node-controls-advanced-section.spec.ts`. Do not
   run — CI runs the suite on the PR.
8. **Release chores.** Bump `VERSION` and `package.json` to `0.27.5`, run
   `./validate.sh`, move this doc to `implemented/alpha-2/v0.27.5/` with a
   summary.

## 10. Acceptance criteria

- [ ] Each node type's modal shows exactly one Advanced disclosure, collapsed by
      default except under the two rules in §6.
- [ ] S3, C9, C10/C11, C12, A5, A6, A7 render inside it; every other control
      stays in the primary body.
- [ ] Each moved control keeps its label, behaviour, conditional visibility and
      persisted key.
- [ ] The approval lone-slot pre-select effect still writes `signatureFieldKey`
      while the section is closed.
- [ ] Approval opens expanded whenever the subject step declares a signature
      slot, claimed or not.
- [ ] Conversational opens expanded when output type is unstructured.
- [ ] A new conversational step has Require confirmation on; an existing step
      keeps its saved value.
- [ ] The scheduled node's three primary controls are unchanged.
- [ ] `VERSION` = `package.json#version` = `0.27.5`; `./validate.sh` passes.

## 11. Risks

- **Label collision with ADR-014.** Mitigated by §3 and by the intent that
  ADR-014's controls land inside this section rather than beside it.
- **Hidden-by-default controls are hidden from e2e too.** Audited: three specs
  need updating (§8); two are safe because `toHaveValue` ignores visibility, and
  two more because §6 opens their section by default. The
  residual risk is a spec that reaches a moved control indirectly and is missed
  — CI on the PR is the check, since the suite is not run locally.
- **The confirmation default changes behaviour for new steps.** Deliberate, and
  scoped to new steps only (§7), but it is the one change here an author will
  notice without opening the section.
