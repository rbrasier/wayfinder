# v1.11.0 — Template Content Limits & Structural Stripping

## What was built

A two-layer approach to template content used during chat:

1. At upload time, the raw `.docx` is extracted to full plain text (existing
   behaviour) **and** summarised by the language model into a structural
   skeleton — headings, field labels and `{{tag}}` placeholders preserved
   verbatim; long prose paragraphs dropped.
2. The structural version is the one injected into the system prompt on
   every chat turn. The full extracted text is still persisted for backward
   compatibility and document-generation context, but is no longer the
   primary prompt input.

Uploads where the structural content exceeds 16 384 chars are rejected
with HTTP 422 and a clear error message. The upload response now reports
`templateContentLength` so the UI can show prompt-budget usage.

Document generation is unaffected — it still runs against the raw `.docx`
bytes from object storage.

## Files created

- `packages/shared/src/schemas/templates.ts` — `TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS` (16 384), warning threshold (12 288).
- `packages/application/src/use-cases/document/summarise-template.ts` — `SummariseTemplate` use case wrapping `ILanguageModel.generateObject`. Falls back to full text on AI error or empty response.
- `packages/application/src/use-cases/document/summarise-template.test.ts` — 5 tests covering happy path, prompt content, purpose label, AI-error fallback, empty-response fallback.

## Files modified

- `packages/shared/src/schemas/index.ts` — re-export the new templates module.
- `packages/shared/src/schemas/document.ts` — add `templateStructureSchema` (Zod schema for the AI response shape).
- `packages/domain/src/entities/flow-node.ts` — add optional `documentTemplateStructuredContent` to `ConversationalNodeConfig`.
- `packages/application/src/use-cases/document/index.ts` — export the new use case.
- `apps/web/src/lib/container.ts` — register `summariseTemplate` in `useCases`.
- `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` — call the summariser after extraction, reject on size cap, persist both content variants, return `templateContentLength`. DELETE handler also clears the new field.
- `packages/adapters/src/agents/flow-session-graph.ts` — `templateBlock` prefers `documentTemplateStructuredContent` with fallback to `documentTemplateContent`.

## Migrations run

None — the new field lives on the existing `app_flow_nodes.config` JSONB column. Legacy nodes without the field continue to work via the prompt-builder fallback.

## Backfill

None. By design: nodes uploaded before this phase keep `documentTemplateStructuredContent === undefined` and the prompt builder falls back to the full extracted text for them. Re-upload of a template populates the new field.

## Known limitations

- The summariser AI call adds latency to template upload (typically a few seconds). Templates are uploaded infrequently, so this is acceptable.
- The summariser could in principle drop a placeholder tag during the structural reduction. Document generation is unaffected (it uses raw `.docx` bytes) — only the AI's awareness of what to gather during conversation would be impaired. Future work could add a tag-presence validation in the use case.
- Very large templates (e.g. > 100 KB extracted text) result in a large summariser prompt. If extracted text alone hits language-model context limits the upload will fail before reaching the size-cap check. A pre-truncation step could be added if this becomes a problem in practice.

## Version bump applied

**MINOR**: `1.10.1 → 1.11.0` — new optional field on `ConversationalNodeConfig`, validation behaviour change at upload, new use case wiring. No DDL changes.
