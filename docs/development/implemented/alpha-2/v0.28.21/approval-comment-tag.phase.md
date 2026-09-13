# Enhancement — the approval comment as its own document tag

- **Requested**: 2026-09-11
- **Base branch**: `release/alpha-2`
- **Version**: 0.28.20 → **0.28.21** (PATCH — no schema change, no migration)
- **Relates to**: ADR-043 (signature tag, slot selection, attestation block),
  ADR-040 (approval subject and decision-time snapshot), ADR-024 (manual field
  editing and the document re-render path)

## What is being asked for

> I want to be able to use the approval comments … saved into the document
> itself. There might be a signature block that goes into a document using the
> signature or approval tag, but I want a corresponding approval comment that
> goes into the document the same way other tags are added — noting that there
> could be more than one signature in any one document, so there should be a way
> to associate the signature comment tag with the appropriate signature block.

## Where the comment goes today

ADR-043 §3 renders a decision into a single fixed block, substituted into the
`(approval)` slot:

```
Approved by:   Jane Doe (jane.doe@example.com)
Role:          Delegate
Decision:      Approved
Date:          01-08-2026 14:32 UTC
Comment:       Within delegated authority.
Verification:  WF-3F9A2C1E7B04
```

The comment is in the document, but only *there* — as one row of a block whose
shape, order and position are fixed by `buildAttestationBlock`. A template author
who wants the approver's rationale in a "Reason for decision" box, a table cell
beside the recommendation, or a covering paragraph, has nowhere to put it.

## Decision

### 1. `(approval-comment: <Signature Name>)` is a new annotation

```
{{ Delegate Signature (approval) }}
{{ Delegate Note (approval-comment: Delegate Signature) }}
```

parses to
`{ key: "delegate_note", label: "Delegate Note", type: "approval_comment", signatureLabel: "Delegate Signature", optional: true }`.

`approval_comment` joins `TemplateFieldType`; `signatureLabel` joins
`TemplateField`. `(signature-comment: …)` is accepted as a synonym, mirroring the
`(approval)` / `(signature)` pair already in the parser, and `(approval-comment)`
stays canonical on the way out of `templateFieldToLine`.

**The reference is explicit because the association has to survive N
signatures.** The name after the colon is the signature tag's own name as the
author wrote it, normalised through `deriveFieldKey` — which is exactly how the
signature's key was derived from its own label, so the two cannot disagree.
`approvalCommentSlotKey(field)` is the single accessor that resolves a comment
field to the signature key it fills, so no consumer re-derives it by hand.

A **bare** `(approval-comment)` binds to the template's only signature when it
declares exactly one, and is a `VALIDATION_FAILED` otherwise. This mirrors, and
is bounded by, the same reasoning as the lone-slot fallback in ADR-043 §5: with
two or more signatures, guessing which one a comment belongs to would print one
approver's words under another approver's name.

Validation rules, enforced at template upload with every other annotation error:

- Exclusive of every other type keyword, as `(approval)` is.
- Takes no `(maxlen:)`, `(min:)`, `(max:)`, `(multiple)`, `(options: …)` — there
  is no author-supplied value for those to constrain.
- Implicitly `optional: true` — it is filled by the system, and an undecided
  approval must never make a step look incomplete.
- May not appear inside a `{{#group (repeat)}}` block, for the reason a
  signature may not: one decision is not N.
- Must name a signature the same template declares. An unknown name fails at
  upload with the available signatures listed, rather than rendering blank
  forever at run time.

### 2. A comment field is never gathered, never edited, never reported

Everything ADR-043 §2 says about a signature applies unchanged, and is inherited
through the same two choke points rather than re-implemented:

| Choke point | Effect |
| --- | --- |
| `gatherableFields` | the AI prompt, the readiness gate and the manual edit dialog never see the field |
| `gatherableTemplateContent` | the tag is stripped from the template body before it reaches the session prompt or the RAG index |
| `validateStructuredFieldSet` | rejected in a structured step — no document, no approval comment |
| `validateTemplateFieldValue` | rejected if a caller ever submits a value for one |
| `UpdateDocumentFields` | excluded from the step output, so it stays out of reporting and out of the edit dialog |

Rendering stays the deliberate exception, as it is for signatures: the field must
reach `buildRenderData` to be written at all.

