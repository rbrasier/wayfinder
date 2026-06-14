# PRD — Require Confirmation Before Completing a Step

- **Status**: Draft
- **Date**: 2026-06-14
- **Author**: richy.brasier@gmail.com
- **Target version**: 1.47.0  (bump: MINOR — additive `app_sessions` column + new feature)

## 1. Problem

A conversational step advances to the next step automatically the instant the
AI's `stepCompleteConfidence` crosses the threshold
(`packages/application/src/use-cases/session/run-turn.ts:121`,
`apps/web/src/app/api/chat/[sessionId]/stream/route.ts:181`/`:219`). The
operator has no say in *when* the handover happens. For steps where the person
wants to keep refining, re-read, or simply choose their moment, auto-advance
takes the decision away — the step is gone before they were ready. Wayfinder's
positioning is *governed, operator-controlled* workflows, so the operator
should be able to hold a completed-but-not-yet-handed-over step open.

## 2. Users / Personas

- **Flow author** (procurement lead, ops manager configuring a workflow) — wants
  to mark specific conversational steps as "let the operator decide when to move
  on", so the people running the workflow aren't rushed past an important step.
- **Session operator** (the person running a live chat) — when the step is ready
  to complete, wants to keep chatting until they are satisfied, then click to
  proceed on their own signal rather than being advanced automatically.

## 3. Goals

- A flow author can turn on **Require confirmation before completing this step**
  on any conversational node. Default off — every existing step behaves exactly
  as today (auto-advance).
- When the toggle is on and the confidence threshold is reached, the session
  does **not** auto-advance. It enters an explicit *awaiting-confirmation* state
  pinned to the current step.
- The operator sees a small **Confirm / Proceed card** pinned to the bottom of
  the chat (visually consistent with the document-download card, but smaller).
- The operator can **continue chatting** in the step while the card is pinned;
  the composer stays enabled.
- The card persists until the operator clicks **Proceed**, at which point the
  step completes and the workflow advances exactly as an auto-advance would
  have — including document generation, the next step's AI opener, and
  scheduled/auto-node dispatch.

## 4. Non-goals

- No flow-level "Advanced mode" gate — this is a single per-node toggle, not the
  broader advanced-step-config surface (see §9 for the relationship).
- No per-step confidence-threshold editing (already covered by the existing
  `advanceConfidenceThreshold` and the separate advanced-step-config phase).
- No re-evaluation/retraction of the card if confidence later dips — once the
  card is shown it stays until the operator proceeds (matches the chosen UX).
- No new confirmation surface for `auto`, `scheduled`, or `approval` nodes — the
  toggle applies to conversational steps only. (Approval nodes already gate on a
  human via `ApprovalGate`.)
- No change to the audit-log schema in this PRD (a `confirmedBy/confirmedAt`
  stamp is captured opportunistically in the advance checkpoint; a dedicated
  audit event is listed as future work in §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ConversationalNodeConfig.requireConfirmation` | `packages/domain/src/entities/flow-node.ts` | new field (optional `boolean`) | Stored in the `app_flow_nodes.config` jsonb — no column migration. Absent/`false` = auto-advance (today's behaviour). |
| `Session.awaitingConfirmationNodeId` | `packages/domain/src/entities/session.ts` | new field (optional `string \| null`) | The node the session is paused on awaiting operator confirmation. `null` when not awaiting. |
| `app_sessions.awaiting_confirmation_node_id` | `packages/adapters/src/db/schema/wayfinder.ts` | new nullable `uuid` column | Persists the awaiting state. Explicit and queryable (see ADR-026 for why a column over jsonb). |
| `ConfirmStepAdvance` use-case | `packages/application/src/use-cases/session/` | new | Performs the deferred advancement + side effects when the operator confirms. |
| `ConfirmStepCard` | `apps/web/src/components/chat/` | new component | The pinned "Proceed" card. Mirrors `DocumentCard` styling, smaller. |

## 6. User stories

1. As a flow author, I can toggle **Require confirmation before completing this
   step** on a conversational node, so operators control the handover moment.
2. As an operator, when a confirmation-required step reaches its threshold, I see
   a pinned card offering to proceed, so I know the step is ready but not yet
   handed over.
3. As an operator, I can keep sending messages while the card is pinned, so I can
   finish refining before moving on.
4. As an operator, I click **Proceed** and the workflow advances — the document
   (if any) generates and the next step opens — exactly as it would have
   automatically.
5. As a flow author who leaves the toggle off, my steps auto-advance exactly as
   they do today (no behaviour change, no visible card).

## 7. Pages / surfaces affected

- `apps/web/src/components/canvas/node-config-modal.tsx` — new toggle in the
  conversational section (same `role="switch"` pattern as `allowManualEdit`,
  `:680`). Hidden/disabled when the node is "Never done" (`neverDone`), since a
  never-completing step has nothing to confirm.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — when
  `requireConfirmation` is on, withhold auto-advance at the real threshold and
  set the awaiting-confirmation state instead.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — render the pinned
  `ConfirmStepCard` in the same slot as `ApprovalGate` / branch-override, but
  **without** disabling the composer.
- `apps/web/src/components/chat/message-feed.tsx` — suppress the auto-advance
  milestone/`MilestonePill` for a step that is awaiting confirmation (the step
  has not actually completed yet).
- tRPC: `session.confirmStep` — new mutation (modeled on `session.overrideBranch`,
  `apps/web/src/server/routers/session.ts:223`) that runs `ConfirmStepAdvance`
  and the shared advance side effects.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_sessions` | add column `awaiting_confirmation_node_id uuid` (nullable) | n/a (existing table) |
| `app_flow_nodes` | none — `requireConfirmation` rides the existing `config` jsonb | n/a |

## 9. Architectural decisions

- **Introduces ADR-026** — "Operator-confirmed step completion & deferred
  advancement": how the awaiting-confirmation state is represented (a dedicated
  `app_sessions` column rather than a new `SessionStatus` value, so the session
  stays `active` and chat continues), and how the advance + post-advance side
  effects (document generation, next-step opener, scheduled/auto dispatch) are
  shared between the auto-turn path and the confirm path.
