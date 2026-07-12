# v1.59.1 — Fix template upload resetting output type

## Symptom

Uploading a `.docx` template into a conversational step reverted **Output type**
from **Generate document** back to **Conversation only**, and discarded other
unsaved edits (step name, AI instructions, "Done when…"). Additionally,
selecting **Generate document** did not default "Done when…" to "Template
complete", and an empty canvas had no prominent way to add the first step.

## Root cause

`NodeConfigModal` seeded its local `values` state inside a `useEffect` keyed on
`[open, initialValues]`. `initialValues` is derived from the canvas nodes and
gets a fresh object identity on every render. A successful upload writes the
template result back into the canvas nodes so `priorStepFields` and the filename
pill update immediately — but that mutation also changed `initialValues` while
the modal was still open, re-running the seeding effect and overwriting the
author's in-progress (unsaved) edits with the values persisted on the node.

## Fix applied

1. **Seed on open only.** The seeding effect now runs only on the `open`
   false→true transition (tracked with a ref), so mid-edit `initialValues`
   changes no longer clobber local state. The upload handler already mirrors the
   result into local state, so no re-sync is needed while the modal is open.

2. **Default "Done when…" to "Template complete".** Selecting **Generate
   document** defaults completion to "Template complete" unless a specific
   condition or "Never done" is already chosen; reverting to **Conversation
   only** clears the template-complete sentinel. Extracted as a pure helper
   `doneWhenForOutputType` in `output-type.ts`.

3. **Empty-canvas affordance.** A large centred "+ Add step" button overlays the
   canvas when the flow has no nodes (both the user and admin flow editors),
   wired to the existing `handleAddStep`.

## Regression test added

`apps/web/src/components/canvas/output-type.test.ts` — unit-tests
`doneWhenForOutputType` for the template-complete default, respecting an
existing condition / "never done", and clearing the sentinel on revert. Runs as
part of `pnpm test` / `./validate.sh`.

## E2E test added

`tests/e2e/fix-template-upload-resets-output-type.spec.ts` — drives the empty
canvas overlay, verifies the "Done when…" default, and asserts that a mocked
template upload preserves **Generate document** and the pre-filled name /
instruction / done-when.

Existing e2e specs that click the toolbar "+ Add step" button on an empty canvas
were updated to `.first()` so they stay unambiguous now that the empty state
renders a second identically-labelled overlay button.

## Version

PATCH bump **1.59.0 → 1.59.1** (UI bug fix, no schema impact).
