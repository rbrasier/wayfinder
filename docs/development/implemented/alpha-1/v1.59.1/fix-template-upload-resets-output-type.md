# Bug fix — Template upload resets a conversational step's output type

## Symptom

When an author configures a conversational step, switches **Output type** to
**Generate document**, and then uploads a `.docx` template, the modal snaps
**Output type** back to **Conversation only**. Any other edits made before the
upload (step name, AI instructions, "Done when…") are also lost. Separately,
when **Generate document** is selected the **Done when…** mode stays on
"Specific condition" even though "Template complete" is the natural default, and
an empty new canvas offers no obvious way to add the first step.

## Reproduction

1. Open a flow's canvas builder and add / open a conversational step.
2. Set **Output type** to **Generate document**.
3. Upload a `.docx` template.
4. Observe **Output type** reverts to **Conversation only** and the template
   pill / other unsaved fields no longer reflect the intended configuration.

## Root cause

`NodeConfigModal` seeds its local `values` state from `initialValues` inside a
`useEffect` keyed on `[open, initialValues]`:

```ts
useEffect(() => {
  if (open) {
    const next = { ...DEFAULT_VALUES, ...initialValues };
    setValues(next);
    ...
  }
}, [open, initialValues]);
```

`initialValues` (`initialConfigValues` in the page) is derived from `rfNodes`
and is a fresh object on every render. On a successful upload,
`handleUploadTemplate` writes the template path/filename/content back into
`rfNodes` (so `priorStepFields` and the filename pill update immediately). That
mutation recomputes `initialConfigValues`, which re-runs the effect **while the
modal is still open**, overwriting the author's in-progress `values` with the
values persisted on the node. Because the author's switch to
`generate_document` (and any other edits) has not been saved yet, it is thrown
away — the output type reverts to the persisted `conversation_only`.

The filename pill appeared to survive only because the upload handler also wrote
it into `rfNodes`; every field the handler did **not** write was reset.

## Fix plan

1. **Seed on open only.** Re-run the modal's form-seeding effect only on the
   `open` false→true transition, not on every `initialValues` identity change.
   The upload handler already mirrors the upload result into local state via
   `set(...)`, so no re-sync from `rfNodes` is needed while the modal is open.

2. **Default "Done when…" to "Template complete".** When the author selects
   **Generate document**, default the completion mode to "Template complete"
   unless they have already typed a specific condition or chosen "Never done".
   Switching back to **Conversation only** clears the (now-unavailable)
   template-complete sentinel. Extract this as a pure, unit-tested helper.

3. **Empty-canvas affordance.** Render a large centred "+ Add step" button
   overlaying the canvas when the flow has no nodes, wired to the same
   `handleAddStep` used by the toolbar button.

## Tests

- Unit: `output-type.ts` helper — selecting generate_document defaults to
  template-complete, respects an existing condition / never-done, and clears the
  sentinel when reverting to conversation-only.
- E2E: `fix-template-upload-resets-output-type.spec.ts` — output type and
  pre-filled fields persist across a template upload; empty canvas shows the
  overlay button.