- **Relationship to `advanced-step-config.phase.md` (ADR-014 / ADR-015,
  unbuilt).** That phase already lists a `confidenceProgression.behaviour =
  "require_confirmation"` option, but (a) it is not implemented —
  `confidenceProgression` does not exist in `flow-node.ts` today — and (b) it
  gates the behaviour behind a flow-level "Advanced mode" and explicitly leaves
  *"the exact transport for a require_confirmation confirmation turn in the chat
  stream"* as an open question. This PRD delivers exactly that missing UX layer
  as a standalone per-node toggle. ADR-026 records how the two reconcile: when
  advanced-step-config ships, its `behaviour` selector should read/write the
  same `requireConfirmation` flag and reuse this PRD's awaiting-confirmation
  state and `ConfirmStepCard`, rather than inventing a second mechanism.

## 10. Acceptance criteria

- [ ] `ConversationalNodeConfig.requireConfirmation?: boolean` added; absent =
      auto-advance. No migration for the flag (rides `config` jsonb).
- [ ] `app_sessions.awaiting_confirmation_node_id` column added (nullable,
      additive, backfills `null`); round-trips via the session repository.
- [ ] With the toggle **off**, behaviour is byte-for-byte unchanged: step
      auto-advances at threshold, no card, no awaiting state.
- [ ] With the toggle **on** and confidence ≥ threshold, the session does not
      advance, `awaitingConfirmationNodeId` is set to the current node, and the
      session stays `active`.
- [ ] The pinned `ConfirmStepCard` renders for the awaiting step; the composer
      remains enabled and the operator can send further messages.
- [ ] Sending more messages while awaiting does not advance the step and does not
      remove the card.
- [ ] Clicking **Proceed** advances the step: edges resolved, branch choice
      recomputed when the step forks, session updated, awaiting flag cleared, and
      the completed-step document / next-step opener / scheduled/auto dispatch all
      fire — identical to the auto-advance outcome.
- [ ] On a forked step with no resolvable branch, **Proceed** surfaces the
      existing manual branch-override path rather than silently failing.
- [ ] Read-only collaborators (`?shared=true`) see the card state but cannot
      proceed; the server rejects confirm from a read-only participant.
- [ ] Architecture boundaries intact (`domain` dependency-free; advancement is an
      application use-case over existing ports; Result pattern at boundaries).
- [ ] `VERSION` = `package.json#version` = `1.47.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- A dedicated `session.step_confirmed` audit event (beyond the
  `confirmedBy/confirmedAt` stamp on the advance checkpoint).
- Re-affirming the threshold after further chat (retract the card if confidence
  drops) — deliberately excluded; the card persists once shown.
- Folding this toggle into the broader advanced-step-config "behaviour" selector
  when that phase is built (ADR-026 describes the reconciliation).
- Per-operator (end-user) override of the author's setting.

## 12. Risks / open questions

- **Deferred side effects.** The post-advance side effects currently live inline
  in the stream route's `execute()` (`route.ts:227-304`). They must be extracted
  into a shared path so the confirm endpoint produces an identical outcome —
  the main implementation risk (covered in the phase doc).
- **Branch choice at confirm time.** Branch selection is computed during the AI
  turn today (`route.ts:181-211`). Because the operator may chat further before
  confirming, the branch must be (re)computed at confirm time; this re-runs the
  branch-choice prompt and incurs one extra model call on Proceed for forked
  steps.
- **Collaborative sessions.** Two participants may both see the card; the first
  Proceed wins and the confirm use-case must no-op safely if the session has
  already advanced.
