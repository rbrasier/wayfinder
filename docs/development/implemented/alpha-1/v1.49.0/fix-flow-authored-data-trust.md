# Fix: the engine trusts flow-authored data blindly

Three high-severity bugs surfaced during local testing of a real flow (PIA
report, `c3e65eaf`). The common theme: data authored into a flow — by import,
seed, or AI generation — reaches the engine with no validation, normalisation,
or budgeting, and the engine trusts it.

## Bug 1 — Confidence threshold has no scale guard

**Symptom.** Every step auto-advanced on its own welcome message, before the
user typed anything.

**Root cause.** `advanceConfidenceThreshold` is compared against a 0–100
confidence (`stream/route.ts` `realThreshold = nodeConfig.advanceConfidenceThreshold ?? 90`),
but the flow stored it as fractions (0.7 / 0.75 / 0.7). `5 >= 0.7` is always
true, so every turn advanced. The field is typed only as `number?`
(`flow-node.ts`), with no range validation on write and no normalisation on
read, and no in-app UI writes it — so any import/seed/AI-generated flow can
introduce wrong-scale data.

**Fix.** Normalise on read at the engine boundary: a value `> 0 && <= 1` is
treated as a fraction and multiplied by 100; the result is clamped to
`[0, 100]`; missing/invalid falls back to the 90 default. A pure domain helper
(`normaliseAdvanceConfidenceThreshold`) is the single source of truth, unit
tested, and applied where the threshold is read in the chat route.

## Bug 2 — Attachments are invisible to the chat agent

**Symptom.** After a successful upload (text extracted, chunks embedded), the
agent replied "I don't see any content attached or pasted in your message."

**Root cause.** The chat turn fed the model only the typed message plus RAG
chunks retrieved by similarity to that message. A thin message ("here is the
solution") retrieves little or nothing, the session upload's `extractedText`
is never injected directly, the turn carries no "a file was attached" signal,
and retrieved chunks are framed as generic reference excerpts rather than as
documents the user just provided.

**Fix.** When the session has completed uploads, inject an attachments block
(filename manifest + budget-truncated extracted text, capped by the configured
session-upload budget) into the system prompt independent of RAG, framed as
documents the user attached; and annotate the user turn shown to the model with
`[Attached: <filename>]`.

## Bug 3 — Document generation overflows the model context window

**Symptom.** The final "Produce PIA Report" step failed:
`AI_APICallError: prompt is too long: 206750 tokens > 200000 maximum`.

**Root cause.** `buildContextDocsSection` injected the full `extractedText` of
every flow context doc with no budget/truncation/RAG, while the chat path uses
top-k RAG and stays small. One reference (Information Security Manual, ~177k
tokens) blew the window.

**Fix.** Budget the context-doc section with a hard character cap (derived from
a token budget that leaves headroom for template + transcript + output);
truncate with an explicit marker. Generate the document in field batches rather
than one giant call, so the prompt and structured output per call stay bounded.
A pre-flight estimate fails gracefully with a clear message if a single batch is
still over budget, instead of letting the provider throw.

## Product follow-on — global prompt surface

Tone and Australian-English spelling were added per-flow during testing. Rather
than hardcode a specific global prompt, add an admin surface ("Global AI
instructions") stored as a system setting and injected into every session
system prompt, so an operator can set organisation-wide guidance without editing
each flow.

## Regression coverage

- Unit: `normaliseAdvanceConfidenceThreshold` scale/clamp/default cases.
- Unit: `buildContextDocsSection` truncates to budget; `extractStructuredFields`
  batching merges per-batch results.
- Unit: `buildSystemPrompt` renders the attached-documents and global-instruction
  blocks.
- E2E: confidence-scale step does not auto-advance on the opener; attachment is
  consulted on a thin message; large context docs no longer overflow generation.

## Implementation summary (v1.49.0, MINOR — new global-instructions feature)

**Bug 1.** New pure domain helper `normaliseAdvanceConfidenceThreshold`
(`packages/domain/src/entities/confidence-threshold.ts`): a value in `(0, 1]` is
scaled ×100, the result is clamped to `[0, 100]`, and missing/non-finite falls
back to 90. Applied at the read boundary in `stream/route.ts` where `realThreshold`
is derived. Regression: `confidence-threshold.test.ts`.

**Bug 2.** `BuildSystemPromptInput` gains `sessionUploads`; `FlowSessionGraph`
renders an `<attached_documents>` block framed as the user's own files,
independent of RAG. `stream/route.ts` fetches the session's completed uploads,
budgets them via `buildPromptSessionUploads` (capped by the configured session
upload budget), injects them, and annotates the model's user turn with
`[Attached: …]` via `buildAttachmentAnnotation` (the persisted message stays
raw). The step-opener path (`generateInitialMessage`) injects uploads too.
Regression: `flow-session-graph.test.ts`, `turn-helpers.test.ts`.

**Bug 3.** `buildContextDocsSection` now truncates the combined context-doc text
to `CONTEXT_DOCS_CHAR_BUDGET` (~100k tokens) with explicit truncation/omission
markers; `extractStructuredFields` runs a pre-flight token estimate and returns a
clear `VALIDATION_FAILED` error instead of letting the provider throw;
`GenerateDocument` generates fields in batches (`FIELD_BATCH_SIZE = 12`), merging
per-batch results, so no single call carries the whole document. Regression:
`structured-fields.test.ts`, `generate-document.test.ts`.

**Global prompt surface.** `BuildSystemPromptInput.globalInstructions` renders a
`<global_instructions>` block; the `global_prompt` system setting is fetched
alongside `organisation_name` in every prompt-building path (chat route, step
opener, confirm-step, scheduled opener, flow preview). New admin card "Global AI
Instructions" on the settings page reuses the generic `settings.get/set`.

**Version.** MINOR `1.48.3 → 1.49.0` (new global-instructions feature; no schema
change — `system_settings` is key/value).

**Validation.** `./validate.sh` — all 14 checks pass.

## Out of scope (intentionally)

- Demo-mode metadata skip: a per-flow demo instruction with no general code home.
- Minor observations (stale `test@test.com` Better Auth user; scheduler env vars
  `SCHEDULER_TICK_URL`/`SCHEDULER_TICK_SECRET`): deployment/config, not code.
