# PRD — Cost / Usage Governance

> Adds per-flow and per-team token-spend **recording** and optional
> **budgets/quotas** with warn-then-block enforcement, plus an admin governance
> dashboard. A **team** is an org-unit **node** resolved from org structure
> (Entra first, uploaded HR sheet as fallback), selected by walking the
> management chain up/down via a level dropdown — not a free-text string. Route
> to the Documentation Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-06-14 (revised 2026-06-15: team attribution changed from a
  free-text string to an **org-tier node** resolved from org structure —
  Entra-first, HR-sheet fallback — picked via a level dropdown that walks the
  management chain up/down)
- **Author**: Solo / Claude Code
- **Target version**: 1.47.0 (bump: **MINOR** — new table, new domain ports, new
  adapter, additive columns; no breaking change. See `docs/guides/versioning.md`.)

## 1. Problem

Wayfinder already records every LLM call's tokens and USD cost in
`ai_usage_events`, and the admin overview dashboard visualises sessions and AI
confidence. But spend is recorded only by **user** and **conversation** — there
is no **flow** or **team** attribution, and there is no concept of a **budget**
or **quota** anywhere in the codebase. So the procurement question that sells
governance — *"how do we stop a runaway flow from spending $10k?"* — has no
answer today. An admin can see cost after the fact but cannot cap it, and cannot
say which flow or team is responsible.

## 2. Users / Personas

- **Admin / Operator** — sets optional budgets per flow and per team, watches a
  governance dashboard showing spend and budget utilisation, and trusts that an
  over-budget flow is automatically stopped rather than merely reported.
- **Flow Owner** — wants to know their flow's running cost and to be warned
  before it is throttled, so a legitimately expensive flow can have its limit
  raised rather than silently failing.
- **Procurement / Finance stakeholder** — needs the assurance (and the audit
  trail) that no single flow or team can run away with spend beyond a configured
  ceiling.

## 3. Goals

- Every LLM call is recorded with its originating **flow**, **session/run**, and
  **team** — the acting user's resolved **org-unit node** (Entra manager chain;
  HR sheet fallback), stored as a stable node id plus a cached label — in
  addition to the existing user/conversation attribution, so spend is
  attributable along all four dimensions.
- An admin can optionally set a **budget** scoped to a **flow** or a **team**,
  expressed in **USD**, over a **period** (`per_run` or `monthly`), with a
  configurable **warn threshold** (default 80%). A team budget targets an
  **org-unit node** picked from the management hierarchy — a level dropdown that
  walks the chain up (broader) or down (narrower) — and its spend rolls up
  everyone beneath that node.
- **All quotas are OFF by default.** A scope with no enabled budget behaves
  exactly as today — recording only, no enforcement, no added latency path that
  blocks.
- When current-period spend for an enabled budget crosses the warn threshold, a
  warning is raised (audit event + admin-visible signal); when it reaches 100%
  of the limit, further LLM calls for that scope are **blocked** — the call
  returns a `QUOTA_EXCEEDED` `DomainError` and the session pauses with a clear
  message instead of continuing to spend.
- The admin governance dashboard visualises spend by flow and by team over a
  period, and shows each enabled budget's utilisation (ok / warn / blocked),
  building on the existing Recharts overview dashboard.
- Enforcement is provider-agnostic and lives behind the `ILanguageModel` port
  (a decorator), so it covers every call path uniformly.

## 4. Non-goals

- **No per-user budgets.** Limits are settable only at **flow** and **team**
  scope. (User attribution is still recorded for analytics.)
- **No currency other than USD.** Budgets reuse the existing `cost_usd`; AUD /
  FX conversion is explicitly out of scope (see §11).
- **No real-time hard guarantee to the cent.** Enforcement is checked
  before each call against recorded spend; a single in-flight call may push a
  scope slightly past its limit before the next call is blocked. Budgets are a
  governance ceiling, not a metered prepay wall.
- **No auto-raising or auto-purchasing of budget.** Raising a limit is a manual
  admin action.
- **No stored `core_teams` table / org-tree sync.** The org structure is
  **resolved on demand** from the authoritative source (Entra manager chain;
  uploaded HR sheet as fallback), not mirrored into its own table. A team is a
  node id from that source, not a persisted entity. (The free-text
  `core_users.team` profile string stays for prompt context but is no longer the
  budget key.)
- **No matrixed / non-manager teams from Entra.** Entra's hierarchy is the
  person→manager tree, so an Entra "team" is "everyone under manager X". Named
  units that don't align with a single manager come only from the HR sheet's
  `unit` column.
