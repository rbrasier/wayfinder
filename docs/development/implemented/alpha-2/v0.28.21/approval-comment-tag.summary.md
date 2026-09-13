# Implementation summary — the approval comment as its own document tag

- **Version**: 0.28.20 → **0.28.21** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase doc**: [`approval-comment-tag.phase.md`](./approval-comment-tag.phase.md)
- **Relates to**: ADR-043 (signature tag, slot selection, attestation block)

## What shipped

A template author can now write

```
{{ Delegate Signature (approval) }}
{{ Reason For Decision (approval-comment: Delegate Signature) }}
```

and the approver's comment renders wherever the second tag sits — a rationale
box, a table cell, a covering paragraph — instead of only as the `Comment:` row
inside the signature's attestation block. The reference names the signature the
comment belongs to, so a document carrying delegate, finance and legal
signatures keeps each approver's words under their own block.

`(signature-comment: …)` is accepted as a synonym. A bare `(approval-comment)`
binds to the template's only signature, and is refused when the template has
none or has more than one — with two or more, guessing would print one
approver's words under another approver's name.

## Behaviour

| Condition | Result |
| --- | --- |
| Slot decided, approver left a comment | the comment renders verbatim |
| Slot decided, no comment given | renders empty — never "None" |
| Slot undecided | renders empty, as the signature beside it does |
| Step decided more than once | the latest decision's comment, from the same approval whose block fills the signature |
| Comment bound to nothing | renders empty rather than guessing |

The value comes from the approval row's own `comment` column, written once by
the pending-guarded update. Nothing new is stored, and **an approval decided
before this change fills its comment tag on the next render**, because its
comment was captured all along.

Everything ADR-043 §2 says about a signature now applies to its comment, through
the same two choke points rather than a second implementation: `gatherableFields`
keeps it out of the AI's field set, the readiness gate and the manual-edit
dialog; `gatherableTemplateContent` strips the tag from the template body before
it reaches the session prompt or the RAG index; `validateStructuredFieldSet`
refuses it in a structured step; `validateTemplateFieldValue` refuses a typed
value; and `UpdateDocumentFields` keeps it out of the step output and therefore
out of reporting.

## Files

**domain**
- `template-field.ts` — `approval_comment` joins `TemplateFieldType`;
  `signatureLabel` joins `TemplateField`; `isApprovalOwnedTag` and
  `approvalCommentSlotKey` added; parse, describe, serialise and validate arms.
- `template-field-set.ts` — **new**. The multi-tag half of the grammar
  (`parseTemplateFields`, the group walker, the new binding pass) split out of
  `template-field.ts`, which the additions had pushed to 859 lines, past the
  800-line ceiling `validate.sh` enforces.
- `node-output.ts` — both choke points widened; `APPROVAL_COMMENT_SLOT_MARKER`
  added; `validateStructuredFieldSet` refuses the type.
- `template-annotation-validation.ts` — the new keywords join the did-you-mean
  vocabulary, so `(approval-commnt)` corrects rather than merely failing.

**application**
- `approvals/approval-values.ts` — renamed from `signature-values.ts`;
  `signatureValuesForStep` → `approvalValuesForStep`, now carrying each
  deciding approval's comment onto the comment slots bound to the signature it
  filled.
- `approvals/apply-approval-signature.ts`, `document/update-document-fields.ts`
  — both render paths follow the rename; the manual-edit path's step-output
  filter now goes through `gatherableFields` rather than testing for
  `"signature"` by hand.
- `document/render-data.ts` — comment only.

**adapters**
- `agents/flow-session-graph.ts` — the masking constraint names both markers.

**apps/web**
- `canvas/field-row-model.ts`, `canvas/field-row.tsx` — new row type, and a
  settings panel listing the signatures declared elsewhere in the template.
- `canvas/template-annotation-model.ts`, `canvas/template-annotation-modal.tsx`
  — `signatureLabelsIn`, the cross-row binding check, and the list passed down.
- `canvas/annotation-reference.tsx` — the new tag documented beside `(approval)`
  in the annotator's quick reference.
- `canvas/template-tags-help-content.ts` — the same in the "Template tags &
  validation" help dialog reached from the node config modal, which is the fuller
  of the two instructional surfaces. Its Signatures section now carries both tags
  and the combined example.

## Tests

All at the layer that owns the logic; **no Playwright e2e** — none of this falls
into the six groups in [`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md).

| File | Cases |
| --- | --- |
| `domain/template-field.test.ts` | parsing, synonym, constraint rejection, round-trip, description, manual-entry refusal |
| `domain/template-field-set.test.ts` | bare form against one / none / many signatures, unknown reference, per-signature binding, rejection inside a `(repeat)` group |
| `domain/node-output.test.ts` | excluded from the field set and the constraints text, dropped or masked in the template body, refused in a structured step |
| `application/approvals/approval-values.test.ts` | comment per slot, two signatures isolated, latest decision wins, blank and undecided stay blank, unbound stays blank |
| `application/document/update-document-fields.test.ts` | a later edit preserves the comment and keeps it out of the step output |
| `adapters/documents/xlsx-generator.test.ts` | refused in a spreadsheet, both with and without a signature |
| `adapters/agents/flow-session-graph.test.ts` | the tag never reaches the session prompt through the template body |
| `web/canvas/field-row-model.test.ts` | round-trip with and without a reference, type-switch behaviour, type-picker membership |
| `web/canvas/template-annotation-model.test.ts` | the cross-row binding rule as the editor enforces it |
| `web/canvas/template-tags-help-dialog.test.ts` | the tag is documented beside its signature for a template, and withheld from a structured step |

## Where a broken binding is caught

Three places, in the order an author meets them:

1. **In the annotation modal, before saving.** A comment row that names no
   signature where the template has several, or names one that does not exist,
   is flagged on the row and blocks Save.
2. **On save, server-side.** Both routes that write a template — `POST` (upload
   or re-upload) and `PATCH` (edit the tags of the stored template, no new file)
   — go through `storeTemplate` → `extractTemplate` → `extractFields` →
   `parseTemplateFields`, so the binding rules are enforced on every write. A
   failure returns 422 with `code: "INVALID_TEMPLATE_FIELDS"` and the message
   the binding pass produced.
3. **Never at render.** A template that cannot bind its comments never reaches
   storage, so generation has no binding case to handle.

The analyse step is deliberately *not* a gate: it builds its rows from the
document's tags rather than from a parsed field set, so a document with a broken
binding still opens in the editor with the offending row visible — which is what
the author needs in order to fix it.

## Deviations from the approved plan

- **No new rejection branch in `xlsx-generator.ts`.** It would have been
  unreachable: a spreadsheet carrying a signature is refused by the signature
  check first, and one carrying a comment without a signature is refused by the
  binding pass before `extractFields` ever inspects the parsed set. The
  behaviour the plan asked for holds; the code it proposed would have been dead.
  Covered by a test asserting both paths.
- **`template-field.ts` was split**, and its tests with it. Not foreseen in the
  plan; forced by the 800-line source ceiling.
- **Two additions beyond the plan**: the guided editor now blocks an unbound or
  misnamed comment while the author is still in the modal, rather than letting
  the save fail against the server; and the new keywords were added to the
  did-you-mean vocabulary.

## Known limitations

- The attestation block still carries its own `Comment:` row. It is frozen,
  hashed text — changing it would alter what was signed — so a template using
  both shows the comment twice by design.
- Two tags sharing one field name still dedupe silently, as they do for every
  other field type.
