# Enhancement: Spend caps on the Usage admin screen

## What & Why

Per-user spend caps already exist and are managed on the Cost governance
dashboard (`/admin/dashboards/governance`). However, an admin who wants to set a
usage limit naturally looks under **Usage** (`/admin/usage`), where cost and
token metrics live — and finds no way to configure caps there. This enhancement
surfaces the existing spend-cap configuration on the Usage screen so caps can be
created, toggled, and removed from the place admins expect.

No new domain entities, use cases, server procedures, or DB changes. The
existing `governance.budgets.{list,create,update,delete}` tRPC procedures and
`user.list` back the feature unchanged.

## Scope

- **In scope:** Extract the existing "Spend caps" CRUD block from the governance
  dashboard into a shared client component, then render it on both the governance
  dashboard (behaviour unchanged) and the Usage screen.
- **Out of scope:** The cap *utilisation* table and spend charts (these stay on
  the governance dashboard, where the dashboard query that feeds them lives). No
  changes to budget enforcement, the domain, or the database.

## Entities / Use Cases Affected

None changed. The component reuses:

- `governance.budgets.list` / `create` / `update` / `delete`
- `user.list`

## User Flow

1. Admin opens `/admin/usage`.
2. Below the cost/token metric cards and the "Usage by model" table, a **Spend
   caps** card is shown.
3. Admin selects a user, period (daily/weekly/monthly), limit (USD), and warn %,
   then clicks **Add cap**.
4. The cap appears in the caps table and can be **Enable**/**Disable**d or
   **Delete**d — identical to the governance dashboard.

## Files Changed

| File | Action |
|------|--------|
| `apps/web/src/components/admin/spend-caps-card.tsx` | New — shared client component extracted from governance `_content.tsx` |
| `apps/web/src/components/admin/spend-caps-card.test.tsx` | New — component test |
| `apps/web/src/app/(admin)/admin/dashboards/governance/_content.tsx` | Modified — replace inline "Spend caps" block with `<SpendCapsCard />` |
| `apps/web/src/app/(admin)/admin/usage/_content.tsx` | Modified — render `<SpendCapsCard />` |
| `apps/web/src/app/(admin)/admin/usage/page.tsx` | Modified — prefetch `governance.budgets.list` and `user.list` |
| `apps/web/e2e/enhance-usage-limits-admin-ui.spec.ts` | New — e2e coverage |

> Note: there is no Usage card on the admin hub (`/admin/page.tsx`) — Usage is
> reached via the sidebar's Advanced group — so no hub copy change is needed.

## No DB / API Changes

The `governance` router already exposes the budget procedures; the Usage screen
just consumes them. The only `page.tsx` change is adding prefetch calls that
mirror the governance page.

## Version Bump

PATCH — 1.48.2 → 1.48.3 (UI-only reuse of existing procedures, no schema or API
surface change).

---

## Implementation Summary

**Approach:** The per-user spend-cap CRUD already lived inline in the Cost
governance dashboard. It was extracted verbatim into a shared client component
and rendered on both the governance dashboard and the Usage screen. Because both
surfaces use the same `governance.budgets.*` tRPC query keys, their caches stay
in sync automatically — creating a cap on Usage immediately reflects on the
governance dashboard and vice versa.

**Files changed:**

- `apps/web/src/components/admin/spend-caps-card.tsx` — New shared component
  `SpendCapsCard`. Holds the add-cap form (user / period / limit / warn %) and
  the caps table with Enable/Disable/Delete. Wraps `governance.budgets.list`,
  `governance.budgets.create/update/delete`, and `user.list`. Invalidates both
  the budgets list and the governance dashboard on every mutation.
- `apps/web/src/components/admin/spend-caps-card.test.tsx` — New component test
  (matches the repo's lightweight component-test pattern; behaviour is covered by
  the e2e).
- `apps/web/src/app/(admin)/admin/dashboards/governance/_content.tsx` — Replaced
  the inline "Spend caps" card (and its now-unused state, queries, mutations and
  imports) with `<SpendCapsCard />`. The utilisation table and spend charts are
  unchanged.
- `apps/web/src/app/(admin)/admin/usage/_content.tsx` — Renders `<SpendCapsCard />`
  below the "Usage by model" table.
- `apps/web/src/app/(admin)/admin/usage/page.tsx` — Prefetches
  `governance.budgets.list` and `user.list` to match the governance page.

**E2e test:** `apps/web/e2e/enhance-usage-limits-admin-ui.spec.ts` — covers the
new behaviour on `/admin/usage`: the Spend caps card renders alongside usage
metrics, and an admin can create a cap, toggle it (disable → enable), and delete
it without leaving the Usage screen.

**Validation:** `./validate.sh` — typecheck, lint, tests, coverage all pass. The
single remaining failure is a pre-existing `nodemailer` audit advisory unrelated
to this change (no dependencies were modified).
