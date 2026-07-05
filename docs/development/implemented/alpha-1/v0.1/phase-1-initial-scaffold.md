# Phase 1 — Initial Scaffold

> This file was originally created in `to-be-implemented/` by the
> "New App / Feature Setup" skill, and moved here when Phase 1 was
> implemented and `VERSION` was bumped to 0.1.0.

- **Status**: Implemented
- **Target version**: 0.1.0  (bump: MINOR — first feature release on top of 0.0.0)
- **PRD**: n/a (this is the foundational scaffold)
- **ADRs**: 001-hexagonal-architecture, 002-multi-provider-ai,
  003-monorepo-structure, 004-langgraph-adapter-boundary

## 1. Problem

We need a starting point for AI applications that resists provider churn,
keeps business logic testable without infrastructure, and bakes in good
versioning + documentation hygiene from day one.

## 2. Goals

- Hexagonal monorepo with strict architectural boundaries enforced by ESLint
  + `validate.sh`.
- Multi-provider AI layer (Anthropic / OpenAI / Mistral) behind a single port,
  defaulting to Anthropic.
- Working pages prove the wiring end-to-end: a streaming AI demo, an admin
  dashboard with users + grouped error log.
- A skill routing layer in `CLAUDE.md` so future development follows the
  same plan → review → build → validate cadence.

## 3. Non-goals

- No real authentication flow beyond magic-link plumbing — admin seeding is
  via `ADMIN_SEED_EMAIL`.
- No knowledge base / RAG yet (kb_ tables not pre-defined per spec).
- No background jobs.
- No production deployment scripts.

## 4. Key entities

| Entity        | Lives in                                 | Status |
| ------------- | ---------------------------------------- | ------ |
| User          | `packages/domain/src/entities/user.ts`   | new    |
| ErrorLog      | `packages/domain/src/entities/error-log.ts` | new |
| Conversation  | `packages/domain/src/entities/conversation.ts` | new |
| Message       | same                                     | new    |

## 5. Pages / surfaces

- `/` — landing hero
- `/sample` — streaming structured AI response
- `/admin/login` — magic-link sign-in
- `/admin` — dashboard index
- `/admin/users` — CRUD with optimistic UI
- `/admin/errors` — grouped error log with status updates

## 6. Database changes

| Table                       | Notes                                      |
| --------------------------- | ------------------------------------------ |
| `core_users`                | id, email, name, is_admin, timestamps      |
| `core_sessions`             | Better Auth sessions                       |
| `core_verification_tokens`  | Better Auth tokens                         |
| `ai_conversations`          | conversation header                        |
| `ai_messages`               | role, content, metadata jsonb              |
| `app_error_log`             | level, message, stack, page, status, etc.  |

All names match `^(core|ai|app)_[a-z_]+$`.

## 7. Acceptance criteria

- [x] `validate.sh` passes on a clean checkout (assumes `pnpm install` and
      Postgres available).
- [x] `/sample` streams a structured response with `response`, `confidence`,
      `rationale` fields.
- [x] `/admin/users` supports add / edit / delete via tRPC.
- [x] `/admin/errors` groups errors by message + page and supports status
      changes.
- [x] Error captured at three layers: tRPC middleware, `/sample` try/catch,
      and Next.js `global-error.tsx` boundary.
- [x] `packages/domain` has zero non-relative imports.
- [x] `VERSION` and root `package.json#version` both = `0.1.0`.

## 8. Risks / open questions

- The streaming transport is tRPC v11's `httpBatchStreamLink`. Confirm it
  works through any reverse proxy you deploy behind (set `proxy_buffering off`
  on nginx).
- LangGraph 0.2.x API is still pre-1.0 — pin the version and update via the
  Enhancement skill when bumping.

## 9. Validation

`./validate.sh` — see the implementation summary.
