# v1.10.1 — Context Document Extraction: review-driven improvements

**Version bump**: PATCH (no schema change; behavioural + UX improvements to v1.10.0)
**Date**: 2026-05-26

## Why this exists

v1.10.0 shipped context-document extraction with sensible defaults but several
quality issues caught on review:

1. Uploads always returned 201 — extraction failures were silently swallowed,
   leaving the AI with only filenames and no signal to the user.
2. The prompt builder truncated at inference time to enforce a budget, so the
   AI could be silently denied the last half of a document with no way to
   recover. Telling the AI to "ask the user to clarify the missing section" is
   no help when the user has no way to provide that section either.
3. XLSX was in the allowed MIME whitelist but extraction always failed — pure
   misdirection.
4. The chat system prompt was sent uncached, so the (potentially 16 K-token)
   stable per-flow prefix was re-charged at full rate on every turn.

## What changed

### Validation moved from inference to upload

- The extractor no longer caps per-document text. It returns the full extracted
  text and lets the caller decide.
- The upload route now sums existing context-doc char counts for the flow and
  rejects any upload that would push the total above 65 536 chars (HTTP 413,
  with `extractedChars` / `flowTotalChars` / `flowBudgetChars` in the body).
- Extraction failures (parse error, empty text) now return 422 with a clear
  remediation message; the stored blob is cleaned up.
- XLSX dropped from the allowed MIME whitelist. PDF, DOCX, TXT, Markdown only.

### Prompt simplification

- `flow-session-graph.ts`'s `buildDocsBlock` no longer sorts, truncates, or
  applies a budget. Every doc is rendered as `<document name="…">[full text]</document>`.
- Legacy rows with `failed` / `unsupported` status (from before the new
  validation existed) render as `<document name="…" status="unreadable">…</document>`
  so the AI knows the document is attached but cannot be read.

### Prompt caching for chat turns

- `stream-turn.ts` sends the system prompt as a `CoreSystemMessage` with
  `providerOptions.anthropic.cacheControl = { type: "ephemeral" }`.
- Anthropic cache token counts (`cacheReadInputTokens` / `cacheCreationInputTokens`)
  are pulled from `providerMetadata` and recorded in usage tracking.

### UI

- `ContextDocsStrip` shows per-doc char count alongside file size.
- A progress bar below the strip shows `<used> / 65 536 chars (X%)`, coloured
  green / amber (≥32 768) / red (>65 536).
- A contextual hint appears at the amber threshold explaining that the prompt
  prefix is cached, so the cost only hits once per 5-minute window.
- Backend rejection messages from 413 / 422 responses are surfaced verbatim.

## Files modified

| File | Change |
|------|--------|
| `packages/shared/src/schemas/context-docs.ts` | NEW: budget / threshold / MIME constants |
| `packages/shared/src/schemas/index.ts` | Export the new module |
| `packages/adapters/src/extraction/document-extractor-service.ts` | Removed per-doc cap; extractor returns full text |
| `packages/adapters/src/extraction/document-extractor-service.test.ts` | Updated to reflect no-cap behaviour |
| `packages/adapters/src/agents/flow-session-graph.ts` | Removed budget/sort/truncate logic; render legacy rows as `status="unreadable"` |
| `packages/adapters/src/agents/flow-session-graph.test.ts` | Replaced budget/truncation tests with full-text + unreadable-fallback tests |
| `apps/web/src/app/api/flows/[id]/context-docs/route.ts` | Hard-fail extraction errors and over-budget uploads; clean up blob on failure; include budget metadata in response |
| `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts` | System prompt sent as cached `CoreSystemMessage`; pull Anthropic cache tokens from `providerMetadata` |
| `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | Record cache read/write tokens in usage tracking |
| `apps/web/src/components/canvas/context-docs-strip.tsx` | Per-doc chars; usage progress bar; warning at 32 KB; XLSX removed from accept |
| `docs/development/implemented/v1.10.0/summary.md` | Updated to reflect the cumulative final design |
| `docs/development/to-be-implemented/` | NEW phase doc: Phase 2 (RAG with pgvector) design extracted from the v1.10.0 summary into its own deferred-phase doc |

## Out of scope

- The branch-choice prompt (`generateObject` call later in the chat route) is
  not cached. It runs at most once per turn-completion event and the prompt is
  small. Revisit if branching prompts grow.
- The document-generation prompt (`generate-document.ts`) uses
  `LanguageModelAdapter.generateObject` and is not cached. Document generation
  is a one-shot per session, so caching adds no value.

## Acceptance evidence

- `./validate.sh` passes.
- All tests pass: extractor (unchanged behaviour, no-cap assertions),
  flow-session-graph (full-text + unreadable fallback), stream-turn (cache
  message structure).
