# Implementation Summary — Require Confirmation Before Completing a Step (v1.47.0)

- **Phase**: `step-confirmation-toggle.phase.md`
- **PRD**: `docs/development/prd/step-confirmation-toggle.prd.md`
- **ADR**: ADR-026 — Operator-Confirmed Step Completion & Deferred Advancement
- **Version bump**: **MINOR** (1.46.0 → 1.47.0) — additive `app_sessions.awaiting_confirmation_node_id` column + new per-node toggle.

## What was built

A per-node **Require confirmation before completing this step** toggle for
conversational nodes. When on and the AI's `stepCompleteConfidence` reaches the
step's threshold, the session does **not** auto-advance. Instead it enters an
explicit awaiting-confirmation state (the session stays `active` and chattable),
a pinned `ConfirmStepCard` renders in the chat footer, and the step only advances
when the operator clicks **Proceed** — producing an outcome identical to
auto-advance (document generation, next-step opener, scheduled/auto dispatch).

Default off → existing flows are unchanged (byte-for-byte auto-advance).

## Files created

| Layer | File | Purpose |
|-------|------|---------|
| application | `packages/application/src/use-cases/session/confirm-step-advance.ts` | `ConfirmStepAdvance` use-case — deferred advancement on Proceed, mirrors RunTurn's advancement block |
| application | `packages/application/src/use-cases/session/confirm-step-advance.test.ts` | Tests: single edge, fork branch, unresolved fork, double-Proceed no-op, terminal step, notifier |
| web | `apps/web/src/components/chat/confirm-step-card.tsx` | `ConfirmStepCard` — DocumentCard visual language, smaller, single Proceed action |
| web (e2e) | `apps/web/e2e/phase-step-confirmation-toggle.spec.ts` | E2E: card renders + composer stays enabled; Proceed advances and removes the card |

## Files modified

| Layer | File | Change |
|-------|------|--------|
| domain | `entities/flow-node.ts` | `ConversationalNodeConfig.requireConfirmation?: boolean` |
| domain | `entities/session.ts` | `Session.awaitingConfirmationNodeId?: string \| null` |
| domain | `ports/session-repository.ts` | `SessionUpdate.awaitingConfirmationNodeId?` |
| application | `use-cases/session/run-turn.ts` | `persistAssistantTurn` marks the session awaiting (instead of advancing) when `requireConfirmation` and confidence ≥ `confirmationThreshold`; idempotent |
| application | `use-cases/session/index.ts` | export `ConfirmStepAdvance` |
| application | `use-cases/session/session.test.ts` | RunTurn confirmation cases + fake/fixture awaiting field |
| adapters | `db/schema/wayfinder.ts` | `app_sessions.awaiting_confirmation_node_id uuid` (nullable) |
| adapters | `drizzle/0024_next_hitman.sql` | migration: `ALTER TABLE app_sessions ADD COLUMN awaiting_confirmation_node_id uuid` |
| adapters | `repositories/drizzle-session-repository.ts` | map `awaitingConfirmationNodeId` ↔ column (read + update) |
| web | `app/api/chat/[sessionId]/stream/turn-helpers.ts` | extract `applyAdvanceSideEffects` (shared by auto + confirm paths); add `confirmStep` orchestrator (branch recompute → use-case → side effects) |
| web | `app/api/chat/[sessionId]/stream/route.ts` | compute `requireConfirmation`; pass Infinity threshold + real threshold/intent; call shared `applyAdvanceSideEffects` |
| web | `app/api/chat/[sessionId]/stream/turn-helpers.test.ts` | tests locking the extracted auto-path (doc gen, conversational opener, approval skip) |
| web | `server/routers/session.ts` | `confirmStep` mutation (owner/admin only, modeled on `overrideBranch`) |
| web | `app/(user)/chats/[sessionId]/_content.tsx` | render `ConfirmStepCard` when awaiting current node (composer stays enabled); wire `confirmStep`; route no-branch result to `BranchOverrideModal` |
| web | `components/chat/message-feed.tsx` | suppress the auto-advance `MilestonePill` for the awaiting step |
| web | `components/canvas/node-config-modal.tsx` | toggle in the conversational section (hidden when "Never done"); `NodeConfigValues` + `DEFAULT_VALUES` |
| web | `app/(user)/flows/[id]/config/_content.tsx`, `app/(admin)/admin/flows/[id]/_content.tsx`, `components/canvas/node-defaults.ts`, `components/canvas/scheduled-node-config.test.ts` | save/load mapping + defaults for `requireConfirmation` |
| web | `lib/container.ts` | wire `ConfirmStepAdvance` |
| web | `lib/e2e-fixtures.ts` | seed a confirmation flow + awaiting session for the e2e spec |

## Migrations

- `0024_next_hitman.sql`: `ALTER TABLE "app_sessions" ADD COLUMN "awaiting_confirmation_node_id" uuid;` — additive, nullable, backfills `null` for existing rows.

## Design notes

- **Reuses the `neverDone → Infinity` suppression.** The route passes
  `advanceThreshold = Infinity` when `requireConfirmation` so the turn never
  auto-advances, and the real threshold so it can instead mark awaiting.
- **Branch recompute at Proceed time.** Forked confirmation steps recompute the
  branch (one model call) at confirm time, since the operator may chat further.
  An unresolved fork returns `needsManualBranch`, which the UI maps to the
  existing `BranchOverrideModal`.
- **Shared advance path.** `applyAdvanceSideEffects` was extracted verbatim from
  the stream route's inline block so the auto and Proceed paths produce an
  identical outcome; locked with route/helper tests.
- **Authorisation.** `confirmStep` is owner/admin only (mirrors `overrideBranch`),
  which rejects read-only shared participants server-side.

## E2E tests added

- `apps/web/e2e/phase-step-confirmation-toggle.spec.ts`:
  - Happy path — the awaiting step shows the Proceed card while the composer
    stays enabled.
  - Proceed advances the step and removes the card.

  Backed by a deterministic seeded awaiting-confirmation session
  (`seedConfirmationSession` in `lib/e2e-fixtures.ts`), avoiding a live AI turn.

## Known limitations

- No DB-backed round-trip unit test for the new column — the repository layer has
  no existing Drizzle integration tests (they require a live Postgres, skipped in
  CI per `validate.sh`). The mapping is covered by typecheck and the in-memory
  application-layer fakes.
- A dedicated `session.step_confirmed` audit event is future work; only a
  `confirmedByUserId` / `confirmedAt` stamp is written to the advance checkpoint.
- The card persists once shown (no retraction if confidence later dips) — a
  deliberate non-goal per the PRD.