- **No billing, invoicing, or chargeback export** this round (listed in §11).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Budget` (entity) | `packages/domain/src/entities/budget.ts` | new | `scope` (`flow` \| `team`), `scopeRef` (flow id, or **org-unit node id** for a team), cached `scopeLabel`, `period` (`per_run` \| `monthly`), `limitUsd`, `warnThresholdPct`, `enabled`. Plus a pure `evaluateBudget(budget, spendUsd)` → `{ status: 'ok' \| 'warn' \| 'blocked'; ratio }`. |
| `IBudgetRepository` (port) | `packages/domain/src/ports/budget-repository.ts` | new | `create`, `update`, `delete`, `findById`, `list`, `findEnabledForFlowAndOrgNodes(flowId, orgNodeIds)` — passed every ancestor node id from the acting user's chain so a budget on any tier above them applies. |
| `OrgNode` (entity) | `packages/domain/src/entities/org-node.ts` | new | A node in the management hierarchy: stable `id` (Entra object id / HR row id), `label` (department / `unit`), `level` (depth tier), `email`, `managerId`. |
| `IOrgStructure` (port) | `packages/domain/src/ports/org-structure.ts` | new | `resolveChain(userId) → OrgNode[]` (self → manager → … → top) and `listTeamOptions(userId) → OrgNode[]` for the level dropdown. Generalises the existing reporting-line chain-walk (ADR-018). |
| `EntraOrgStructure` / `HrOrgStructure` (adapters) | `packages/adapters/src/directory/{graph,hr}-org-structure.ts` | new | Walk the manager chain to the top instead of stopping at hop N (reuse `GraphReportingLineResolver.walkGraph` / `walkHr` logic). Entra authoritative, HR sheet fallback — same precedence as today. |
| `UsageEvent` / `NewUsageEvent` | `packages/domain/src/entities/usage-event.ts` | existing → extend | Add `flowId`, `sessionId`, `orgNodeId`, `teamLabel` (all nullable). |
| `UsageFilter` | `packages/domain/src/ports/usage-repository.ts` | existing → extend | Add `flowId`, `sessionId`, `orgNodeIds` (any-of, for roll-up), `since`, `until` so spend can be summed per scope per period; add `summarizeBy(dimension)` for dashboard grouping. |
| `ILanguageModel` call inputs | `packages/domain/src/ports/language-model.ts` | existing → extend | Add optional `flowId`, `sessionId`, and `team` (the acting user's resolved org-unit node: `{ id, label }`) to `GenerateObjectInput` / `StreamTextInput` / `StreamObjectInput` (the call context). |
| `QuotaEnforcingLanguageModel` (adapter) | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | new | Decorator wrapping `ILanguageModel`; checks enabled budgets before each call (mirrors `UsageTrackingAdapter`). |
| `DrizzleBudgetRepository` (adapter) | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | new | Implements `IBudgetRepository` against `app_usage_budgets`. |
| `GetGovernanceDashboard` (use-case) | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | new | Spend by flow/team over a period + budget utilisation. |
| `Create/Update/Delete/ListBudgets` (use-cases) | `packages/application/src/use-cases/governance/*.ts` | new | Admin budget CRUD. |
| `ai_usage_events` | `packages/adapters/src/db/schema/ai.ts` | existing → extend | Add `flow_id`, `session_id`, `org_node_id`, `team_label` columns + indexes. |
| `app_usage_budgets` | `packages/adapters/src/db/schema/wayfinder.ts` | new | Budget config table. |
| `core_audit_log` | `packages/adapters/src/db/schema/core.ts` | existing | Reuse: write `budget.warn` / `budget.blocked` audit events. |

## 6. User stories

1. As an **admin**, I open the governance dashboard and see spend broken down by
   flow and by team over the last 30 days, and which flows cost the most.
2. As an **admin**, I set a $50 `per_run` budget on the "RFQ Drafting" flow and a
   $2,000 `monthly` budget on the "Procurement" team, each enabled, with an 80%
   warn threshold. I pick the team from a **level dropdown** that walks the
   management chain — choosing a higher node to cap a whole division or a lower
   one to cap a single sub-team.
3. As an **admin**, when the "RFQ Drafting" flow's current run reaches $40 spend,
   I see it flip to **warn** on the dashboard and a `budget.warn` audit event is
   written.
4. As an **admin**, when that run reaches $50, the next LLM call is **blocked**,
   the session pauses with a clear message, and a `budget.blocked` audit event is
   recorded; raising the limit lets the user resume.
5. As a **flow owner**, I can see my flow's running cost so I can request a higher
   limit before it is throttled.
6. As an **admin**, a flow or team with **no enabled budget** behaves exactly as
   today — fully recorded, never blocked.

## 7. Pages / surfaces affected

- **`/admin/dashboards/governance`** (new) — spend-by-flow and spend-by-team
  charts, budget utilisation table (ok / warn / blocked), spend-over-time, and
  overrun highlights. Built with Recharts, mirroring
  `admin/dashboards/overview/_content.tsx`.
- **`/admin`** hub — add a link/card to the governance dashboard.
- **Budget management** — a CRUD surface (within the governance page or
  `/admin/governance/budgets`) to create/enable/disable budgets per flow/team.
  The team picker is the **level dropdown**: resolve a chain and let the admin
  choose which org-unit node (tier) the budget targets.
- **tRPC** — new `governance` router (admin-only): `spendByFlow`, `spendByTeam`,
  `utilisation`, `budgets.{list,create,update,delete}`, and `teamOptions`
  (resolve the chain → selectable org-unit nodes for the dropdown).
- **Agent / session call paths** — `run-turn`, `run-auto-node`, and the agent
  graph (`flow-session-graph.ts`) must pass `flowId` / `sessionId` / `team` into
  every `ILanguageModel` call so recording and enforcement have context.
- **Session pause path** — when a call returns `QUOTA_EXCEEDED`, the calling
  use-case surfaces a system message and pauses the session rather than failing
  hard.
- **Wiring** — `apps/web/src/lib/container.ts` wraps the model as
  `withQuotaEnforcement(withUsageTracking(provider))` and injects the budget
  repository + governance use-cases.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `ai_usage_events` | ADD `flow_id uuid` (nullable, FK → `app_flows`, `on delete set null`), `session_id uuid` (nullable), `org_node_id text` (nullable — the acting user's resolved team node), `team_label text` (nullable — cached display label). Indexes on `(flow_id, created_at)`, `(org_node_id, created_at)`, `(session_id)`. | n/a (existing `ai_`) |
| `app_usage_budgets` | NEW — `id` uuid PK, `scope text` (`flow` \| `team`), `scope_ref text` (flow id, or **org-unit node id** for a team), `scope_label text` (cached display label), `period text` (`per_run` \| `monthly`), `limit_usd real`, `warn_threshold_pct smallint default 80`, `enabled boolean default false`, `created_at`, `updated_at`. Unique index on `(scope, scope_ref, period)`. | yes (`app_`) |

Columns are snake_case; `id` / `created_at` / `updated_at` present per
convention. Cross-schema FK from `ai_usage_events.flow_id` to `app_flows.id` is
acceptable (single Postgres database). Current-period spend is computed on the
fly by summing `ai_usage_events.cost_usd` over the scope + period window (no
separate counter table in v1 — see §12). For a **team** budget the scope window
matches every `org_node_id` at or below the budget's target node; membership is
resolved from the org structure (the acting user's chain) rather than stored, so
no org tree is materialised.

## 9. Architectural decisions

### Existing ADRs assumed

- **ADR-001 Hexagonal Architecture** — `IBudgetRepository` is a domain port;
  enforcement is an adapter-layer decorator on the existing `ILanguageModel`
  port. Budget evaluation logic (`evaluateBudget`) is pure domain.
- **ADR-003 Monorepo Structure** — wiring lives in `apps/web/src/lib/container.ts`.
- **ADR-018 Approval Step & Approver Resolution** — already walks the manager
  chain (Entra authoritative, HR sheet fallback). The new `IOrgStructure` port
  generalises that chain-walk to return the whole chain, reusing the same
  precedence and source logic.
- **ADR-021 RBAC** — governance routes are admin-only (`adminProcedure`).

### New ADR introduced by this PRD

- **ADR-026 Usage Governance Enforcement** — enforcement point (a decorator on
  `ILanguageModel`, ordered outermost so it blocks before the inner
  usage-tracking + provider run), how flow/session/team context is threaded
  through the port, the **org-tier team model** (a team is an org-unit node
  resolved from org structure via `IOrgStructure`; budgets key on a stable node
  id; spend rolls up the subtree), on-the-fly period-spend computation vs a
  counter table, the warn-then-block model, opt-in/off-by-default semantics, and
  the `QUOTA_EXCEEDED` → session-pause contract.

## 10. Acceptance criteria

- [ ] Every LLM call writes an `ai_usage_events` row carrying `flow_id`,
      `session_id`, `org_node_id`, and `team_label` whenever those are known.
- [ ] A team budget targets an org-unit node chosen from the level dropdown
      (`governance.teamOptions` resolves the chain); spend for it rolls up every
      `org_node_id` in the target node's subtree. Entra is authoritative; the
      uploaded HR sheet is the fallback when Entra is not configured.
- [ ] With **no enabled budget**, behaviour is identical to today: calls are
      recorded and never blocked.
- [ ] An admin can create, enable, disable, edit, and delete a budget scoped to a
      flow or a team via the `governance.budgets` tRPC procedures.
- [ ] When current-period spend for an enabled budget reaches the warn threshold,
      `evaluateBudget` returns `warn`, the dashboard shows `warn`, and a
      `budget.warn` audit event is written.
- [ ] When current-period spend reaches the limit, the next LLM call for that
      scope returns `QUOTA_EXCEEDED`, the session pauses with a clear message, and
      a `budget.blocked` audit event is written. Raising/disabling the budget lets
      the session resume.
- [ ] `per_run` budgets sum spend for the active `session_id`; `monthly` budgets
      sum spend for the flow/team since the start of the current calendar month.
- [ ] Both a flow budget and a team budget can apply to one call; the **stricter**
      (first to block) wins.
- [ ] The governance dashboard renders spend by flow and by team over a selected
      period and a utilisation table with ok / warn / blocked status.
- [ ] No AI SDK / framework import is added outside `packages/adapters`; budget
      evaluation has no external deps (ESLint boundary check passes).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` are
      `1.47.0` and match.

## 11. Out of scope / future work

- **Per-user budgets** and budgets at session/run scope set independently of a
  flow.
- **AUD / multi-currency** budgets and a configurable FX rate.
- **A stored org tree / `core_teams` table.** Structure is resolved on demand
  from Entra / the HR sheet; we do not mirror or sync it into its own table this
  round.
- **Chargeback / billing export** (CSV / finance integration) of spend by
  flow/team.
- **Budget-approaching email notifications** (reusing the v1.35 notification
  outbox) — this round raises audit events + dashboard signals only.
- **Pre-call cost estimation / token pre-flight** to block a call *before* it
  starts based on predicted cost (this PRD blocks based on already-recorded
  spend).
- **A materialised per-period spend counter** for high call volumes.

## 12. Risks / open questions

- **Context threading.** Recording and enforcement both depend on `flowId` /
  `sessionId` / `team` reaching the `ILanguageModel` call. Every call site
  (agent graph, auto-nodes, ad-hoc calls) must pass them; calls that don't will
  record nulls and be un-enforced. **Mitigation:** thread context where sessions
  exist; treat missing context as "no scope, not enforced" and audit it.
- **On-the-fly spend query cost.** Each enforced call sums `ai_usage_events` for
  the scope/period. Indexed on `(flow_id, created_at)` / `(org_node_id, created_at)`;
  acceptable at current volume. A counter table is the optimisation if needed
  (§11). **Off-by-default means zero query when no budget exists** — short-circuit
  if `findEnabledForFlowAndOrgNodes` returns nothing.
- **Last-call overshoot.** Spend is checked before a call; the call that crosses
  the limit still completes, so a scope can land slightly over. Documented as
  intended (governance ceiling, not metered prepay).
- **Streaming cost timing.** Streamed calls only know final token usage after the
  stream ends, so a long stream is checked at start, not mid-stream. Acceptable
  for v1; noted for the counter-table follow-up.
- **Org re-org / node stability.** Team budgets key on an org-unit node id
  (Entra object id / HR row id). Re-orgs move people between nodes and can orphan
  a budget whose node disappears; the cached `scope_label` keeps it legible and
  an admin can re-point it. HR row ids are only as stable as re-uploads — decide
  at build whether to key HR nodes on manager email instead.
- **No resolvable structure.** If neither Entra nor an HR sheet is configured,
  `IOrgStructure` returns an empty chain: team budgets can't be created and calls
  record a null `org_node_id` (un-scoped → recorded only, never blocked). Flow
  budgets are unaffected.
- **Blocked-session UX.** A paused session must clearly tell the user *why*
  ("usage budget reached — contact an administrator") and not look like a crash.
- **Decorator order.** Quota enforcement must wrap *outside* usage tracking so it
  can short-circuit before the provider call; getting the order wrong would
  record usage for a call that should have been blocked. Locked in ADR-026.
