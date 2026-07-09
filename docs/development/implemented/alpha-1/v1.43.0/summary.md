# Implementation Summary — Flow Versioning / Change History (v1.43.0)

- **Version bump**: **MINOR** → `1.43.0` (new table, new `app_sessions` column,
  new domain entity, new port; no breaking change).
- **PRD**: `docs/development/prd/flow-versioning.prd.md`
- **ADR**: `docs/development/adr/015-flow-versioning-snapshots.adr.md`
- **Phase doc**: `flow-versioning.phase.md` (this folder)

## What was built

Immutable flow versioning with a draft→published lifecycle, per-chat version
pinning, read-only history inspection, and non-destructive restore (ADR-015).

1. **`FlowVersion` entity + `FlowSnapshot` value object** — a self-contained,
   serialisable `{ flow, nodes, edges }` snapshot. `buildFlowSnapshot` assembles
   one from the live definition; `flowNodesFromSnapshot` / `flowEdgesFromSnapshot`
   reconstruct live-shaped rows so the runner and canvas render a pinned version
   through the same types as the live rows.
2. **`app_flow_versions` table** — `version_number` is null while `draft`,
   allocated monotonically per flow on publish. A `(flow_id, version_number)`
   unique constraint plus a partial unique index on `(flow_id) WHERE status =
   'draft'` enforce at most one open draft per flow.
3. **`app_sessions.flow_version_id`** — pins a chat to the version that was
   latest-published when it started.
4. **`IFlowVersionRepository` + `DrizzleFlowVersionRepository`** — `createPublished`
   (promotes the open draft or inserts a fresh published row, allocating the next
   number in one transaction), `upsertDraft`, `restore` (rewrites live rows from a
   snapshot — upserting nodes by id so session children are not cascade-deleted —
   and records a new published version), plus `listForFlow` (metadata only),
   `getById`, `getByNumber`, `latestPublished`, `openDraft`.
5. **Use-cases** — `PublishFlowVersion`, `ListFlowVersions`, `GetFlowVersion`,
   `RestoreFlowVersion`, `SyncFlowDraft`. Publish and restore write
   `flow.version.published` / `flow.version.restored` audit events.
6. **Session pinning** — `StartSession` resolves the latest published version,
   derives the root node from its snapshot, and stores `flow_version_id`.
   `GetSession` and `RunTurn` read the pinned snapshot (definition + advancement
   edges), so a publish/restore never moves an in-progress chat.
7. **tRPC `flowVersion` router** (`list`/`get`/`restore`) and the `flow.update`
   publish transition extended to promote the draft and accept a `changeSummary`;
   edit mutations refresh the draft via `SyncFlowDraft`.
8. **Version-history panel** — `VersionHistoryDialog` mounted on both the owner
   canvas (`/flows/[id]/config`) and the admin canvas (`/admin/flows/[id]`): lists
   versions (number, status, author, date, summary), read-only snapshot view, and
   a Restore action.

## Files created

- `packages/domain/src/entities/flow-version.ts` (+ `.test.ts`)
- `packages/domain/src/ports/flow-version-repository.ts`
- `packages/adapters/src/repositories/drizzle-flow-version-repository.ts`
- `packages/adapters/drizzle/0023_flow_versioning.sql` (+ meta snapshot)
- `packages/application/src/use-cases/flow/publish-flow-version.ts`
- `packages/application/src/use-cases/flow/list-flow-versions.ts`
- `packages/application/src/use-cases/flow/get-flow-version.ts`
- `packages/application/src/use-cases/flow/restore-flow-version.ts`
- `packages/application/src/use-cases/flow/sync-flow-draft.ts`
- `packages/application/src/use-cases/flow/flow-version.test.ts`
- `apps/web/src/server/routers/flow-version.ts`
- `apps/web/src/components/canvas/version-history-dialog.tsx`
- `tests/e2e/phase-flow-versioning.spec.ts`

## Files modified

- Domain: `entities/session.ts` (optional `flowVersionId`), `entities/index.ts`,
  `ports/index.ts`.
- Adapters: `db/schema/wayfinder.ts` (table + column + indexes),
  `repositories/drizzle-session-repository.ts`, `repositories/index.ts`.
- Application: `session/start-session.ts`, `session/get-session.ts`,
  `session/run-turn.ts`, `session/session.test.ts`, `flow/index.ts`.
- Web: `lib/container.ts`, `server/router.ts`, `server/routers/flow.ts`,
  `app/(user)/flows/[id]/config/_content.tsx`, `app/(admin)/admin/flows/[id]/_content.tsx`.
- `VERSION`, root `package.json` → `1.43.0`.

## Migrations run

`0023_flow_versioning.sql` — creates `app_flow_versions`, adds
`app_sessions.flow_version_id` (+ FK/index), and **back-fills**: a `published`
`version_number = 1` for every published, non-deleted flow (snapshotting its
current nodes/edges), then pins every existing session to its flow's back-filled
version. Draft-only flows get no version until first publish.

## e2e tests added

`tests/e2e/phase-flow-versioning.spec.ts`:
- **Happy path** — create a flow, publish it, open Version history, assert
  version 1 is listed with a Restore action.
- **Empty/error path** — a never-published flow shows the empty-state copy.

## Known limitations

- **e2e not executed in the build container.** The Playwright stack (Postgres,
  Redis, MinIO, dev server, seeded auth) and the `tests/e2e` dependencies are not
  available here — the same reason `validate.sh` skips the drizzle/DB checks. The
  spec follows the repo's existing conventions (graceful skips) and should be run
  in an environment with the stack up.
- **Restore vs. an open draft** — restore records a new published version but
  leaves any open draft untouched; the draft refreshes on the next edit.
- **Mid-session upgrade** is intentionally out of scope (PRD §11): a long-lived
  chat finishes on its pinned version even after newer publishes.
- **Snapshot growth / retention** — each publish duplicates the definition as
  jsonb; a pruning policy is deferred (PRD §11).
