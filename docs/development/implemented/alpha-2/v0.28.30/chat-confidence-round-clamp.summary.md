# Implementation summary — Round and clamp chat and doc-gen confidences

- **Version**: 0.28.29 → **0.28.30** (PATCH — no schema change, no migration).
- **Root cause**: `turnResponseSchema.stepCompleteConfidence` and the two alignment
  confidences in `documentGenerationConfidenceSchema` / `preGenerationEvaluationSchema`
  were `z.number().int().min(0).max(100)`, so a model reply of `87.5`, `0.85` or `140`
  failed validation and errored the chat turn, left a step's opening message blank, or
  failed the pre-generation gate.
- **Fix applied**: a private `toBoundedPercentConfidence` helper in
  `packages/shared/src/schemas/confidence.ts` rounds and clamps to 0–100; the three
  fields use `.transform(toBoundedPercentConfidence)`. Fractions are not scaled, so
  `0.85` becomes 1 and never advances a step or passes the gate.
- **Regression tests**: `packages/shared/src/schemas/confidence.test.ts` — rounding,
  clamping, the unscaled fraction and unchanged whole numbers, for the turn schema and
  both alignment fields. The old "rejects an out-of-range confidence" test is replaced
  by the clamp test.
- **E2E**: none — schema validation is not in any of the six groups in
  `docs/guides/e2e-test-policy.md`; the schema test is the guard.
- **Known limitation**: the JSON schema sent to the model loses its integer/min/max
  hints (a transform exposes plain `number`); the field description still states 0-100.
- **Deviations from the approved summary**: none.
