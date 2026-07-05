# Implementation summary — v1.15.0 AI transparency info modals

## What was built

Two small `Info` icons + modals that surface the AI agent's reasoning to
the user without changing the surrounding chat flow.

- Every assistant message that has a persisted `aiPayload` now shows
  an `Info` button in the bottom-right of its bubble. The modal
  displays the AI's `rationale` for that turn, re-uses
  `<ConfidenceBar>` for the headline confidence, and exposes a
  collapsed `<details>` section titled "Insights gathered so far"
  showing the **accumulated** `{ key, value }` ledger across every
  prior assistant message in the session (last-write-wins on
  duplicate keys, first-seen ordering preserved).
- The `<DocumentCard>` rendered under a milestone now shows an
  `Info` button in its top-right corner when the owning message
  carries a `documentGenerationConfidence` block. The modal stacks
  two `<ConfidenceBar>` rows — "Alignment to flow guidance" and
  "Alignment to step criteria" — each followed by its rationale.
- After a document is generated, the `GenerateDocument` use-case
  makes a best-effort grading LLM call against the new
  `documentGenerationConfidenceSchema`; on success it merges the
  result into the milestone message's existing `aiPayload` via the
  new `ISessionMessageRepository.updateAiPayload` method. On grader
  failure or when the owning message has no prior `aiPayload`, the
  document still renders and the icon stays hidden.

## Files created

- `packages/application/src/services/accumulate-insights.ts`
- `packages/application/src/services/accumulate-insights.test.ts`
- `packages/application/src/services/index.ts`
- `apps/web/src/components/chat/message-info-modal.tsx`
- `apps/web/src/components/chat/message-info-modal.test.tsx`
- `apps/web/src/components/chat/document-info-modal.tsx`
- `apps/web/src/components/chat/document-info-modal.test.tsx`
- `docs/development/implemented/v1.15.0/ai-transparency-modals.md` (moved from `to-be-implemented/`)
- `docs/development/implemented/v1.15.0/implementation-summary.md` (this file)

## Files modified

- `packages/domain/src/entities/session-message.ts` — added
  `DocumentGenerationConfidence` interface and optional
  `documentGenerationConfidence` field on `AiTurnPayload`.
- `packages/domain/src/ports/session-message-repository.ts` — added
  `updateAiPayload(id, payload)` to `ISessionMessageRepository`.
- `packages/shared/src/schemas/confidence.ts` — added
  `documentGenerationConfidenceSchema` and its inferred type.
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` —
  implemented `updateAiPayload` against the existing `ai_payload`
  `jsonb` column.
- `packages/application/src/use-cases/document/generate-document.ts` —
  added `persistDocumentGrading` private method that runs after
  `updateDocument` succeeds. Best-effort: never blocks the document
  result.
- `packages/application/src/use-cases/document/generate-document.test.ts` —
  extended `makeLanguageModel` mock to discriminate by `purpose`;
  added three new tests covering happy path, grader-failure, and
  no-existing-payload.
- `packages/application/src/use-cases/session/session.test.ts` —
  added `updateAiPayload` to the in-memory fake repository.
- `packages/application/src/index.ts` — re-exports the new
  `services/*`.
- `apps/web/src/components/chat/message-feed.tsx` — made the bubble
  `relative`, renders `<MessageInfoModal>` when the message has
  `aiPayload`, and pipes `documentGenerationConfidence` to
  `<DocumentCard>`.
- `apps/web/src/components/chat/document-card.tsx` — accepts a new
  optional `documentGenerationConfidence` prop and renders
  `<DocumentInfoModal>` when it is non-null.

## Migrations run

**None.** The `app_session_messages.ai_payload` column is `jsonb`;
adding an optional field to the persisted JSON shape requires no
migration. Historical rows simply lack the new field, so the icon
hides itself for those rows.

## Known limitations

- The grader LLM call uses the same `ILanguageModel` instance the
  document data generation uses. The wiring layer
  (`apps/web/src/lib/container.ts`) currently routes both through
  the default chat model; if cost becomes a concern, the grading
  call can be re-wired to a cheaper branching-tier model — the
  use-case treats the call as best-effort either way.
- Confidence numbers are produced by the LLM and clamped to
  `[0, 100]` by schema validation; the rationale strings are the
  authoritative explanation. A hallucinated number is mitigated by
  rendering it next to its rationale paragraph.
- Older session messages predating this release will not have
  `documentGenerationConfidence` and will not retroactively gain
  one — the icon on those `<DocumentCard>` instances stays hidden.

## Version bump

**MINOR — 1.15.0**. New user-visible feature surface; new optional
field on `AiTurnPayload`; new repository method on
`ISessionMessageRepository`; new zod schema and inferred type in
`@rbrasier/shared`. No DB migration.
