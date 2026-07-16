# Minor flow & chat fixes

Five small, independent bug/UX fixes across the chat and scheduling surfaces.
Targets the current alpha branch (`release/alpha-1`). PATCH bump (no schema
change): `1.59.1` → `1.59.2`.

---

## 1. No loading indicator when advancing a fork step

**Symptom.** Selecting/advancing a branch from a fork in the flow shows nothing
while the branch is recomputed — the chat appears frozen.

**Root cause.** On Proceed, `_content.tsx` sets `isConfirmingStep`, which unmounts
the confirm card. The only loading badge shown is
`pendingDocumentGeneration = isConfirmingStep && isDocumentTemplateStep`, so a
non-document fork step (which still runs an LLM branch recompute in
`confirmStep`) renders no indicator at all.

**Fix.** Render a generic "Advancing…" badge in `message-feed.tsx` while
confirming a non-document step (`isConfirmingStep && !isDocumentTemplateStep`).

## 2. Role hint not shown in the approval selection screen

**Symptom.** The approval step's role hint (the policy-named approver role) is
never shown to the operator confirming the approver.

**Root cause.** `ApprovalGate` receives `instructions` but not the node's
`roleHint` (`ApprovalNodeConfig.roleHint`). The hint is used server-side to
suggest an approver but is never surfaced in the UI.

**Fix.** Thread `roleHint` from the current node config into `ApprovalGate` and
display it in the confirm-approver screen.

## 3. Chat prompt lacks current date/time

**Symptom.** The assistant has no notion of "now", so short/relative dates
("next Tuesday", "the 3rd") cannot be resolved.

**Root cause.** `buildSystemPrompt` never states the current date/time. (The
user's name is already present via the role block.)

**Fix.** Add `now` to `BuildSystemPromptInput`; render a `<current_context>`
block stating the current date/time and instructing the model to interpret
relative/short dates relative to it. Passed from all three call sites.

## 4. Confirming a step does not cross-check against reference docs

**Symptom.** When a step requires confirmation, proceeding does not run the
pre-generation cross-check against the flow's reference/guidance documents.

**Root cause.** `shouldEvaluateStepReadiness` short-circuits to `false` when
`requireConfirmation` is true, so the cross-check gate never runs before the
operator confirms.

**Fix.** Drop the `requireConfirmation` short-circuit (keep the never-done
skip). The gate now runs when the confirmation threshold is reached: gaps hold
the step (and are surfaced) before the confirm card appears; a pass shows the
cross-check pass note, then the step waits for confirmation as before.

## 5. Date from a prior step's metadata fails to parse

**Symptom.**
`Scheduled step "Pause till onboard date" could not start: step_field anchor "27-07-2026" is not a date.`

**Root cause.** `27-07-2026` is DD-MM-YYYY — the app's display/collection format
for date fields — which `new Date()` cannot parse.

**Fix.** Add `parseFlexibleDate` in `packages/domain` that accepts day-first
`DD-MM-YYYY` / `DD/MM/YYYY` as well as any format `Date` already accepts (ISO).
Use it in `schedule-node-event.ts` (anchor resolution) and
`compute-next-fire.ts` (`at`-kind spec).

---

## Implementation summary (v1.59.2)

All five fixes landed on `release/alpha-1`. No DB schema change → PATCH bump
`1.59.1` → `1.59.2` (`VERSION` + root `package.json`).

### Regression tests added (run and green)

- `packages/domain/src/entities/parse-flexible-date.test.ts` — day-first parsing,
  ISO passthrough, impossible-date rejection.
- `schedule-node-event.test.ts` — new case: a `step_field` anchor resolves from a
  prior step's `27-07-2026` (DD-MM-YYYY) value and schedules active (was the
  reported failure).
- `flow-session-graph.test.ts` — new cases: `<current_context>` omitted without
  `now`; present with the formatted date and relative-date instruction when
  supplied.
- `readiness-gate.test.ts` — the confirmation-gated skip assertion removed; the
  gate now evaluates over-threshold template doc steps regardless of
  confirmation gating.

### Files changed

- Fix 5: `packages/domain/src/entities/parse-flexible-date.ts` (+ index export),
  `schedule-node-event.ts`, `compute-next-fire.ts`.
- Fix 4: `readiness-gate.ts` (drop `requireConfirmation` short-circuit + field),
  `route.ts` caller.
- Fix 3: `session-agent.ts` port (`now`), `flow-session-graph.ts`
  (`<current_context>` block), call sites in `route.ts`, `turn-helpers.ts`,
  `routers/flow.ts`.
- Fix 2: `approval-gate.tsx` (roleHint prop + display), `_content.tsx` wiring.
- Fix 1: `milestone-pill.tsx` (`AdvancingBadge`), `message-feed.tsx`
  (`pendingStepAdvance`), `_content.tsx` wiring.

### e2e

Playwright e2e is driven by the `/e2e` MCP skill against a running stack
(Docker + Postgres/Redis/MinIO), which is not available in the authoring
sandbox — so no e2e spec was executed here. The unit/integration coverage above
guards every fix. Recommended follow-up: exercise the role-hint gate, the
advancing badge, and the confirmation cross-check via `/e2e` against a live
stack.
