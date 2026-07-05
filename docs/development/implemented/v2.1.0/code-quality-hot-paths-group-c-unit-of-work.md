# Implementation Summary — Code Quality: Hot Paths, Group C (unit of work) (v2.1.0)

- **Version**: 2.1.0 (**MINOR** — new domain port + adapter and a restructured
  hot-path use case. No schema change, no migration; API/UI behaviour unchanged).
- **Date**: 2026-07-05
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group C
  — Unit-of-work port** (phase doc under `to-be-implemented/`). Sequenced after
  Group A per the phase (A → C → B → …), so a later `ExecuteTurn` use case can be
  transactional from day one.
- **Scope built**: item **7** (the `UnitOfWork` port + adapter) and item **8**'s
  first target, `RunTurn.persistAssistantTurn`. `DecideApproval` and
  `ApplyAutoNodeResult` (the remaining item-8 multi-write use cases) are deferred
  to a follow-up slice.

## What was built

### Item 7 — `UnitOfWork` transaction port (domain) + Drizzle adapter

- `packages/domain/src/ports/unit-of-work.ts`: `IUnitOfWork.withTransaction<T>(work)`
  plus a `TransactionalRepositories` bag (currently `sessions` + `sessionMessages`;
  grows as more use cases are wrapped). The application layer sees only these
  ports — no ORM leaks in, keeping ADR-001 intact.
- `packages/adapters/src/db/drizzle-unit-of-work.ts`: `DrizzleUnitOfWork` runs
  `work` inside `db.transaction`. Because Drizzle only rolls back on a thrown
  error but the app signals failure with an error `Result`, an internal
  `TransactionRollback` carries a domain error out to trigger the rollback, then
  `withTransaction` unwraps it back into a `Result`. Nothing commits unless
  `work` returns a success Result; an unexpected throw becomes `INFRA_FAILURE`.
  The transactional repositories are constructed over the transaction handle.

### Item 8 (first target) — `persistAssistantTurn` is atomic

`persistAssistantTurn` wrote the assistant message and the session
advance/complete/await as **separate** statements — a crash between them left a
half-applied turn. It now:

1. resolves advancement edges **before** opening the transaction (a read), then
2. runs one transaction that creates the assistant message and applies the single
   session mutation (advance, complete, or mark-awaiting), committing or rolling
   back together, and
3. fires the step-complete / session-complete notifiers **only after commit**.

Behaviour is otherwise identical (same advance/branch/await/complete outcomes and
the same notifier semantics). `RunTurn`'s now-unused direct `ISessionRepository`
dependency was dropped from its constructor; the transactional `sessions` repo
comes from the unit of work.

## Files changed

- `packages/domain/src/ports/unit-of-work.ts` (new) + `ports/index.ts` export.
- `packages/adapters/src/db/drizzle-unit-of-work.ts` (new) + `db/index.ts` export.
- `packages/adapters/src/db/drizzle-unit-of-work.test.ts` (new) — commit,
  error-rollback, and throw-rollback paths against a fake `db.transaction`.
- `packages/application/src/use-cases/session/run-turn.ts` — constructor takes
  `IUnitOfWork` (drops `ISessionRepository`); the two writes run in one
  transaction via new private `commitAssistantTurn` / `commitAwaiting`; notifiers
  fire post-commit.
- `packages/application/src/use-cases/session/session.test.ts` — `FakeUnitOfWork`;
  updated `RunTurn` construction; new test asserting the message write and the
  session advance go through a single transaction.
- `apps/web/src/lib/container.ts` — construct `DrizzleUnitOfWork` and inject it
  into `RunTurn`.
- `tests/e2e/phase-code-quality-hot-paths-group-c.spec.ts` (new) — a committed
  turn's user message and assistant reply survive a reload (durable atomic write).
- `VERSION`, `package.json` — 2.0.2 → 2.1.0.

## Migrations run

None.

## Tests added

- **Unit (adapters)** — `DrizzleUnitOfWork`: success commits and returns the data;
  an error `Result` rolls back and returns that error; a thrown exception rolls
  back and returns `INFRA_FAILURE`. A `rolledBack` flag on the fake proves the
  abort actually fires on the failure paths.
- **Unit (application)** — `persistAssistantTurn` runs the assistant-message write
  and the session advance through exactly one transaction (`transactionCount`),
  with the message persisted and the session advanced. All existing RunTurn
  behaviour tests now run through the unit of work unchanged.
- **E2E** — `phase-code-quality-hot-paths-group-c.spec.ts` exercises the real
  `DrizzleUnitOfWork` against Postgres: a sent turn's user message persists across
  a reload (the transaction committed, not half-applied).

## Known limitations / follow-ups

- **Item 8 remainder**: `DecideApproval` and `ApplyAutoNodeResult` are not yet
  wrapped. Doing so will extend `TransactionalRepositories` with the repositories
  those use cases write (e.g. approvals, session step outputs) — a natural next
  slice.
- `persistUserMessage` is a single write and is intentionally left outside the
  transaction seam.
- The atomicity guarantee (no half-applied turn under a mid-turn crash) is
  verified by the adapter rollback tests; a mid-write process kill is not
  simulated in e2e.
