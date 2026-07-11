# ADR-026 — Usage Governance Enforcement (per-user cap decorator on `ILanguageModel`)

> **Numbering note**: two ADRs share the number 026. This one —
> *Usage Governance Enforcement* — is the ADR-026 the code cites around budgets,
> quota enforcement, and usage tracking (e.g. `entities/budget.ts` "ADR-026 §3",
> `observability/quota-enforcing-adapter.ts` "ADR-026 §3/§6"). The other is
> *Operator-Confirmed Step Completion & Deferred Advancement*. Deliberately not
> renumbered — code comments cite these numbers.

- **Status**: Accepted (scoped by `cost-usage-governance.prd.md`, target v1.48.0)
- **Date**: 2026-06-14 (revised 2026-06-17: scope reduced to **per-user caps**
  over daily / weekly / monthly periods; the org-tier "team" model, the
  `IOrgStructure` port, the Entra/HR resolvers, and `org_node_id` / `team_label`
  attribution are dropped. Flow + session attribution is retained for dashboard
  analytics only.)

## Context

`cost-usage-governance.prd.md` introduces optional per-user spend **caps** that
must **stop** a runaway user, not just report spend after the fact. The codebase
already records spend: `UsageTrackingAdapter`
(`packages/adapters/src/observability/usage-tracking-adapter.ts`) decorates the
`ILanguageModel` port and writes an `ai_usage_events` row (tokens + `cost_usd`)
after every call. What is missing:

1. **Attribution.** `ai_usage_events` records `user_id` and `conversation_id` but
   not the originating **flow** or **session/run** (wanted for the dashboard's
   spend-by-flow view). The `ILanguageModel` call inputs (`GenerateObjectInput`,
   `StreamTextInput`, `StreamObjectInput`) carry `purpose` and `userId` but no
   flow/session.
2. **Enforcement.** There is no budget concept and no place that can refuse a
   call.

Constraints:

- **Hexagonal boundary (ADR-001).** Budget evaluation must be pure domain; the
  application and domain layers must not import an AI SDK. Only
  `packages/adapters` knows how a call is made.
- **Uniform coverage.** Every call path (the LangGraph agent, auto-nodes, ad-hoc
  calls) must be governed without sprinkling checks at each call site.
- **Off by default.** Existing behaviour must be byte-for-byte unchanged when no
  cap is enabled — no added latency, no blocking.

## Decision

### 1. Thread flow/session context through the port for recording

Extend the three `ILanguageModel` input types with optional `flowId` and
`sessionId`, alongside the existing `userId` and `purpose`. These are recorded
for the dashboard's spend-by-flow analytics; **the enforcement key is the
existing `userId`** — no new field is needed for enforcement:

```ts
export interface GenerateObjectInput<TSchema = unknown> {
  readonly purpose: string;
  readonly userId?: string | null;
  readonly flowId?: string | null;     // new — analytics only
  readonly sessionId?: string | null;  // new — analytics only
  // …unchanged…
}
```

`UsageTrackingAdapter` records `flow_id` + `session_id` onto `ai_usage_events`;
the new enforcement decorator only needs `userId`. Calls made without a `userId`
(no acting user) are treated as **un-scoped → not enforced**.

### 2. "Cap" is a per-user spend limit over a period

A cap is scoped to a single **user**, not a flow or team. There is no org
structure, no team node, and no roll-up. A cap has:

- `userId` — the subject,
- `period` — `daily` | `weekly` | `monthly`,
- `limitUsd` — the ceiling,
- `warnThresholdPct` — default 80,
- `enabled` — default false.

A user may have at most one cap per period (DB unique on `(user_id, period)`), so
up to three caps (daily, weekly, monthly) can apply to one user at once.

### 3. Enforcement is a decorator on `ILanguageModel`, ordered outermost

A new `QuotaEnforcingLanguageModel`
(`packages/adapters/src/observability/quota-enforcing-adapter.ts`) wraps the
port exactly as `UsageTrackingAdapter` does. The wrapping order in
`apps/web/src/lib/container.ts` is:

```ts
withQuotaEnforcement(withUsageTracking(provider), budgetRepo, usageRepo, auditLog)
```

so the quota check runs **before** the inner usage-tracking + provider call and
can short-circuit. Per call:

1. `budgetRepo.findEnabledForUser(userId)`. **If it returns nothing, pass
   straight through** — this is the off-by-default zero-overhead path.
2. For each enabled cap, compute current-period spend via `usageRepo.summarize`
   with a `userId` + period-window filter (`daily` → since 00:00 UTC today;
   `weekly` → since 00:00 UTC Monday; `monthly` → since the start of the current
   UTC calendar month).
3. `evaluateBudget(budget, spendUsd)` (pure domain) returns `ok` / `warn` /
   `blocked`.
4. On `warn`, write a `budget.warn` `core_audit_log` event and proceed. On
   `blocked`, write `budget.blocked` and return
   `err(domainError("QUOTA_EXCEEDED", …))` **without** calling the inner model.
5. When more than one of a user's caps applies, the **stricter** (first to block)
   wins.

Returning the Result error (never throwing) keeps the Result-pattern boundary
intact.

### 4. Budget evaluation is pure domain

`packages/domain/src/entities/budget.ts` owns the `Budget` shape and a pure
function:

```ts
export const evaluateBudget = (
  budget: Budget,
  spendUsd: number,
): { status: "ok" | "warn" | "blocked"; ratio: number } => { … };
```

No dates, no IO — the caller supplies the already-summed spend. This keeps the
threshold/limit logic unit-testable with zero dependencies and reusable by the
dashboard (`utilisation`) and the enforcer alike.

### 5. Spend computed on the fly (no counter table in v1)

Current-period spend is a `SUM(cost_usd)` over `ai_usage_events` filtered by
`user_id` and a period window, served by `IUsageRepository.summarize` (extended
`UsageFilter` with `userId`, `flowId`, `sessionId`, `since`, `until`). The index
on `(user_id, created_at)` keeps it cheap at current volume. A materialised
counter is deferred (PRD §11) — the off-by-default short-circuit means most calls
never run the query.

### 6. Blocked → session pause, not crash

A `QUOTA_EXCEEDED` Result propagates to the calling use-case (`run-turn`,
`run-auto-node`), which pauses the session and surfaces a clear system message
("You have reached your usage cap — contact an administrator to continue")
instead of failing hard. Raising or disabling the cap lets the session resume on
the next turn.

## Consequences

**Positive**

- One enforcement point covers every call path; call sites only have to pass
  context, not check caps.
- Mirrors the proven `UsageTrackingAdapter` pattern — same shape, same tests
  style, same wiring spot.
- Off-by-default with a one-lookup short-circuit means existing deployments are
  unaffected and pay no cost until a cap is enabled.
- Budget logic is pure domain → trivially unit-testable and shared with the
  dashboard.
- Caps key on `user_id` (a stable, already-recorded dimension), so there is no
  org structure to resolve, sync, or keep consistent, and the enforcement key is
  the `userId` already present on every call input.

**Negative**

- Enforced calls add a spend query per call until a counter table is introduced.
- Blocking is based on already-recorded spend, so the call that crosses the limit
  still completes (last-call overshoot) and streamed calls are checked only at
  start. Acceptable for a governance ceiling; revisit with the counter table.
- Flow/session context must be threaded through every call site for the
  spend-by-flow analytics; a missed site under-records that dimension (but is
  still enforced by user).

## Open questions — to resolve at build

- **Audit-event volume.** A long over-threshold run could emit a `budget.warn`
  per call. Consider de-duplicating (one warn per user per period) at build.
- **Period boundary.** `daily` / `weekly` / `monthly` windows default to UTC
  (00:00 day / Monday week start / 1st of month); confirm at build whether a
  deployment-local calendar is ever needed (out of scope for v1).
- **Disabled-vs-deleted cap** semantics during an active blocked session —
  confirm both immediately unblock.
- **Multiple caps for one user.** Daily + weekly + monthly can all be enabled;
  confirm the stricter-wins evaluation and that the dashboard shows each cap's
  status independently.
