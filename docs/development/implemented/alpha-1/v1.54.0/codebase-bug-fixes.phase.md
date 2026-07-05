# Phase — Codebase Bug Fixes (hardening sweep)

- **Status**: To-be-implemented
- **Date**: 2026-07-02
- **Target version**: `1.54.0` (MINOR — one item alters a use-case constructor
  signature and one changes schedule-claim lifecycle; no DB schema/migration
  change is required by the chosen designs below)
- **Depends on / Relates to**: ADR-019 (in-app job scheduler), ADR-026 (usage
  governance enforcement), ADR-029 (hybrid retrieval), ADR (step approvals /
  confirmation)

## Scope

A verification-driven bug hunt surfaced eight defects across the session engine,
document generation, cost accounting, approvals, scheduler, retrieval, and HR
import. Each was confirmed against the code path that consumes it. This phase
fixes all eight, tests-first, with no behavioural change beyond the corrected
outcomes described per item.

**In scope**: the eight fixes below and their unit tests, plus one Playwright
e2e covering the highest-user-visible fix (fork advance at a sub-90 threshold).

**Out of scope**: any redesign of the scheduler beyond making a claim durable;
provider-side rate limiting; retention/archival (tracked in the scaling phase).

## Findings and fixes

Severity order. Each fix names the file, the failure it removes, the intended
behaviour, and its acceptance criteria (the tests to write first).

### 1. HIGH — Document transcript keeps the oldest 8k chars, dropping later turns

- **File**: `packages/application/src/use-cases/document/field-resolution.ts`
  (`buildDocumentTranscript`, the `.slice(0, TRANSCRIPT_CHAR_CAP)`).
- **Failure**: the transcript is truncated from the **front**, so once a chat
  exceeds ~8k characters every later user/assistant turn is discarded before it
  reaches field extraction (`generate-document.ts:166`) and the pre-generation
  readiness gate (`evaluate-step-readiness.ts:73`). Documents render blank/stale
  fields; the readiness gate can loop asking for data the user already gave.
- **Fix**: truncate from the **tail** on message boundaries — keep the most
  recent turns, dropping whole oldest messages until under the cap. The most
  recent turn always survives even if a single message exceeds the cap (in that
  case keep that one message, tail-sliced).
- **Acceptance criteria**:
  - A transcript of many messages whose **last** message carries a distinctive
    field value produces an output that **contains** that value.
  - The output never exceeds `TRANSCRIPT_CHAR_CAP`.
  - A single message longer than the cap is tail-truncated, not dropped to empty.
  - Existing short-transcript output is unchanged (regression guard).

### 2. HIGH — Sessions stall at forks when the advance threshold is below 90

- **File**: `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`
  (`computeBranchChoice`, the hardcoded `aiPayload.stepCompleteConfidence < 90`).
- **Failure**: the branch-choice call bails at a literal `90`, but the advance
  decision in `RunTurn.persistAssistantTurn` uses the node's configured
  (normalised) threshold. On a node with threshold < 90 and **more than one**
  outgoing edge, a turn with confidence between the threshold and 90 is
  "complete" yet `branchChoice` is `null`, so `run-turn.ts` returns
  `advanced:false` every turn with no error/message — the session parks
  indefinitely.
- **Fix**: replace the literal `90` in `computeBranchChoice` with the already
  computed `realThreshold`. Audit the same route for any other hardcoded `90`
  gating an advance-coupled decision and align it to `realThreshold` (leaving
  unrelated display thresholds untouched).
- **Acceptance criteria** (route-level test / e2e):
  - Node threshold 70, two outgoing edges, model confidence 80 → the branch
    choice is computed and the session advances.
  - Node threshold 90 behaviour is unchanged.

### 3. HIGH — AI cost goes negative on cached Anthropic calls; unknown models bill $0

- **File**: `packages/adapters/src/observability/usage-tracking-adapter.ts`
  (`estimateCost`, `MODEL_RATES`).
- **Failure**: `regularInput = promptTokens − cacheRead − cacheWrite` is correct
  for OpenAI (whose `prompt_tokens` includes cached tokens) but wrong for
  Anthropic, whose `promptTokens` maps to `input_tokens` and **excludes** cache
  tokens (verified in `@ai-sdk/anthropic` source; the chat path pins ephemeral
  cache_control on the system prefix). After the first cached turn, cache tokens
  exceed `promptTokens`, `regularInput` goes negative, and a **negative** cost is
  recorded — which reduces the summed spend the quota enforcer compares to caps,
  so blocked/warn never fire. Separately, any model missing from `MODEL_RATES`
  (including the shipped Bedrock default) records `costUsd = 0`.
- **Fix**: make the estimate provider-aware.
  - Anthropic/Bedrock-Anthropic: `promptTokens*prompt + cacheRead*cacheRead +
    cacheWrite*cacheWrite + completion*completion` (no subtraction).
  - OpenAI/others where prompt includes cache: keep the subtraction but clamp
    `regularInput` to `>= 0`.
  - Unknown model: fall back to the provider's default-model rate rather than
    silently returning 0, and record a marker (`metadata.costEstimated = false`,
    or log a one-line warning) so it is auditable. Add the shipped Bedrock
    default model id(s) to the rate table.
- **Acceptance criteria**:
  - A cached Anthropic usage record (large cacheRead, small promptTokens)
    produces a **positive** cost and never a negative one.
  - An OpenAI record with cache tokens inside promptTokens is unchanged.
  - An unknown model does not silently produce `costUsd = 0` (uses the fallback
    rate and/or is flagged).

### 4. MEDIUM — Any authenticated user can decide an email-assigned approval

