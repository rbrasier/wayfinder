# Phase — Require Confirmation Before Completing a Step

- **Status**: Awaiting review
- **Target version**: 1.47.0  (bump: MINOR — additive `app_sessions.awaiting_confirmation_node_id` column + new feature)
- **PRD**: `docs/development/prd/step-confirmation-toggle.prd.md`
- **ADRs**: ADR-026 (operator-confirmed completion & deferred advancement)
- **Depends on**: flow/session schema (ADR-006), the auto-advance turn
  (`run-turn.ts`), the chat stream route and its `turn-helpers`, flow versioning
  (ADR-015, `run-turn.ts:61`), the `overrideBranch` advance precedent
  (`session.ts:223`)
- **Relationship**: delivers the chat-stream UX that `advanced-step-config.phase.md`
  left as an open question; see ADR-026 for reconciliation.

## 1. Problem

A conversational step auto-advances the instant `stepCompleteConfidence` crosses
the threshold (`run-turn.ts:121`, `stream/route.ts:181`/`:219`), removing the
operator's control over the handover moment. Authors need a per-node toggle that
holds a completed-but-not-handed-over step open until the operator clicks
**Proceed**, while the operator keeps chatting. See the PRD for full detail.

## 2. Goals

- Per-node **Require confirmation before completing this step** toggle on
  `ConversationalNodeConfig`. Default off → today's auto-advance, byte-for-byte.
- When on and confidence ≥ threshold: withhold advancement, set an explicit
  *awaiting-confirmation* state on the session, keep the session `active`.
- A small **`ConfirmStepCard`** pinned to the chat footer (DocumentCard styling,
  smaller); composer stays enabled; card persists until **Proceed**.
- **Proceed** advances the step with an outcome identical to auto-advance
  (document generation, next-step opener, scheduled/auto dispatch) via a shared
  advance path.

## 3. Non-goals

Flow-level Advanced-mode gating; per-step threshold editing; card retraction on
confidence dip; confirmation on non-conversational nodes; a dedicated audit
event; end-user override of the author setting. (PRD §4 / §11.)

## 4. Approach