### 3. The value is the deciding approval's comment, verbatim

`approvalValuesForStep` (renamed from `signatureValuesForStep`) already walks the
session's approvals latest-decision-first and maps each signature slot to the
attestation block frozen into whichever approval filled it. It now carries the
**same approval's** `comment` out of that walk and maps it onto every
`approval_comment` field bound to that slot.

Same approval, same pass, one sort: the block and the note beside it can never
come from different decisions. A slot nobody has decided, or an approval decided
without a comment, renders an empty string — a document must never imply a
rationale that was not given, just as it must never imply an approval that did
not happen.

The comment is read from the approval row's own `comment` column, which is
written once by the pending-guarded update and never again. No new record key is
introduced, and the consequence is worth stating: **approvals already decided
before this change fill their comment tag on the next render**, because their
comment was captured all along.

The attestation block keeps its own `Comment:` row. It is frozen, hashed text
(ADR-043 §3) — altering it would alter what was signed.

### 4. The annotation editor can hold it and re-emit it unchanged

ADR-043 §5a is a correctness requirement, not a convenience: any field type the
parser accepts must be a type the guided editor can represent, because every
reviewed row is re-serialised from its model and written back into the author's
own `.docx`. A type the editor cannot hold is a tag the editor destroys.

So `FieldRowType` gains `approval_comment`, `FieldModel` gains `signatureLabel`,
and the row's settings panel offers a dropdown of the signatures declared
elsewhere in the same template — pre-selected when there is exactly one,
explaining itself when there are none yet. `fieldRowTypeOf` is exhaustive with no
`default:` arm, so the new member is a build failure until it is handled.

### 5. docx only, as signatures are

An xlsx template in `tags` mode rejects `(approval-comment)` at upload with a
message naming the limitation, for the same reason ADR-043 §7 rejects
`(approval)`: approval semantics in a spreadsheet cell are unclear, and guessing
produces something nobody can rely on.

## Risks

- **A new `TemplateFieldType` touches every exhaustive narrowing over field
  types.** ADR-043's consequences section records that the compiler did *not*
  catch this last time: the annotation editor's `fieldRowTypeOf` ended in a
  `default:` arm, so `signature` fell through to `text` and the editor rewrote
  authors' signature tags into `(optional)` text. That arm is exhaustive now, so
  `approval_comment` is a build failure until it is handled — but the order of
  work still matters: the type goes into the domain first, and the compiler is
  then used to find the rest.
- **The rename of `signatureValuesForStep` touches both render paths.** A missed
  call site would blank an approver's signature on the next manual edit, which is
  the failure that function exists to prevent. The rename is compiler-enforced
  rather than additive for exactly that reason.
- **An author can still put a comment tag on a document whose signature nobody
  signs.** It renders empty, as the signature slot beside it does. The canvas
  advisory for unclaimed slots (ADR-043 §5) already names that case, and this
  adds no new silence.

## Out of scope

- The attestation block's shape, contents and hash are unchanged.
- No new approval record key, no change to what is audited or hashed.
- Duplicate-label tags still dedupe silently, as they do for every other type.

## Tests, written before each implementation file

| File | Covers |
| --- | --- |
| `packages/domain/src/entities/template-field.test.ts` | parsing and the synonym; bare form with one / none / many signatures; unknown signature name; rejection inside a `(repeat)` group; constraint rejection; `templateFieldToLine` round-trip |
| `packages/domain/src/entities/node-output.test.ts` | excluded from `gatherableFields`; stripped from `gatherableTemplateContent`; rejected by `validateStructuredFieldSet` |
| `packages/application/src/use-cases/approvals/approval-values.test.ts` | comment mapped to its own slot; two signatures stay isolated; latest decision wins; blank comment stays blank; undecided stays blank |
| `packages/application/src/use-cases/document/update-document-fields.test.ts` | a manual edit re-render preserves comments and keeps them out of the step output |
| `packages/adapters/src/documents/xlsx-generator.test.ts` | rejected in a spreadsheet template |
| `apps/web/src/components/canvas/field-row-model.test.ts` | model round-trip, and the signature list offered to a comment row |

**No Playwright e2e.** None of this falls into the six groups in
`docs/guides/e2e-test-policy.md` — it is parser, render-path and component
logic, covered at the layer that owns it.