- **Files**: `packages/application/src/use-cases/approvals/decide-approval.ts`
  (the authorization guard), wiring in `apps/web/src/lib/container.ts`.
- **Failure**: the guard only rejects non-approvers when `approverUserId` is
  set. Approvals assigned by **email** (`approverUserId` null, `approverEmail`
  set — a first-class case) have no authorization check, so any authenticated
  user with the approval id can decide.
- **Fix**: when `approverUserId` is null but `approverEmail` is set, load the
  deciding user (inject `IUserRepository`) and require a case-insensitive email
  match, unless `isAdmin`. Preserve the existing `FORBIDDEN` error shape.
- **Acceptance criteria**:
  - Email-assigned approval, decider whose email does not match, not admin →
    `FORBIDDEN`.
  - Email-assigned approval, decider whose email matches (case-insensitively) →
    allowed.
  - Admin acting on any approval → allowed (unchanged).
  - User-id-assigned approvals behave exactly as before.

### 5. MEDIUM — Approval decisions have a check-then-act double-decide race

- **Files**: `packages/application/src/use-cases/approvals/decide-approval.ts`,
  `packages/adapters/src/repositories/drizzle-approval-repository.ts`.
- **Failure**: `execute` checks `status !== "pending"` then the repository
  `update` writes unconditionally. Two simultaneous deciders both pass the check
  and both run side effects (double advance/cancel, double notifications/audit).
- **Fix**: add a conditional repository method that updates **only if still
  pending** — `UPDATE … WHERE id = $1 AND status = 'pending' RETURNING *` — and
  have `DecideApproval` use it, treating "no row returned" as the existing
  "already decided" `VALIDATION_FAILED`. No schema change.
- **Acceptance criteria**:
  - With a fake repo whose conditional update returns null (already decided),
    `execute` returns `VALIDATION_FAILED` and performs **no** advance, notify, or
    audit side effect.
  - The happy path (still pending) is unchanged.

### 6. MEDIUM — Scheduler claim does not durably claim (double-fire / refire on crash)

- **Files**: `packages/adapters/src/repositories/drizzle-schedule-repository.ts`
  (`claimDue`), `packages/application/src/use-cases/scheduling/fire-due-schedules.ts`.
- **Failure**: `claimDue` runs `SELECT … FOR UPDATE SKIP LOCKED` inside a
  transaction that commits immediately, releasing the locks before anything
  fires and marking nothing. Two firers (two web instances hitting the tick
  endpoint) or a crash between `handler.fire` and `markFired` cause duplicate
  fires (duplicate session advances/messages).
- **Fix (no migration)**: claim durably inside the claiming statement by
  advancing `next_fire_at` provisionally as part of the same `UPDATE … WHERE id
  IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`, so a claimed row is not
  visible to a concurrent claim. `FireDueSchedules` then computes the real next
  time (recur) or completes as today. Add an occurrence-scoped idempotency guard
  in the fire path as defence in depth.
- **Acceptance criteria**:
  - Two concurrent `claimDue` calls over the same due set return **disjoint**
    row sets (fake/transactional test).
  - A schedule that errors mid-fire is not silently re-fired within the same
    tick.
  - Single-worker recurring/complete behaviour and the run-log records are
    unchanged.

### 7. LOW-MEDIUM — "Exact" knowledge search leaks LIKE wildcards

- **File**: `packages/adapters/src/repositories/drizzle-hybrid-retriever.ts`
  (`exactQuery`, the `%${term}%` pattern).
- **Failure**: the mode exists as the guardrail for SKUs/codes/legal refs, but
  `%`, `_`, and `\` in the query are passed to `ILIKE` unescaped — `_` matches
  any character and a bare `%` matches everything, so "exact" is not exact.
- **Fix**: escape LIKE metacharacters before interpolation
  (`term.replace(/[\\%_]/g, "\\$&")`); Postgres's default backslash escape needs
  no `ESCAPE` clause with the parameterised pattern.
- **Acceptance criteria**:
  - A query containing `%` or `_` matches only chunks containing that literal
    character, not the wildcard expansion.
  - A plain-text query returns the same results as before.

### 8. LOW — XLSX import can read the wrong worksheet

- **File**: `packages/adapters/src/hr/spreadsheet-parser.ts` (`parseXlsx`, the
  lexicographic `sheetN.xml` sort).
- **Failure**: worksheet **part** names don't track tab order; after reorder or
  deletion the first visible tab may not be `sheet1.xml`, so the import can read
  the wrong sheet.
- **Fix**: resolve the first `<sheet>` in `xl/workbook.xml` through
  `xl/_rels/workbook.xml.rels` to its worksheet part and parse that. Fall back to
  the current lexicographic pick if the workbook/rels can't be read.
- **Acceptance criteria**:
  - A workbook whose first tab maps to a non-`sheet1.xml` part imports that
    tab's data.
  - A single-sheet workbook (and the existing fixtures) parse unchanged.

## Sequencing

Implement in the order above (highest severity first). Items 1, 2, 3, 7, 8 are
contained single-file changes with unit tests; 4 and 5 touch the approvals
use-case + repository (and 4 a constructor signature + container wiring); 6
changes the claim statement and adds an idempotency guard. Run `./validate.sh`
after each item and fix all failures before the next. Add the Playwright e2e for
item 2 once its unit change lands.

## Version bump

MINOR → `1.54.0`. Rationale: item 4 changes a use-case constructor signature and
item 6 changes schedule-claim lifecycle semantics; neither requires a DB
migration under the chosen designs, but the behavioural surface is wider than a
pure PATCH.
