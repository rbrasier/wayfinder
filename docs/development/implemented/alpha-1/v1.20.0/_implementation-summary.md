# v1.20.0 — Session File Upload (end-user mid-flow context)

- **Version bump**: MINOR — new `app_session_uploads` table, new domain entity +
  port, new use cases, new routes. No breaking change.
- **Phase doc**: `session-file-upload.phase.md` (this folder).

## What shipped

End users can attach a file (PDF / DOCX / TXT / Markdown) mid-conversation via a
**paperclip** button on the chat composer. The file is stored in MinIO and its
text extracted at upload time; the extracted text is then injected into the AI
system prompt as a distinct `<session_uploads>` block on **every subsequent turn**
of that session — the session-scoped counterpart to flow-level context docs.

Uploads are listed as removable chips above the composer; removing a chip deletes
the upload (DB row + best-effort blob cleanup) so it leaves the AI context.

Two limits — **max file size** and **total context budget (chars)** — are
**admin-configurable** with built-in defaults, edited via a new **Session Uploads**
card on `/admin/settings`, following the existing AI/Storage structured-config
pattern (parsed-with-defaults + cached in `RuntimeConfigStore`).

## Key design choices

- **Single dedicated table** (`app_session_uploads`) holds both metadata and
  extracted text, since sessions have no JSONB metadata column to split into (the
  flow context-doc feature splits across `app_flows.context_docs` +
  `kb_context_doc_content`).
- **Separate prompt block** frames session uploads as user-supplied input, not
  authoritative reference material — preserving provenance vs flow context docs.
- **Per-session char budget** enforced at upload time via the pure domain helper
  `sumSessionUploadChars`.
- **apps/api untouched** — that REST container wires no session/storage logic, so
  the feature lives entirely in `apps/web`.

## Files added

- `packages/shared/src/schemas/session-uploads.ts` — limits/defaults + allowed MIME types
- `packages/domain/src/entities/session-upload.ts` (+ test) — entity + budget helper
- `packages/domain/src/ports/session-upload-repository.ts` — `ISessionUploadRepository`
- `packages/adapters/src/repositories/drizzle-session-upload-repository.ts`
- `packages/application/src/use-cases/session/add-session-upload.ts` (+ test)
- `packages/application/src/use-cases/session/remove-session-upload.ts`
- `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts` (GET list, POST upload)
- `apps/web/src/app/api/chat/[sessionId]/uploads/[uploadId]/route.ts` (DELETE)
- `packages/adapters/drizzle/0014_session_uploads.sql`

## Files modified

- `packages/domain/src/entities/runtime-config.ts` — `SessionUploadConfig` + setting key
- `packages/domain/src/ports/session-agent.ts` — `BuildSystemPromptInput.sessionUploads`
- `packages/domain/src/entities/index.ts`, `ports/index.ts` — exports
- `packages/shared/src/schemas/index.ts` — export
- `packages/adapters/src/db/schema/wayfinder.ts` — `app_session_uploads` table
- `packages/adapters/src/agents/flow-session-graph.ts` (+ test) — `<session_uploads>` block
- `packages/adapters/src/config/runtime-config-store.ts` (+ test) — session-upload config
- `packages/adapters/src/repositories/index.ts` — export
- `packages/application/src/use-cases/session/index.ts` — exports
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — load + pass session uploads
- `apps/web/src/server/routers/settings.ts` — get/set session-upload config
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — Session Uploads card + modal
- `apps/web/src/components/chat/chat-composer.tsx` — paperclip + chips
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — pass `sessionId`
- `apps/web/src/lib/container.ts` — wire repo + use cases

## Migrations

- `0014_session_uploads.sql` — creates `app_session_uploads` (FK
  `session_id → app_sessions` cascade, `message_id → app_session_messages` set null,
  unique `storage_path`, index on `session_id`). Run with `pnpm --filter @rbrasier/adapters db:migrate`.
