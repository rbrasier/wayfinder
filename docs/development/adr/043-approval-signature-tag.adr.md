# ADR-043 — Approval Signature Tag, Slot Selection & the Attestation Block

- **Status**: Proposed (scoped by `approval-subject.prd.md`)
- **Date**: 2026-08-01
- **Builds on**: ADR-040 (approval subject, decision-time snapshot), ADR-018
  (approval step & approver resolution), ADR-024 (manual field editing and the
  document re-render path), ADR-033 (append-only audit log, hash chain),
  ADR-038 (step output types), ADR-039 (xlsx template format)

## Context

ADR-040 makes the approval record state *what* was approved. The approved
**document** still carries no evidence that a decision happened — a generated
purchase order or delegation instrument leaves the flow looking exactly as it
did before anyone signed off. For a product whose value is a governed,
auditable paper trail, that is the visible half of the gap.

Templates already carry the vocabulary to fix this. `parseTemplateFields`
(`packages/domain/src/entities/template-field.ts`) turns `{{ Tag (annotation) }}`
into a `TemplateField`, and that parsed set drives two things: what the
conversational node asks the operator for (`nodeFieldSet` in
`node-output.ts`, feeding `buildFieldConstraintsText` and
`evaluate-step-readiness`), and what is substituted at render time
(`buildRenderData` in `render-data.ts`).

A signature differs from every existing field type in one specific way: **the
operator must never be asked for it.** Its value is authored by a different
person (the approver), at a different node, after the document already exists.
Every current field type is the opposite — something the conversation gathers.

Real approval documents also carry **more than one** signature — delegate,
finance, legal — each owned by a different approval step in the same flow. So a
template has *N* signature slots and a flow has *N* approval nodes, and
something has to say which node fills which slot.

On the cryptography: ADR-042 brings client-certificate PKI under runtime auth
config, but that is **sign-in authentication** — it issues no document-signing
credential and signs no artefacts. Nothing in this codebase signs a document
today. What does exist is ADR-033's append-only `core_audit_log` with a
SHA-256 hash chain (`packages/domain/src/entities/audit-hash.ts`), which already
provides tamper evidence over recorded events.

Constraints carried forward from ADR-040: additive, no migration, and the
record is immutable once decided.

## Decision

### 1. `(approval)` is a new annotation producing a `signature` field type

```
{{ Delegate Signature (approval) }}
```

parses to
`{ key: "delegate_signature", label: "Delegate Signature", type: "signature", optional: true }`.
`signature` joins `TemplateFieldType`.

Validation rules, enforced at template upload where every other annotation error
is caught:

- `(approval)` is **exclusive of every other type keyword** — combining it with
  `(text)`, `(narrative)`, `(options: …)` etc. is a `VALIDATION_FAILED`, the same
  as any other double-type declaration.
- A signature field takes no `(maxlen:)`, `(min:)`, `(max:)`, `(multiple)` —
  there is no value for those to constrain.
- A signature field **may not appear inside a `{{#group (repeat)}}` block.** A
  signature is a single attested act, not a repeating item; allowing it inside a
  group would imply *N* decisions from one approval.
- It is implicitly `optional: true`, because it is filled by the system and must
  never make a step look incomplete.

### 2. A signature field is never gathered conversationally

`nodeFieldSet` filters `type === "signature"` out of the set it returns. That one
filter is load-bearing, and it is placed there deliberately rather than at each
call site, because every consumer must inherit it:

| Consumer | Effect |
| -------- | ------ |
| `buildFieldConstraintsText` → AI prompt | the model is never told the field exists, so it never asks for it |
| `evaluate-step-readiness` | an unsigned slot never blocks step completion |
| manual field editing (ADR-024) | an operator cannot type their own approver's signature |
| `validateStructuredFieldSet` (ADR-038) | `signature` is **rejected** in a structured field set, for the same reason `section` is — no document, no signature |

Filtering at one choke point is the whole safety argument: a signature slot the
conversation can reach is a signature an operator can forge.

