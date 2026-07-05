# Phase — Flow Step Prompt Preview

- **Status**: Awaiting Implementation
- **Target version**: `1.5.7`  (bump: PATCH — UI addition, no schema change)
- **PRD**: [`../prd/flow-step-prompt-preview.prd.md`](../prd/flow-step-prompt-preview.prd.md)
- **ADRs**: All prior ADRs assumed. No new ADR required.
- **Depends on**: v1.5.6 (current head)

## 1. Problem

Flow authors cannot see the exact system prompt the AI will receive for a
step without starting a live chat session. A read-only preview panel inside
the step config modal, driven by the same `buildSystemPrompt()` logic used in
production, closes this gap.

## 2. Goals

- Eye-icon toggle button in `NodeConfigModal` header switches to a read-only
  prompt preview without discarding unsaved edits.
- Preview reflects current (possibly unsaved) form values.
- Copy-to-clipboard affordance in the preview panel.
- A single new tRPC query — no new domain types, no schema migrations.

## 3. Non-goals

- Confidence-prompt preview.
- Canvas-node hover affordance.
- Prompt history or snapshots.

## 4. Key entities / files

| File | Change |
|------|--------|
| `apps/web/src/server/routers/flow.ts` | Add `node.previewPrompt` query to `nodeRouter` |
| `apps/web/src/components/canvas/node-config-modal.tsx` | Add view toggle, preview panel, `flowId` prop |
| `apps/web/src/app/(user)/flows/[id]/config/page.tsx` | Pass `flowId` to `NodeConfigModal` |

No new files are required.

## 5. Implementation steps

### Step 1 — tRPC query: `flow.node.previewPrompt`

Add to `nodeRouter` in `apps/web/src/server/routers/flow.ts`:

```ts
previewPrompt: authenticatedProcedure
  .input(
    z.object({
      flowId: z.string().uuid(),
      aiInstruction: z.string(),
      doneWhen: z.string(),
    }),
  )
  .query(async ({ ctx, input }) => {
    if (!await canEditFlow(ctx.container, input.flowId, ctx.userId, ctx.isAdmin)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view this flow." });
    }

    const canvasResult = await ctx.container.useCases.getFlowCanvas.execute(input.flowId);
    if (canvasResult.error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: canvasResult.error.message });
    }

    const contextDocs = canvasResult.data.flow.contextDocs ?? [];

    const promptResult = ctx.container.sessionAgent.buildSystemPrompt({
      nodeConfig: {
        aiInstruction: input.aiInstruction,
        doneWhen: input.doneWhen,
        outputType: "conversation_only",
      },
      contextDocs,
      gatheredContext: "",
    });

    if (promptResult.error) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: promptResult.error.message });
    }

    return { systemPrompt: promptResult.data };
  }),
```

**Notes:**
- Verify `ctx.container.sessionAgent` is the correct container key by
  checking `apps/web/src/lib/container.ts` before writing.
- Verify `canvasResult.data.flow.contextDocs` is the correct shape by
  reading `GetFlowCanvas` use-case output in `packages/application`.
- `gatheredContext` is intentionally empty — preview shows the initial-turn
  prompt only.

---

### Step 2 — Thread `flowId` into `NodeConfigModal`

The modal currently does not receive `flowId`. It must be added:

**`NodeConfigModalProps`** — add `flowId: string`:

```ts
interface NodeConfigModalProps {
  open: boolean;
  flowId: string;           // ← new
  initialValues?: Partial<NodeConfigValues>;
  onSave: (values: NodeConfigValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving?: boolean;
  onUploadTemplate?: (file: File) => Promise<{ path: string; filename: string } | { error: string }>;
}
```

**Canvas config page** (`apps/web/src/app/(user)/flows/[id]/config/page.tsx`) —
pass `flowId={params.id}` (or however the page obtains the flow ID) to the
`<NodeConfigModal>` render.

---

### Step 3 — Add preview state and toggle button to `NodeConfigModal`

Inside the component:

```ts
const [view, setView] = useState<"edit" | "preview">("edit");
const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
const [previewError, setPreviewError] = useState<string | null>(null);
const [isLoadingPreview, setIsLoadingPreview] = useState(false);
```

Use the tRPC client (via `api.flow.node.previewPrompt.useQuery` with
`enabled: false` and a manual refetch, or `useMutation` pattern with a
query — check the codebase for the established pattern).

**Toggle button** — placed in `<DialogHeader>` between the title and the
`<DialogCloseButton>`, visible only in the non-delete-confirm view:

