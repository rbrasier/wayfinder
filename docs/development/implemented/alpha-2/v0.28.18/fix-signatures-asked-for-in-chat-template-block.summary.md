# Implementation Summary — Signatures asked for in chat, via the template body (v0.28.18)

- **Version**: 0.28.17 → **0.28.18** (PATCH — bug fix, no schema change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-signatures-asked-for-in-chat-template-block.md` (this folder)

## Symptom

At turn 3 of an ordinary conversation — no cross-check involved — the model
asked the operator for the First and Second Level Supervisor sign-offs, then
carried both into its step recap as `Pending`.

## Root cause

Not a regression of the v0.27.0 fix, which is intact: every branch of
`EvaluateStepReadiness.resolveFields` still runs through `gatherableFields`, and
`nodeFieldSet` still filters `type === "signature"`.

`FlowSessionGraph.buildSystemPrompt` builds two things from the same node config
and filters only one. `gatheredFields` goes through `nodeFieldSet`;
`documentTemplateStructuredContent ?? documentTemplateContent` — the template
**body** — is interpolated into `<document_template>` verbatim, under the
instruction *"gather all information needed to fully complete the following
template"*. The body still spells out
`{{ First Level Supervisor Approval (approval) }}`, so the model was handed two
visibly unfilled slots and told to complete them.

`nodeFieldSet` is a field-set filter and never claimed the template text. ADR-043
§2's consumer table named `buildFieldConstraintsText → AI prompt` as *the* prompt
consumer; the template block is a second prompt consumer reaching the same model
by a path carrying no fields at all. It predates the v0.27.0 fix unchanged, which
is why the v0.27.0 write-up's claim that "the chat's own prompt was never
affected" was wrong when it was written.

The same raw body is also indexed by `DrizzleReindexSourceRepository` as a
`template` RAG source, and retrieved chunks land in the very same system prompt —
the same leak by a second, weaker route.

## Fix

1. **`gatherableTemplateContent`** in `node-output.ts`, beside `gatherableFields`
   — `gatherableFields` for the template body — with `isSignatureTag` exported
   from `template-field.ts` to back it. Applied at both prompt-facing readers:
   the `<document_template>` block and the RAG indexer.
2. **Whole lines, not just tags.** The transcript asked for *"First Level
   Supervisor Approval"* — the **label**, not the tag — so removing the tag alone
   would leave that label standing over a blank. A line whose only tags are
   signatures is dropped entire. A line that also carries a gatherable tag
   survives for that tag's sake, with the signature replaced by
   `SIGNATURE_SLOT_MARKER` and a `<constraints>` line — emitted only when a
   marker actually was — explaining that it is recorded by an approval step and
   must never be asked for or reported as outstanding.
3. **Null when nothing gatherable remains**, so a template of signatures alone
   yields no `<document_template>` block and no indexed chunk, rather than a body
   of markers.
4. `isSignatureTag` reads the `(approval)` annotation off the raw tag rather than
   parsing the whole tag: a tag that would fail validation for an unrelated
   reason is still a signature slot, and a safety filter must not depend on the
   tag being well-formed.
5. `listTemplates`'s row mapping extracted as the pure `templateReindexDocument`,
   mirroring `approvalPatchToColumns` in `drizzle-approval-repository.ts`, so the
   guard is testable at the layer that owns it without a database.

Rendering is untouched and still the deliberate exception: `buildRenderData`
reads the raw body and the raw field set, because the tag must survive to be
substituted with the attestation (ADR-043 §3).

## Regression tests

| Guard | Failed before because |
|---|---|
| `flow-session-graph.test.ts` — the **whole** prompt contains neither `(approval)` nor either supervisor label, while `{{Full Name}}` survives | the template body was interpolated verbatim |
| `flow-session-graph.test.ts` — the summarised body is filtered too, and never falls back to the raw one | only one of the two sources was ever read, neither filtered |
| `flow-session-graph.test.ts` — a signature-only template emits no `<document_template>` at all | it emitted the block with the tag in it |
| `flow-session-graph.test.ts` — a signature sharing a line with a gatherable field leaves an explained marker; a template with no signature gets no signature guidance | neither the marker nor the constraint existed |
| `node-output.test.ts` — 9 cases over `gatherableTemplateContent`: line dropping, mixed lines, byte-identical passthrough, annotation case, malformed tags, `Approval Notes` not matching, null | the function did not exist |
| `drizzle-reindex-source-repository.test.ts` — indexed template text carries no signature slot, and a signature-only template is skipped | the raw body was indexed as-is |

The three `flow-session-graph` guards were confirmed failing against the
unfixed code, on the assertion rather than on a missing import — the prompt
demonstrably contained `(approval)` and `Delegate Signature`.

`./validate.sh` — 24 of 24, 0 failures.

## E2E

**None.** This is prompt-string construction; it falls into none of the six
groups in `e2e-test-policy.md`, and the unit guards above run on every
`./validate.sh`. The v0.27.0 spec `fix-signatures-asked-for-in-chat.spec.ts` no
longer exists — it was removed by the e2e triage in 0.28.2 — and nothing was
re-added in its place.

## Known limitations

- **The RAG fix is forward-only.** Chunks indexed before this change keep their
  signature tags until a reindex is run. Not triggered here: a reindex is an
  operator action with its own cost, and the template block — fully fixed — was
  the verified cause of the reported transcript.
- A line dropped for carrying only a signature also loses any prose on that line.
  That prose is an instruction to the signer, not information for the
  conversation to gather, so losing it from the gathering copy is intended.
- `input.templateFields` on `BuildSystemPromptInput` still overrides
  `nodeFieldSet` unfiltered. No production caller supplies it; left alone rather
  than widening this fix.
