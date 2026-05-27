# Phase — Reject untagged template uploads + tag explainer dialog

- **Status**: Awaiting Implementation
- **Target version**: `1.11.1` (PATCH — validation tightening + UI affordance, no schema impact)
- **Depends on**: v1.11.0 (template content limits & structural stripping)

## 1. Problem

The template upload route at
`apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`
already calls `docxGenerator.extractTags()` and surfaces `tagCount` in the
response, but it never *rejects* an upload that contains zero `{{ tag }}`
placeholders. As a result:

1. A user can upload a perfectly valid `.docx` that has no tags at all. The
   step then runs document generation against a template with nothing to
   fill in, producing a copy of the template that is indistinguishable
   from the source. The failure is silent and surfaces only when the user
   receives a useless generated document.
2. The route currently spends a `objectStorage.put` (storage cost) *and* a
   `SummariseTemplate.execute` (LLM call) on uploads that we already know
   are unusable — the tag check runs before either, but its result is
   ignored.
3. The UI offers only a one-line hint
   ("Works best using variables marked with tags") next to the upload
   button. Users who don't already know the `{{ snake_case }}` convention
   have no in-product way to learn it.

Document generation itself is unaffected by this change — it continues to
run against the raw `.docx` bytes from object storage. The change is
purely a stricter upload-time guard plus an inline UX explainer.

## 2. Goals

- Reject template uploads with zero `{{ }}` tag placeholders at the API
  boundary with HTTP 422 and a machine-readable `code: "NO_TEMPLATE_TAGS"`,
  before any storage write and before any LLM call.
- Add a new `TemplateTagsHelpDialog` React component that explains the
  tag convention in plain language with a small worked example.
- Auto-open `TemplateTagsHelpDialog` when the upload response carries
  `code === "NO_TEMPLATE_TAGS"`.
- Provide a `(?)` info icon next to the "DOCX template" label that opens
  the same dialog, so users can read the explainer *before* uploading.

## 3. Non-goals

- AI-based tag insertion (explicitly rejected in the design discussion that
  preceded this phase — the user prefers a strict check + explainer over
  automated rewriting).
- Backfilling or revalidating existing templates already stored against
  flow nodes.
- Domain entity changes — `ConversationalNodeConfig` is unchanged.
- DB schema changes — none.
- Changes to the chat-time prompt or document generation paths.

## 4. Approach

**Server**: a single guard immediately after the existing `extractTags`
call. If `validationResult.data.tags.length === 0`, return 422 with
`{ error, code: "NO_TEMPLATE_TAGS" }` and stop. This runs *before*
`objectStorage.put` and *before* `summariseTemplate.execute`, so a
rejected upload costs neither a storage write nor an LLM call.

**Client**: the existing `handleUploadTemplate` callback in
`apps/web/src/app/(user)/flows/[id]/config/_content.tsx` already parses
the JSON response. It is extended to also surface the optional `code`
field. `NodeConfigModal` reads `code` and, when it equals
`NO_TEMPLATE_TAGS`, sets a state flag that auto-opens
`TemplateTagsHelpDialog` while still showing the inline error text.

The same dialog is opened by a small `(?)` icon button next to the
existing "DOCX template" label. The dialog is a controlled component
driven by a single `helpDialogOpen` state in the modal — both triggers
flip the same flag.

### Why a strict check rather than a soft warning

A soft warning that lets the upload through would still leave the user
with a broken template in storage, costing a storage write and an LLM
summarisation call for content that produces a useless generated document
later. A hard 422 keeps the system in a known-good state: every persisted
template has at least one tag.

### Where the zero-tag check lives

Right after `extractTags` (already at line 74 in the route), before the
existing rejection branch becomes more nested. The `code` field is
specifically chosen to let the client distinguish "no tags" from other
422s (e.g. extraction failure, oversized structural content), so the
auto-open behaviour fires only for this case.

## 5. Key entities / files

| Layer    | File                                                                                  | Change                                                                            |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| apps/web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`                    | Add zero-tag guard after `extractTags`; return `{ error, code: "NO_TEMPLATE_TAGS" }` 422 |
| apps/web | `apps/web/src/components/canvas/template-tags-help-dialog.tsx`                        | NEW — explainer dialog component                                                  |
| apps/web | `apps/web/src/components/canvas/node-config-modal.tsx`                                | (?) info icon next to "DOCX template" label; auto-open dialog on `NO_TEMPLATE_TAGS` code |
| apps/web | `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`                              | `handleUploadTemplate` surfaces `code` in its return shape                        |
| root     | `VERSION`, `package.json`                                                             | Bump to `1.11.1`                                                                  |

No changes to `packages/domain`, `packages/application`,
`packages/adapters`, or `packages/shared`.

## 6. API changes

### Upload route — new rejection branch

In `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`,
immediately after the existing `extractTags` call:

```ts
const validationResult = docxGenerator.extractTags({ templateBytes: buffer });
if (validationResult.error) {
  return NextResponse.json(
    { error: `Invalid template: ${validationResult.error.message}` },
    { status: 422 },
  );
}