**Amended v0.27.0 — the choke point needs an exported filter, because one caller
cannot reach it.** `EvaluateStepReadiness` resolves a template step's fields from
the node config *or* by extracting them from the template bytes, and the byte
path has no `ConversationalNodeConfig` to pass to `nodeFieldSet`. It therefore
returned the raw set, and the pre-generation gate extracted and graded the
signatures — reporting them as missing information, which the gate's fail path
streams straight into the thread as "Supervisor signature is blank" and then as a
question to the operator.

The exclusion is now exported as `gatherableFields` and applied on every branch.
A caller that cannot go through `nodeFieldSet` must still go through the same
predicate; being unable to reach the choke point is not permission to skip it.

**Amended v0.28.18 — the field set is not the only thing the model reads.** The
table above names `buildFieldConstraintsText → AI prompt` as *the* prompt
consumer. It is not. `FlowSessionGraph.buildSystemPrompt` also interpolates the
template **body** into `<document_template>` verbatim, under the instruction
"gather all information needed to fully complete the following template", and
`DrizzleReindexSourceRepository` indexes that same body as a `template` RAG
source whose chunks land in the same prompt. Neither path carries a field set, so
neither inherited the field filter, and the body still spelled out
`{{ Supervisor Signature (approval) }}` — enough on its own for the model to ask
the operator for a signature, during ordinary conversation rather than after a
cross-check.

`gatherableTemplateContent` is `gatherableFields` for the body, and both
prompt-facing readers of that text go through it. It drops a line whose only tags
are signatures **entire, label and all** — the reported transcript asked for
"First Level Supervisor Approval", the label rather than the tag, so removing the
tag alone leaves the invitation intact. A line also carrying a gatherable tag
survives with the signature replaced by `SIGNATURE_SLOT_MARKER` and a constraint
explaining it. Content left with nothing gatherable becomes null: no block, no
chunk.

The rule generalises past this fix: **anything a value-gathering model reads must
go through the exclusion, whether it arrives as fields or as prose.** A guard on
one prompt block would not have caught this leak and will not catch the next, so
the regression test asserts over the entire built prompt.

**Rendering is the deliberate exception.** `GenerateDocument` and
`ApplyApprovalSignature` keep the raw set, because a signature must reach
`buildRenderData` to be written at all — as the attestation once decided, as an
empty string until then. The rule is therefore *gathering* excludes signatures
and *rendering* includes them, which is why the filter cannot live in
`resolveTemplateFields`, the helper both the gate and generation share.

### 3. The value is an attestation block — not an image, not a certificate

On decision, the slot renders a fixed block built from the locked approval
record:

```
Approved by:   Jane Doe (jane.doe@example.com)
Role:          Delegate
Decision:      Approved
Date:          01-08-2026 14:32 UTC
Comment:       Within delegated authority.
Verification:  WF-3F9A2C1E7B04
```

`Verification` is the first 12 hex characters of a SHA-256 taken over the
canonical approval record, using the **same canonicalisation as
`AuditHashInput`** (`audit-hash.ts`) so the two never drift. The full 64-character
hash is what is chained into `core_audit_log` (ADR-033) and is the actual
evidence; the short code is a human-quotable handle for looking the record up,
not a security primitive, and nothing may treat it as one.

This is what makes the block a signature rather than decoration: the signer's
identity is bound by authenticated sign-in, and the content is bound by a hash
in an append-only chain. Alter the name, the date, the decision or the comment
and the recomputed hash no longer matches the chained one. That is the
identity-binding-plus-tamper-evidence pair that an *advanced electronic
signature* is defined by, reached with **no new dependency and no migration**.

Decisions are recorded verbatim: a `rejected` or `changes_requested` outcome
renders the same block with that decision named. An undecided slot renders as an
empty string — a document must never imply an approval that has not happened.

**Amended v0.28.21 — the comment may also stand on its own, bound by name.**
The block above is the only place a template could put the approver's comment,
and its shape is fixed: one `Comment:` row, in that order, wherever the signature
sits. An author wanting the rationale in a "Reason for decision" box, a table
cell beside the recommendation, or a covering paragraph had nowhere to put it.

