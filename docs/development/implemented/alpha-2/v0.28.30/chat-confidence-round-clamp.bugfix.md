# Bug fix — Round and clamp chat and doc-gen confidences

**Severity:** minor (proactive hardening — not yet observed in chat)
**Base branch:** `release/alpha-2`
**Source issue:** none (follow-up to the extraction fix in #316 / #317)

## Change summary (approved)

The chat turn and the document-generation gate stop failing when the model
returns a confidence that is not a whole number from 0 to 100. A helper in
`packages/shared` rounds and clamps the value to 0–100, and the three
gating confidence fields use it in place of `.int().min(0).max(100)`.
Fractions are deliberately not scaled up: a stray `0.85` reads as 1%, so the
step stays put rather than advancing early.

### Business rules changing

- Today: any confidence that is not a whole number from 0 to 100 fails the whole
  reply. After: it is rounded and clamped (`87.5` → 88, `140` → 100, `-5` → 0).
- A 0–1 fraction (`0.85`) is rounded to 1, not scaled to 85, so the advance and
  doc-gen thresholds read it as "not confident" and the model gets another turn.
- Extraction keeps its own rule from #316 (scales fractions), because there the
  confidence only colours the review screen.

### Out of scope

- Scaling fractions; porting to `main`; changing the extraction rule.

## Root cause

`packages/shared/src/schemas/confidence.ts` declares
`turnResponseSchema.stepCompleteConfidence` and the two alignment confidences in
`documentGenerationConfidenceSchema` (reused by `preGenerationEvaluationSchema`)
as `z.number().int().min(0).max(100)`. The AI SDK validates the model's final
object against the schema, so a reply such as `87.5`, `0.85` or `140` fails
validation as a whole:

- `execute-turn.ts` (chat turn) and the gap follow-up in `turn-helpers.ts`: the
  reply text has already streamed, then the final object fails and the turn errors.
- `turn-helpers.ts` (step opening message): the failure is logged and the step
  opens with no greeting.
- `grade-document.ts` (pre-generation gate): the evaluation fails outright.

## Reproduction

`turnResponseSchema.safeParse({ ..., stepCompleteConfidence: 87.5 })` returns
`success: false`; likewise `preGenerationEvaluationSchema` with
`guidanceAlignmentConfidence: 140`.

## Fix plan

1. Add schema tests for `87.5` → 88, `140` → 100, `-5` → 0, `0.85` → 1 and
   whole numbers unchanged, for the turn schema and both alignment fields.
2. Add a private `toBoundedPercentConfidence` helper in `confidence.ts` and
   replace `.int().min(0).max(100)` with `.transform(toBoundedPercentConfidence)`
   on the three fields.
3. PATCH bump.