if (validationResult.data.tags.length === 0) {
  return NextResponse.json(
    {
      error:
        "This template has no {{ tag }} placeholders. Add at least one tag (e.g. {{ client_name }}) where you want the AI to fill in information, then re-upload.",
      code: "NO_TEMPLATE_TAGS",
    },
    { status: 422 },
  );
}
```

The guard runs *before* `objectStorage.put` and *before*
`container.useCases.summariseTemplate.execute`. No storage write, no LLM
call on rejected uploads.

### Existing 422 / 500 responses

Unchanged. Only the new `NO_TEMPLATE_TAGS` branch carries the `code` field;
other error responses continue to return only `{ error }`. The client
treats a missing `code` as the existing behaviour.

## 7. UI changes

### `TemplateTagsHelpDialog` (new component)

`apps/web/src/components/canvas/template-tags-help-dialog.tsx`:

```ts
interface TemplateTagsHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateTagsHelpDialog({ open, onClose }: TemplateTagsHelpDialogProps): JSX.Element;
```

Content:

- **Title**: "How template tags work"
- One short paragraph: templates must contain at least one
  `{{ tag }}` placeholder. The AI reads the names of the tags to know
  what information to gather from the user during chat, then fills them
  in when generating the document.
- Worked example: a 3-line snippet showing
  `Client: {{ client_name }}`, `Start date: {{ start_date }}`,
  `Project: {{ project_summary }}`.
- One closing sentence noting that tag names should use lowercase
  `snake_case` and become the labels the AI asks about during chat.
- Footer: a single "Got it" button that calls `onClose`.

The dialog uses the existing `Dialog` primitives in `apps/web/src/components/ui/dialog.tsx`.

### `NodeConfigModal` wiring

In `apps/web/src/components/canvas/node-config-modal.tsx`:

1. New state: `const [helpDialogOpen, setHelpDialogOpen] = useState(false);`.
2. Add a `(?)` info icon button (using `HelpCircle` from `lucide-react`)
   next to the existing `<Label>DOCX template</Label>`. Click handler:
   `setHelpDialogOpen(true)`.
3. In `handleFileChange`, when the upload result carries
   `code === "NO_TEMPLATE_TAGS"`, set the error text *and* call
   `setHelpDialogOpen(true)`.
4. Render `<TemplateTagsHelpDialog open={helpDialogOpen} onClose={() => setHelpDialogOpen(false)} />`
   inside the modal body (or alongside the `<Dialog>` — they can stack;
   the help dialog has a higher z-index by default via the primitive).

### `_content.tsx` (user-flow config page)

The `handleUploadTemplate` return type widens to include the optional
`code`:

```ts
Promise<
  | { path: string; filename: string; documentTemplateContent: string | null }
  | { error: string; code?: string }
>
```

`NodeConfigModalProps.onUploadTemplate` widens to match.

## 8. Test plan

This change is entirely in the API route and React UI; there are no new
domain or application use cases.

### Server (manual)

- Upload a `.docx` with zero `{{ }}` placeholders → response is 422,
  body matches `{ error: "…", code: "NO_TEMPLATE_TAGS" }`, the object
  store has no new file, the node config is untouched.
- Upload a `.docx` with one tag → succeeds as before (200, `tagCount: 1`).
- Existing 422s (extraction failure, oversized structural content)
  continue to return without a `code` field.

### Client (manual)

- Trigger the upload with a tag-free `.docx` from the node-config modal:
  the inline error text appears under the upload area *and* the
  `TemplateTagsHelpDialog` auto-opens.
- Click the `(?)` icon next to the "DOCX template" label with no prior
  error: the same dialog opens.
- Close the dialog, then re-upload a tagged template: succeeds as before;
  no dialog reappears; inline error clears.

## 9. Risks / open questions

- **Stacked dialogs** — the explainer dialog opens on top of the
  node-config modal. The existing `Dialog` primitive supports stacking,
  but visual hierarchy should be checked (overlay opacity, focus
  return). Mitigation: verify focus returns to the modal on close, and
  the explainer's "Got it" button is the autofocus target.
- **Translatable copy** — the error message and dialog body are hard-coded
  English. The project does not yet have i18n; matches the existing
  convention.
- **Tag count thresholds** — this phase rejects only on *zero* tags. A
  template with a single misspelled tag (e.g. `{{client name}}` with a
  space — already disallowed by `extractTags`) is still caught by the
  pre-existing `validationResult.error` branch.

## 10. Acceptance criteria

- [ ] Upload route rejects zero-tag uploads with HTTP 422 and
      `code: "NO_TEMPLATE_TAGS"`, before `objectStorage.put` and
      `summariseTemplate.execute`.
- [ ] `TemplateTagsHelpDialog` component exists and renders the explainer
      content as described.
- [ ] `NodeConfigModal` auto-opens the dialog when an upload returns
      `code === "NO_TEMPLATE_TAGS"`.
- [ ] A `(?)` info icon next to the "DOCX template" label opens the same
      dialog.
- [ ] `handleUploadTemplate` in `_content.tsx` surfaces the `code` field.
- [ ] `VERSION` and `package.json#version` both equal `1.11.1`.
- [ ] `./validate.sh` passes.

## 11. Validation

Run `./validate.sh`. Then move this file to
`docs/development/implemented/v1.11.1/` and write `summary.md`.