`(approval-comment: <Signature Name>)` is a second annotation producing the
`approval_comment` field type, carrying `signatureLabel` — the signature tag's
own name, as the author wrote it:

```
{{ Delegate Signature (approval) }}
{{ Reason For Decision (approval-comment: Delegate Signature) }}
```

`(signature-comment: …)` is its synonym, for the reason `(signature)` is a
synonym of `(approval)`. `approvalCommentSlotKey` resolves the reference through
`deriveFieldKey` — the same derivation that produced the signature's own key from
its own label, so the two cannot disagree.

**The reference is explicit because §5 already settled that guessing is worse
than refusing.** A bare `(approval-comment)` binds to the template's only
signature and is a `VALIDATION_FAILED` with none or with two or more, on the
same reasoning as the lone-slot fallback: with several slots, a guess prints one
approver's words under another approver's name. A comment naming a signature the
template does not declare fails at upload with the available names listed, rather
than rendering blank forever at run time. Both are cross-tag rules, so they are
resolved in a pass after the whole tag list is walked — a comment tag may sit
*above* the signature it names, which is the ordinary layout for a rationale box.

The value is the deciding approval's `comment`, carried out of the same
latest-first pass that fills the signature slot, so the block and the comment
printed beside it can never come from different decisions. It is read from the
approval row's own column — written once by the pending-guarded update, never
again — so no new record key is introduced and an approval decided before this
amendment fills its comment tag on the next render. An undecided slot, or a
decision made without a comment, renders empty: a document must never imply a
rationale nobody gave, any more than an approval that never happened.

Everything §2 and §5a say about a signature applies unchanged to its comment, and
is inherited rather than re-implemented: `gatherableFields` and
`gatherableTemplateContent` are the same two choke points, the annotation editor
gains a row type whose settings panel is the signature picker, and a `(repeat)`
group refuses a comment for the reason it refuses a signature — one decision is
not *N*. The attestation block itself is untouched: it is frozen, hashed text,
and altering it would alter what was signed.

### 4. Plain runs, so the block renders everywhere

The block is ordinary text substituted by docxtemplater into normal runs. It
uses **no Word feature at all**, so it displays identically in Word 2007 and
every later desktop version, Word for Mac, Word Online, Google Docs, LibreOffice
and Pages — anything that opens a `.docx`.

This is the practical reason Word's own signature machinery is not used. A Word
**Signature Line** (`w:signatureLine`) and an OPC package **digital signature**
(XML-DSig) both need desktop Word to render and validate; in Word Online or
Google Docs a signature line degrades to an empty box and a package signature is
invisible or is stripped on the next save. A signature that disappears depending
on how the recipient opened the file is worse than no signature.

### 5. One approval node fills one slot; the node config picks which

`ApprovalNodeConfig` gains `signatureFieldKey?: string`. The config editor
behaves by count:

| Signature fields in the subject step's template | Control |
| --- | --- |
| 0 | no control shown; the approval simply records no signature |
| 1+ | a dropdown listing each slot by its `label`, required before save; a lone slot arrives pre-selected |

Two approval nodes in the same flow must not target the same
`signatureFieldKey` on the same document; that is a config-time validation
error, not a runtime surprise.

**Amended v0.27.0 — the default subject resolves to a step, and an unsigned slot
is warned about.** The slot list was empty whenever the subject was the
last-completed-step default, so the commonest shape — one document step, one
approval step, subject left on the default — could not target its own signature
at all. The config editor now predicts the default as the nearest earlier step
declaring fields, which in a linear flow is the step the runtime will have just
completed. The prediction is stated as one in the UI, and choosing a slot writes
an explicit `signatureFieldKey`, so a correct prediction becomes durable
configuration rather than a standing guess.

