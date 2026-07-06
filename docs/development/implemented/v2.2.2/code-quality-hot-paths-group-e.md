# Implementation Summary — Code Quality: Hot Paths, Group E (boundary tightening) (v2.2.2)

- **Version**: 2.2.2 (**PATCH** — dedupe, an added request-body validation, and
  doc annotations. No schema change; behaviour-neutral for valid requests).
- **Date**: 2026-07-05
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group E
  — Boundary tightening** (phase doc under `to-be-implemented/`).
- **Scope built**: items **15** (dedupe `getSessionToken`), **17** (Zod-validate
  the stream body), **18** (annotate duplicate ADR numbers). Items **14**
  (narrow the container surface) and **16** (move `confirmStep` out of the route
  dir) are deferred — both are entangled with Group B's `ExecuteTurn` extraction
  (`confirmStep` depends on `applyAdvanceSideEffects`/`recomputeBranchChoice`),
  which the phase notes "naturally falls out of Group B".

## What was built

### Item 15 — one `getSessionToken`

Eight copies of the same Better-Auth cookie parse (in `server/trpc.ts` and seven
API routes) had drifted in whitespace/style. Replaced them all with a single
`getSessionTokenFromRequest(request: Request)` in
`apps/web/src/lib/session-token.ts` (`Request` covers `NextRequest`, so every
caller passes its request straight through).

### Item 17 — validate the stream body

`apps/web/src/app/api/chat/[sessionId]/stream/route.ts` parsed the POST body with
a bare `as` cast, so a malformed body threw deep in the turn. It now `safeParse`s
against a new `streamTurnRequestSchema` from `@rbrasier/shared` (a permissive
`messages: { role, content }[]` shape — extra useChat fields are stripped); bad
JSON or a bad shape returns a clean `400`.

### Item 18 — disambiguate duplicate ADR numbers

Two ADRs are numbered 015 and two are numbered 026, and code comments cite both
numbers for *different* ADRs. Added a "Numbering note" blockquote to the top of
each of the four files pointing at its twin and naming which one the code
comments refer to. Not renumbered (code cites the numbers), exactly as the phase
directs.

## Files changed

- `apps/web/src/lib/session-token.ts` (new).
- `apps/web/src/server/trpc.ts` and 7 API routes
  (`chat/[sessionId]/stream`, `chat/[sessionId]/uploads`,
  `chat/[sessionId]/uploads/[uploadId]`, `sessions/[sessionId]/events`,
  `flows/[id]/context-docs`, `flows/[id]/nodes/[nodeId]/template`,
  `documents/[documentId]`) — use the shared helper.
- `packages/shared/src/schemas/chat.ts` (+ `.test.ts`) + schemas barrel;
  stream route validates the body.
- `docs/development/adr/015-flow-versioning-snapshots.adr.md`,
  `015-step-level-ai-overrides.adr.md`,
  `026-usage-governance-enforcement.adr.md`,
  `026-operator-confirmed-step-completion.adr.md` — numbering notes.
- `tests/e2e/phase-code-quality-hot-paths-group-e.spec.ts` (new).
- `VERSION`, `package.json` — 2.2.1 → 2.2.2.

## Migrations run

None.

## Tests added

- **Unit (shared)** — `streamTurnRequestSchema`: accepts a well-formed array and
  an omitted `messages`, strips unknown per-message fields, rejects a non-array
  `messages` and a message missing `content`.
- **E2E** — `phase-code-quality-hot-paths-group-e.spec.ts`: a malformed stream
  body (authenticated) returns `400`.

## Known limitations / follow-ups

- **Item 14** (narrow `container.repos.*` reach-through handed to routes) and
  **item 16** (move `confirmStep` out of the `app/api/.../stream/` directory to
  fix the inverted layering) are deferred to Group B — `confirmStep` is part of
  the turn orchestration that item 6's `ExecuteTurn` extraction relocates.