```tsx
{!confirmDelete && (
  <button
    type="button"
    aria-label={view === "edit" ? "Preview prompt" : "Back to edit"}
    className="ml-auto mr-1 rounded-md p-1 text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
    onClick={handleToggleView}
  >
    {view === "edit" ? <Eye size={15} /> : <Pencil size={15} />}
  </button>
)}
```

Import `Eye` and `Pencil` from `lucide-react` (already used across the
codebase — verify in `apps/web/package.json` before importing).

**`handleToggleView`**:

```ts
const handleToggleView = async () => {
  if (view === "preview") {
    setView("edit");
    return;
  }
  setIsLoadingPreview(true);
  setPreviewError(null);
  try {
    const result = await trpcClient.flow.node.previewPrompt.query({
      flowId,
      aiInstruction: values.aiInstruction,
      doneWhen: values.doneWhen,
    });
    setPreviewPrompt(result.systemPrompt);
    setView("preview");
  } catch (error) {
    setPreviewError(error instanceof Error ? error.message : "Failed to load preview.");
  } finally {
    setIsLoadingPreview(false);
  }
};
```

Verify the tRPC vanilla client pattern used in the project — check other
components that call tRPC queries imperatively.

---

### Step 4 — Preview panel UI

Replace `<DialogBody>` contents when `view === "preview"`:

```tsx
{view === "preview" ? (
  <DialogBody className="flex max-h-[70vh] flex-col gap-3 overflow-hidden">
    {previewError ? (
      <p className="text-[13px] text-[#c2385a]">{previewError}</p>
    ) : (
      <>
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[#918d87]">
            System prompt sent to the AI for this step (read-only)
          </p>
          <CopyButton text={previewPrompt ?? ""} />
        </div>
        <pre className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3 font-mono text-[12px] leading-[1.6] text-[#1a1814]">
          {previewPrompt}
        </pre>
      </>
    )}
  </DialogBody>
) : (
  /* existing edit form DialogBody */
)}
```

**`CopyButton`** — small inline component within the same file:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#918d87] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
```

Import `Check`, `Copy` from `lucide-react`.

**Footer in preview mode** — show only a "Back to edit" ghost button (no
Save/Delete):

```tsx
{view === "preview" && (
  <DialogFooter>
    <Button type="button" variant="ghost" onClick={() => setView("edit")}>
      ← Back to edit
    </Button>
  </DialogFooter>
)}
```

---

### Step 5 — Reset view on modal close

In `handleOpenChange`:

```ts
const handleOpenChange = (isOpen: boolean) => {
  if (!isOpen) {
    setConfirmDelete(false);
    setUploadError(null);
    setView("edit");           // ← reset
    setPreviewPrompt(null);    // ← reset
    setPreviewError(null);     // ← reset
    onClose();
  }
};
```

---

### Step 6 — Version bump

Update `VERSION` (root) and root `package.json` `version` field to `1.5.7`.

---

## 6. Database changes

None.

## 7. Acceptance criteria

_(Mirrors PRD §10 — use as the test checklist)_

- [ ] Eye icon appears in the `NodeConfigModal` header (not in delete-confirm view).
- [ ] Clicking the eye icon calls the tRPC query with current form values and
      shows the preview panel.
- [ ] Preview panel contains the full assembled system prompt in a scrollable
      read-only block.
- [ ] "Copy" button copies the text and shows "Copied!" for ~1.5 s.
- [ ] Pencil icon in preview header returns to the edit view with form values
      intact.
- [ ] If the query fails, an error message is shown in the preview panel body.
- [ ] Context doc filenames from the flow appear in the preview under
      "## Reference documents" when attached.
- [ ] Empty `aiInstruction` or `doneWhen` does not crash the preview.
- [ ] Closing and reopening the modal resets back to edit view.
- [ ] `VERSION` and `package.json#version` = `1.5.7`. `validate.sh` passes.

## 8. Risks / open questions

- **tRPC client pattern**: Check how other components call tRPC queries
  imperatively (e.g. on button click rather than on mount). The codebase may
  use the vanilla tRPC client or a custom `useLazyQuery` wrapper. Read the
  relevant components before writing Step 3.
- **`sessionAgent` container key**: Verify the exact property name on the
  `Container` type in `apps/web/src/lib/container.ts` before writing Step 1.
- **`getFlowCanvas` output shape**: Verify that `contextDocs` is available
  on `canvasResult.data.flow` (or the appropriate nested field) before writing
  Step 1.

## 9. Validation

Run `./validate.sh`. Then move this file to
`docs/development/implemented/v1.5.7/` and write `summary.md`.