An unclaimed slot is otherwise **silent**: §3 renders an undecided slot as an
empty string, so the step completes, the document generates, and the signature
block is simply blank with nothing at run time to say it was meant to be filled.
The canvas therefore carries an authoring advisory naming each slot no approval
step signs, alongside the stranded-step warning. Claiming mirrors what actually
signs — a named key, or the lone-slot fallback above — and is scoped by subject
step, so an approval signing "signature" on one document cannot claim a
same-named slot on another.

**Amended v0.27.1 — the advisory resolves the default subject too.** Scoping a
claim by subject step is only sound if every approval *has* a resolvable subject
step, and one shape does not: the default stores no `approvalSubject` at all, so
a correctly bound approval left on it claimed nothing and the advisory fired on a
flow that was already signed. The advisory now resolves an unnamed subject the
way the runtime will — the nearest step upstream of the approval that declares
signatures — walking predecessors only, since a step downstream has not run when
the approval decides. The two halves of this amendment were added in the same
version and had to agree: making the default subject targetable while the
advisory still treated it as targeting nothing is what produced the false
warning.

**Amended v0.26.2 — a lone slot is bound explicitly, not implicitly.** As first
written, this table hid the control for exactly one slot and called it "bound
automatically". Nothing bound it: `signatureFieldKey` stayed empty in the config,
`DecideApproval` read it as `null`, and `ApplyApprovalSignature` returned
`no_signature_slot`. Every single-signature template went unsigned while the
editor said the opposite. A control that claims an effect it does not have is
worse than no control, so the dropdown now appears from the first slot.

Two approval steps must still not claim one slot, so the pre-selection is a
default the author can see and change — not a silent write.

The runtime keeps a **fallback for flows already saved under the old
behaviour**: when a node's `signatureFieldKey` is empty and the subject step
declares exactly one signature, `DecideApproval` binds that slot. This is
deliberately narrow. With two or more slots an empty key stays unbound, because
guessing which of several signatures a step fills would put a named person's
attestation in the wrong place on the document — a worse failure than not
signing at all.

### 5a. A signature is a first-class type in the annotation editor

`(approval)` is a type the template author selects, not merely one the parser
tolerates. The guided annotation editor lists it beside Text and Narrative, and
the annotation reference documents it.

This is a correctness requirement, not a convenience. The editor round-trips
every reviewed row through `modelToLine` and writes the result back into the
stored `.docx` (`buildAnnotationEdits`). A row the editor cannot represent is a
row it silently rewrites: before v0.26.2 a signature loaded as a plain text
field and saved as `{{ Name (optional) }}`, destroying the slot in the author's
own document. Any field type the parser accepts must therefore be a type the
editor can hold and re-emit unchanged.

Because a signature carries no author-supplied value, its per-field settings are
empty of constraints — no length, bound, multiplicity or required toggle, all of
which `parseTemplateField` rejects on a signature anyway.

The structured-conversation editor still omits it, for the reason §2 gives: no
document, no signature.

Note the scope this settles: ADR-040 keeps **one subject per approval node**.
Multiple signatures do not change that. A document with three signature slots is
three approval nodes, each with its own subject and its own record — not one
node approving three things.

### 6. Decision re-renders the document as a new revision

Filling a slot means re-rendering a document that already exists. No new
mechanism is needed: ADR-024's `update-document-fields` already re-renders from
template plus stored values and writes a new object at
`generated/{sessionId}/{basename}-r{n}.{ext}`, retaining the previous revision.
The decision path writes the attestation value into the stored document data and
goes through that same path.

Retaining the prior revision is the point, not a side effect — the unsigned draft
and the signed instrument both survive, so an auditor can see the document as it
stood when it was sent for approval.

**The re-render repoints the document, so later steps see the signed copy.**
`update-document-fields` already updates the message's `SessionDocument.storagePath`
to the new revision. The signature fill must go through that same update rather
than writing a detached object, because the next approval step resolves its
document *by pointer, at read time* (ADR-040 §2). Write a new object without
moving the pointer and a second approver is shown the unsigned original — which
is precisely the failure this section exists to prevent.

So in a flow of `conversational (2 slots) → approval A → approval B`, with both
approvals subject to the conversational step:

