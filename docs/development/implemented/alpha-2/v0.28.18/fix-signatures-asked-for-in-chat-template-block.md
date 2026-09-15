# Bug fix — the conversation asks for signatures again, via the template body

- **Reported**: 2026-09-07
- **Severity**: Major — the operator is asked to supply a value only an approver
  may write, and the step recap carries it as outstanding
- **Base branch**: `release/alpha-2`
- **Version**: 0.28.17 → **0.28.18** (PATCH — bug fix, no schema change)
- **Relates to**: ADR-043 (signature slots §2), v0.27.0
  (`fix-signatures-asked-for-in-chat`)

## Symptom, as reported

> A user shouldn't be asked for signatures as part of the chat (only via
> approval nodes — signatures should be excluded from chat fields to fill out).

With the transcript:

```
> Joe Bloggs, Legal

Thanks! I've got Joe Bloggs joining Legal. Now I just need his start date …

> 14 sept

Great, so Joe Bloggs will start on 14-09-2026 in Legal. Now, for approvals — do
you have the First Level Supervisor's sign-off, and also the Second Level
Supervisor's sign-off, ready to record for this form?

> skip, done in the flow later

… here's what I have for Step 1:
  - First Level Supervisor Approval: Pending
  - Second Level Supervisor Approval: Pending
```

## Why this is not the v0.27.0 bug returning

v0.27.0 fixed `EvaluateStepReadiness.resolveFields`, which bypassed
`nodeFieldSet` and fed raw fields to the pre-generation gate. That fix is
**intact** — every branch of `resolveFields` still runs through
`gatherableFields`, and `nodeFieldSet` still filters `type === "signature"`.

That defect had a signature: the demand appeared *after* a cross-check, phrased
as missing information ("Supervisor signature is blank"). This one appears at
**turn 3, in ordinary conversation**, phrased as a question the model chose to
ask. Different path, and one the v0.27.0 write-up explicitly ruled out:

> The chat's own prompt was never affected — `flow-session-graph.ts` reads
> `nodeFieldSet`, so the model gathering fields does not know the slot exists.

That claim was wrong, and it was wrong when it was written — the block below
predates v0.27.0 unchanged.

## Root cause

`FlowSessionGraph.buildSystemPrompt` builds two independent things from the same
node config, and only one of them is filtered:

```ts
const templateContent =
  nodeConfig.documentTemplateStructuredContent ?? nodeConfig.documentTemplateContent;
const templateBlock =
  outputType === "generate_document" && templateContent
    ? `\n\n  <document_template>\n    This step produces a document. Your goal is to gather all information needed to fully complete the following template:\n    ${templateContent}\n  </document_template>`
    : "";

const gatheredFields = input.templateFields ?? nodeFieldSet(nodeConfig);   // filtered
```

`gatheredFields` goes through the choke point. `templateContent` does not — it is
the template **body**, interpolated verbatim, carrying every tag the author
wrote:

```
First Level Supervisor Approval: {{ First Level Supervisor Approval (approval) }}
Second Level Supervisor Approval: {{ Second Level Supervisor Approval (approval) }}
```

The instruction wrapped around it is the operative half: *"Your goal is to gather
all information needed to fully complete the following template."* The model is
handed a template with two visibly unfilled slots and told to gather everything
needed to complete it, so it asks for them. It then carries them into its own
step recap as `Pending`, because from the prompt's point of view they are.

`nodeFieldSet` is a **field-set** filter. It has never claimed the template text,
and nothing else did either. ADR-043 §2's consumer table lists
`buildFieldConstraintsText → AI prompt` as *the* prompt consumer; the template
block is a second prompt consumer that reaches the same model by a path carrying
no fields at all.

### The same text leaks a second way

`DrizzleReindexSourceRepository.listTemplates` indexes
`config.documentTemplateContent` — the same raw body — as a RAG source of type
`template`. Retrieved chunks are injected into the very same system prompt as
`<reference_documents>`, so a signature tag can reach the gathering model even
when the template block is absent or truncated. Weaker and less deterministic
than the template block, but the same class of leak and the same fix.

## Reproduction

1. A conversational step with `outputType: "generate_document"` whose template
   declares one or more `{{ … (approval) }}` tags.
2. `documentTemplateContent` (or `documentTemplateStructuredContent`) therefore
   contains those tags verbatim — `SummariseTemplate` is instructed to
   "preserve every placeholder tag verbatim", so summarisation keeps them.
3. Start a session and answer the step's real fields.
4. The model asks for the signature slots by their template label, and lists
   them as outstanding in its recap.

Reproduced at the unit level: `FlowSessionGraph.buildSystemPrompt` for such a
config returns a prompt string containing both the signature labels and
`(approval)`.

## Fix plan

### 1. Give the template text the same choke point the field set has

Add `gatherableTemplateContent` to `node-output.ts`, beside `gatherableFields`,
and a supporting `isSignatureTag` predicate to `template-field.ts`. Applied at
both prompt-facing readers of that text: the `<document_template>` block, and
the RAG indexer that feeds `<reference_documents>`.

**Dropping the line, not just the tag.** Removing the tag alone is not enough,
and the reported transcript is the proof: the model asked for *"First Level
Supervisor Approval"* — the **label**, not the tag. A template introduces its
slot with that label, so deleting the tag leaves `First Level Supervisor
Approval:` standing over a blank, which is the same invitation in a thinner
disguise. So:

- a line whose **only** tags are signatures is dropped entire, label and all;
- a line that **also** carries a gatherable tag must survive for that tag's sake,
  and there the signature alone becomes a fixed marker —
  `[signature slot — recorded by an approval step, never gathered in conversation]`
  — with a `<constraints>` line, added only when a marker was actually emitted,
  saying it is recorded by an approval step and must never be asked for or
  reported as outstanding;
- content left with nothing gatherable returns `null`, so a template of
  signatures alone produces no template block and no indexed chunk at all,
  rather than a body of markers.

`isSignatureTag` reads the `(approval)` annotation off the raw tag rather than
running the tag through `parseTemplateField`, so a tag that would fail validation
for some unrelated reason is still recognised and still filtered. This is a
safety filter; it must not depend on the tag being otherwise well-formed.

### 2. Make the guard cover the whole prompt, not the block

The regression test asserts that the **entire** built system prompt contains
neither the signature labels nor `(approval)` — not that one block is clean.
Two leaks have now been found in two different prompt inputs; a guard scoped to
the block that leaked would not have caught this one, and would not catch a
third.

## Out of scope

- **Rendering keeps the raw tags.** `GenerateDocument` and `buildRenderData` must
  still see the signature to write the attestation, or an empty string until one
  exists (ADR-043 §3). The asymmetry is deliberate: gathering excludes
  signatures, rendering includes them.
- **Already-indexed RAG chunks.** The indexer fix is forward-only; chunks written
  before it keep their tags until a reindex is run. Not triggered here — a
  reindex is an operator action with its own cost, and the template block was the
  verified cause of the reported transcript.
- **`input.templateFields`** on `BuildSystemPromptInput` is an unfiltered
  override of `nodeFieldSet`, but no production caller supplies it. Left alone
  rather than widening this fix.
