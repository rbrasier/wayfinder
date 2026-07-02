# Implementation Summary — Codebase Bug Fixes (v1.54.0)

- **Version bump**: MINOR — `1.53.2` → `1.54.0`
- **Date**: 2026-07-02
- **Phase doc**: `codebase-bug-fixes.phase.md` (this directory)

## What was built

Eight verified defects from a codebase bug hunt, fixed tests-first. No DB
migration was required.

| # | Severity | Fix |
| - | --- | --- |
| 1 | HIGH | Document transcript now keeps the most recent turns (tail truncation) instead of the oldest 8k chars |
| 2 | HIGH | Fork branch-choice gate uses the node's configured threshold, not a hardcoded 90 |
| 3 | HIGH | AI cost estimate is provider-aware — no negative cost on cached Anthropic calls; unknown models use a provider fallback rate instead of $0 |
| 4 | MEDIUM | Email-assigned approvals are authorised by the decider's account email (or admin) |
| 5 | MEDIUM | Approval decisions use an atomic `updateIfPending` guard against a double-decide race |
| 6 | MEDIUM | Scheduler claim is a durable, leased `UPDATE … FOR UPDATE SKIP LOCKED` — concurrent claimants get disjoint batches and a crash mid-fire self-heals |
| 7 | LOW-MED | Exact knowledge search escapes LIKE metacharacters (`%`, `_`, `\`) so "exact" is literal |
| 8 | LOW | XLSX import reads the workbook's first *tab* (via workbook.xml + rels), not the lexicographically-first part |

## Files created

- `packages/adapters/src/repositories/drizzle-hybrid-retriever.test.ts` — exact-pattern escaping (#7)
- `packages/adapters/src/repositories/drizzle-schedule-repository.test.ts` — durable-claim SQL shape (#6)
- `apps/web/src/app/api/chat/[sessionId]/stream/branch-gate.ts` + `.test.ts` — pure branch-choice gate (#2)
- `apps/web/e2e/fix-fork-advance-threshold.spec.ts` — fork-advance e2e (#2)
- `docs/development/implemented/v1.54.0/` — this summary + the moved phase doc

## Files modified

- `packages/application/src/use-cases/document/field-resolution.ts` (+ test) — tail truncation (#1)
- `packages/adapters/src/observability/usage-tracking-adapter.ts` (+ test) — provider-aware cost, Bedrock rate, fallback rate (#3)
- `packages/domain/src/ports/approval-repository.ts` — new `updateIfPending` port method (#5)
- `packages/adapters/src/repositories/drizzle-approval-repository.ts` — `updateIfPending` + shared `patchToColumns` (#5)
- `packages/application/src/use-cases/approvals/decide-approval.ts` (+ test) — email authz (#4) and conditional decision write (#5)
- `packages/application/src/use-cases/document/update-document-fields.test.ts` — fake repo satisfies the extended port
- `apps/web/src/lib/container.ts` — wire `users` into `DecideApproval` (#4)
- `packages/adapters/src/repositories/drizzle-schedule-repository.ts` — durable leased claim (#6)
- `packages/adapters/src/hr/spreadsheet-parser.ts` (+ test) — workbook-ordered sheet resolution (#8)
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — use `shouldComputeBranchChoice` (#2)
- `VERSION`, `package.json` — 1.54.0

## Migrations run

None. #5 uses a conditional `WHERE status='pending'` (no schema change); #6 leases
by advancing the existing `next_fire_at` column (no schema change).

## Tests added

- Unit tests for #1, #2, #3, #4, #5, #6, #7, #8 (executed; full workspace suite
  green — domain/application/adapters/web/api/shared).
- E2E `fix-fork-advance-threshold.spec.ts` for #2, authored for the dedicated CI
  e2e job (AI-mock + seeded stack). The pure gate it exercises is unit tested in
  `branch-gate.test.ts`.

## Known limitations

- The scheduler durable-claim's concurrency guarantee (disjoint batches under two
  live claimants, SKIP LOCKED) is a Postgres behaviour that only a live DB
  exercises; the unit test locks in the generated statement shape (UPDATE +
  `FOR UPDATE SKIP LOCKED` + lease) so it cannot silently regress to a bare
  SELECT. A DB-backed integration test should run in CI where Postgres is up.
- The claim lease is a fixed 15 minutes (`CLAIM_LEASE_MS`); it only applies to the
  crash window between claiming and firing, since a normal fire overwrites
  `next_fire_at`/`status` immediately.
- #1: the tail-truncation fix addresses the dropped-turns defect directly;
  threading prior step outputs/insights into generation as a further mitigation
  was left out of scope to avoid new cross-use-case plumbing.