1. A decides → slot 1 renders A's attestation → document becomes `-r2`, pointer moves.
2. B's context resolves the conversational step's document *now* → `-r2`, **carrying A's signature**, with slot 2 still empty because it is undecided.
3. B decides → slot 2 renders → `-r3`.

Signature slots are independent, so approvals may decide in any order; each fills
only its own `signatureFieldKey` and leaves the others as they stand.

### 7. docx only for v1

An xlsx template (ADR-039) in `tags` mode **rejects** `(approval)` at upload with
a message naming the limitation. Signature semantics in a spreadsheet cell are
unclear — cell geometry, header-mode templates with no tags at all — and
guessing would produce a signature nobody can rely on.

## Alternatives considered

- **A user-uploaded handwritten signature image**, inserted with a docxtemplater
  image module. Rejected as the primary: an image is copyable from any previously
  signed document and proves nothing, while adding a dependency and a
  `core_user_signatures` table — a migration for negative security value. It can
  be layered on later *beside* the attestation block, never instead of it.
- **X.509 / PKI document sealing (AdES-grade).** The strongest legal standing,
  and the right answer if a regulated customer requires qualified signatures. It
  needs certificate issuance, key custody (HSM or KMS), rotation and revocation
  handling, plus a signing service — disproportionate at alpha, and ADR-042's
  PKI work provides none of it (that is sign-in, not signing). Deferred, not
  ruled out: the attestation block is a strict subset of what a sealed document
  would carry, so adding a seal later does not invalidate records made now.
- **Word Signature Lines / OPC XML-DSig.** Rejected on rendering (§4): breaks in
  Word Online and Google Docs, and is stripped by ordinary re-saves.
- **Reuse `(text)` with a naming convention** (e.g. any field called
  "signature"). Rejected: convention is not enforcement — a field the parser
  believes is `text` is a field the conversation will ask an operator to type,
  which is the one outcome this ADR exists to prevent.
- **Put the signature slot on the document/conversational node instead of the
  approval node.** Rejected: it inverts ownership. The approval node knows who
  decided and when; the document node does not, and would need to reach forward
  into a step that has not run.

## Consequences

**Positive**

- The approved document carries the decision, tamper-evident against the
  ADR-033 chain, with no new dependency and no schema change.
- One filter in `nodeFieldSet` makes operator-forged signatures structurally
  impossible rather than merely discouraged.
- Multi-signature documents work through ordinary composition — *N* approval
  nodes, *N* slots — with no multi-subject concept to build.
- Renders identically in every `.docx` reader, including web and mobile ones.
- Signed and unsigned revisions both persist, so the pre-approval state is
  auditable.

**Negative**

- A new `TemplateFieldType` touches every exhaustive `switch` over field types
  (`describeType`, `templateFieldToLine`, `validateTemplateFieldValue`,
  `buildRenderData`, the structured-field editor). Missing one is a silent
  wrong-behaviour bug, so the type must be added to the domain first and the
  compiler used to find the rest.

  This is what the v0.26.2 fix ran into, and the compiler did **not** find it.
  The annotation editor's `fieldRowTypeOf` maps a `TemplateField` onto its own
  narrower `FieldRowType`, and it ends in a `default:` arm rather than an
  exhaustive one — so `signature` fell through to `text` with no type error.
  Every place a domain type is narrowed onto a UI vocabulary needs an explicit
  arm per member, because a `default:` turns an unhandled case into plausible
  wrong behaviour instead of a build failure.
- The attestation block is **not** a qualified electronic signature. Anywhere it
  is described to users it must be called what it is; overclaiming legal
  standing is the failure mode to avoid.
- Approval now writes a document revision, so a decision can fail for storage
  reasons. The decision itself must still be recorded — the record is the source
  of truth, and a failed re-render is a retryable follow-up, never a lost
  approval.
- The 12-character verification code is a lookup handle with real collision
  probability at volume; any verification surface must resolve on the full hash.
- Templates authored before this ADR contain no signature tags and are entirely
  unaffected.