The flag rides the node `config` jsonb (no migration); the awaiting state is one
additive nullable column on `app_sessions` (ADR-026 §1). The turn reuses the
existing `neverDone → Infinity` suppression to withhold auto-advance and instead
records the awaiting state. The post-advance side effects, currently inline in
the stream route (`route.ts:227-304`), are extracted into a shared helper so a
new `ConfirmStepAdvance` use-case (triggered by a `session.confirmStep` mutation,
modeled on `overrideBranch`) yields an identical outcome. Build strictly
bottom-up (domain → application → adapters → web), writing the test file before
each implementation file (CLAUDE.md rule).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-node.ts` | add `requireConfirmation?: boolean` to `ConversationalNodeConfig` |
| domain | `packages/domain/src/entities/session.ts` | add `awaitingConfirmationNodeId: string \| null` to `Session` |
| application | `packages/application/src/use-cases/session/run-turn.ts` | when `requireConfirmation` and `stepCompleteConfidence >= realThreshold`: set `awaitingConfirmationNodeId = currentNodeId` instead of advancing; idempotent across repeat turns on the same node |
| application | `packages/application/src/use-cases/session/confirm-step-advance.ts` | NEW `ConfirmStepAdvance`: validates the session is awaiting *this* node, performs the advancement block (resolve edges, recompute branch for forks, update session, clear awaiting flag, stamp `confirmedByUserId`/`confirmedAt` in `graphCheckpoint`, fire step-complete notifier), returns the new node id (or a Result the UI maps to manual branch-override) |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | `app_sessions`: add `awaiting_confirmation_node_id uuid` (nullable) |
| adapters | `packages/adapters/drizzle/<next>.sql` | migration: `ALTER TABLE app_sessions ADD COLUMN awaiting_confirmation_node_id uuid` |
| adapters | session repository (`packages/adapters/src/repositories/…session…`) | map `awaitingConfirmationNodeId` ↔ `awaiting_confirmation_node_id`; accept it in `update` |
| web | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | compute `requireConfirmation`; pass real threshold + intent to `persistAssistantTurn`; suppress auto-advance when on |
| web | `apps/web/src/app/api/chat/[sessionId]/turn-helpers.ts` | extract `applyAdvanceSideEffects(...)` (doc generation for completed step + new-node opener / scheduled / auto dispatch) from the route's inline `execute()` block; call it from both the auto path and the confirm endpoint |
| web | `apps/web/src/server/routers/session.ts` | add `confirmStep` mutation (modeled on `overrideBranch:223`) → `ConfirmStepAdvance` + `applyAdvanceSideEffects` |
| web | `apps/web/src/components/chat/confirm-step-card.tsx` | NEW `ConfirmStepCard` (DocumentCard visual language, smaller; single **Proceed** action) |
| web | `apps/web/src/components/chat/message-feed.tsx` | suppress the auto-advance `MilestonePill` for a step that is awaiting confirmation (`isAdvancingMsg`, `:100-104`) |
| web | `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` | render `ConfirmStepCard` when `awaitingConfirmationNodeId === currentNodeId` (footer slot near `ApprovalGate`, `:386`) **without** disabling the composer; wire `session.confirmStep` + invalidate on success; route a no-branch result to `BranchOverrideModal` |
| web | `apps/web/src/components/canvas/node-config-modal.tsx` | add the toggle to the conversational section (switch pattern, `:680`); extend `NodeConfigValues` + `DEFAULT_VALUES` + save mapping; hide/disable when `doneWhenMode === "never"` |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — types.** Add `requireConfirmation?: boolean` to
   `ConversationalNodeConfig` and `awaitingConfirmationNodeId: string | null` to
   `Session`. Pure type additions (domain stays dependency-free); update any
   exhaustive guards / `Session` constructors and test factories.

2. **Application — withhold + mark awaiting.** Write `run-turn.test.ts` cases
   first: (a) `requireConfirmation` off → advances at threshold exactly as today;
   (b) on + confidence ≥ threshold → `advanced: false`, returns/sets
   `awaitingConfirmationNodeId = currentNodeId`; (c) on + confidence < threshold →
   no awaiting, no advance; (d) repeat turn while already awaiting → idempotent
   (awaiting stays set, no duplicate side effects); (e) `neverDone` still wins
   (never awaiting, never advancing). Then implement, reusing the
   `advanceThreshold = Infinity` suppression.

3. **Application — `ConfirmStepAdvance`.** Write `confirm-step-advance.test.ts`:
   (a) advances a single-edge step and clears the awaiting flag; (b) recomputes
   branch for a fork and advances to the chosen edge; (c) no resolvable branch →
   Result error the caller maps to manual override (awaiting flag preserved);
   (d) session not awaiting this node → safe no-op (handles the collaborative
   double-Proceed race); (e) terminal step (no outgoing edges) → session
   `complete`. Then implement, mirroring `run-turn.ts:126-163` and honouring the
   pinned flow version (`resolveEdges`).

4. **Adapters — schema + migration + repo mapping.** Add the
   `awaiting_confirmation_node_id` column, generate the migration, map it in the
   session repository (read + `update`). Repository test asserts round-trip and
   `null` default for existing rows.

5. **Web — extract shared side effects.** Refactor the inline block at
   `route.ts:227-304` into `applyAdvanceSideEffects(...)` in `turn-helpers.ts`.
   Cover with route/helper tests asserting the **auto path is unchanged**
   (document generation for the completed doc-node, next-step opener for
   conversational, scheduled/auto dispatch, approval-node skip).

6. **Web — confirm endpoint + stream withhold.** Add the `session.confirmStep`
   mutation calling `ConfirmStepAdvance` then `applyAdvanceSideEffects`; reject
   read-only/shared participants and non-awaiting sessions. In the stream route,
   compute `requireConfirmation = nodeConfig.requireConfirmation && !isNeverDone`
   and pass the real threshold + intent so the turn marks awaiting instead of
   advancing.

7. **Web — UI.** Build `ConfirmStepCard` (DocumentCard styling, smaller, single
   **Proceed** button). Render it in `_content.tsx` when the session is awaiting
   the current node, keeping the composer enabled; on success invalidate
   `session.get`; on a no-branch result open `BranchOverrideModal`. Suppress the
   auto-advance `MilestonePill` in `message-feed.tsx` for the awaiting step. Add
   the toggle to `NodeConfigModal` (switch; hidden when "Never done").

8. **Version + validate.** Bump `VERSION` and root `package.json#version` to
   `1.47.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/v1.47/` with an implementation summary (per the
   `to-be-implemented/` lifecycle).

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Toggle **off** → byte-for-byte unchanged auto-advance (no card, no awaiting
      state) — guarded by run-turn and route tests.
- [ ] `awaiting_confirmation_node_id` column added, additive, backfills `null`;
      round-trips via the session repository.
- [ ] Toggle **on** + confidence ≥ threshold → no advance, `awaitingConfirmationNodeId`
      set, session stays `active`.
- [ ] `ConfirmStepCard` renders for the awaiting step; composer stays enabled;
      further messages neither advance the step nor remove the card.
- [ ] **Proceed** advances with an outcome identical to auto-advance (document,
      next-step opener, scheduled/auto dispatch); forked steps recompute the
      branch; unresolvable fork routes to manual override.
- [ ] Read-only collaborators cannot proceed (server-rejected); concurrent
      Proceed is a safe no-op once advanced.
- [ ] Architecture boundaries intact (`domain` dependency-free; advancement is an
      application use-case; Result pattern at boundaries).
- [ ] `VERSION` = `package.json#version` = `1.47.0`; `./validate.sh` passes.

## 8. Risks / open questions

- **Hot-path refactor.** Extracting `applyAdvanceSideEffects` from the stream
  route is the main risk; lock the auto path with tests before changing it.
- **Branch recompute on Proceed.** Forked confirmation steps cost one extra model
  call at confirm time; acceptable, but note it in the confirm use-case.
- **Footer stacking.** `ConfirmStepCard`, `ApprovalGate`, branch-override and the
  typing indicator share the chat footer; conversational-vs-approval exclusivity
  prevents card collisions, but verify layout when a typing indicator is present.
- **Collaborative races.** First Proceed wins; the confirm use-case must no-op
  when the session has already advanced past the awaiting node (covered in step 3d).
