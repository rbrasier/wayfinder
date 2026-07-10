# Phase — Flow Versioning / Change History

- **Status**: Revised (re-run `/doc-review`)
- **Target version**: 1.43.0 (bump: **MINOR** — new table, `app_sessions`
  column, new domain entity, new port)
- **PRD**: `docs/development/prd/flow-versioning.prd.md`
- **ADR**: `docs/development/adr/015-flow-versioning-snapshots.adr.md`
- **Depends on**: v1.18.0 (flows, nodes, edges, `core_audit_log`), `app_sessions`

## 1. Goal

Capture an **immutable snapshot** of a flow's full definition as a versioned
draft→published lifecycle, pin each chat to the version it started on, expose
version history with read-only inspection, and allow non-destructive restore
(restore = create a new version from a past snapshot).

## 2. Approach

Immutable snapshots with a draft/published lifecycle and session pinning
(ADR-015):

1. **Edit** opens (or updates) a single `draft` version per flow — the live
   `app_flow_*` rows stay the working copy the draft reflects. A partial unique
   index on `(flow_id) WHERE status='draft'` keeps it to one open draft.
2. **Publish** (the `status:"published"` transition on `flow.update`/`updateFlow`,
   not a separate procedure) promotes the open draft: assemble the self-contained
   `FlowSnapshot` (`flow` + `nodes` + `edges`), allocate the next `version_number`
   per flow, set `status='published'` + `published_by`/`published_at` — all in
   one transaction.
3. **Session start** resolves the flow's latest `published` version and stores
   its id on `app_sessions.flow_version_id`, within the session-create
   transaction; the runner reads the pinned snapshot, not the live rows. A chat
   runs that one version until it concludes.
4. History lists are metadata-only (no heavy snapshot payload).
5. Restore rewrites the live flow/nodes/edges from a snapshot (preserving the
   captured node `id`s) and records a new published version noting the source.
   In-progress chats are unaffected — only new chats pick up the restored version.
6. A migration back-fills a `published` `version_number = 1` for every
   already-published flow and pins existing sessions to it.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-version.ts` | New `FlowVersion` entity (incl. `status` draft/published) + `FlowSnapshot` value object. |
| domain | `packages/domain/src/ports/flow-version-repository.ts` | New `IFlowVersionRepository` (`createPublished`, `upsertDraft`, `listForFlow`, `getById`, `getByNumber`, `latestPublished`, `openDraft`). |
| application | `packages/application/src/use-cases/flow/publish-flow-version.ts` | Promote open draft: assemble snapshot, allocate number, persist (hooked into the publish transition). |
| application | `packages/application/src/use-cases/flow/list-flow-versions.ts` | History metadata, newest first. |
| application | `packages/application/src/use-cases/flow/get-flow-version.ts` | One full snapshot for read-only view. |
| application | `packages/application/src/use-cases/flow/restore-flow-version.ts` | Apply snapshot to live rows + create new published version. |
| application | `packages/application/src/use-cases/session/*` (start-session) | Resolve latest published version, set `flow_version_id`; runner reads pinned snapshot. |
| adapters | `packages/adapters/src/repositories/drizzle-flow-version-repository.ts` | Implements the port. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_flow_versions` table; add `app_sessions.flow_version_id`. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: create table + indexes + `app_sessions` column + back-fill published flows and pin existing sessions. |
| apps/web | `flowVersion` tRPC router (`list`, `get`, `restore`) | New router; extend the `flow.update` publish transition to take optional `changeSummary` and promote the draft. |
| apps/web | `/admin/flows/[id]`, `/flows/[id]/config` | Version-history panel: list (with status), read-only view, restore. |
| apps/web | `apps/web/lib/container.ts` | Construct repository + use-cases. |

## 4. Database changes

### New table: `app_flow_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `flow_id` | uuid FK → `app_flows` | cascade delete, indexed |
| `version_number` | integer | monotonic per flow |
| `status` | text | `draft` or `published` |
| `snapshot` | jsonb | full `{ flow, nodes, edges }` |
| `change_summary` | text | nullable |
| `published_by_user_id` | uuid FK → `core_users` | nullable until published |
| `published_at` | timestamptz | nullable until published |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(flow_id, version_number)`. **Partial unique index on
`(flow_id) WHERE status='draft'`** — at most one open draft per flow. Allocate
the next number inside the publish transaction.

### Alter table: `app_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `flow_version_id` | uuid FK → `app_flow_versions` | indexed; set at session start to pin the chat |

Resolve the flow's latest `published` version and write `flow_version_id` inside
the session-create transaction so a concurrent publish cannot leave the pin
ambiguous.

**Back-fill:** insert a `published` `version_number = 1` for every `app_flows`
row with `status='published'`, snapshotting its current nodes/edges; then set
`flow_version_id` on every existing `app_sessions` row to its flow's back-filled
version so in-progress chats remain pinned. Draft-only flows get no version row
until first publish.

## 5. Implementation order (tests first)

1. `FlowVersion` (incl. `status`) / `FlowSnapshot` types; `app_flow_versions`
   schema + `app_sessions.flow_version_id` + migration (incl. back-fill and
   session pinning); repository test → repository.
2. `PublishFlowVersion` test (draft promotion, snapshot completeness, number
   allocation, single-draft constraint, concurrency retry) → use-case; hook the
   `flow.update` publish transition; draft open/update on edit.
3. Session-pinning test (start resolves latest published, stores
   `flow_version_id`; runner reads pinned snapshot; later publish/restore does
   not move an in-progress chat) → start-session change + runner read path.
4. `ListFlowVersions` / `GetFlowVersion` tests → use-cases.
5. `RestoreFlowVersion` test (non-destructive, node-id preservation, new
   published version recorded, active chats unaffected) → use-case.
6. tRPC `flowVersion` router + canvas version-history panel.

Write the test file before each implementation file (CLAUDE.md rule).

## 6. ADR required

ADR-015 (revised) — immutable snapshots vs. branching vs. change-log; snapshot
shape; draft/published lifecycle; session-version pinning; restore-as-new-version;
node-id preservation; back-fill.

## 7. Risks / open questions

Carried from PRD §12: snapshot storage growth, node-id preservation on restore,
single-draft enforcement, version-number concurrency, atomic "latest published"
resolution at session start, long-lived chats finishing on an old pinned version
(intended; mid-session upgrade deferred), and back-fill correctness (including
pinning existing sessions).

## 8. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] Editing a published flow opens/updates a single `draft` version; never
      more than one draft per flow.
- [ ] Publish promotes the open draft to `published` with the next number,
      publisher, `published_at`, and optional summary; snapshot is complete.
- [ ] A new chat records the latest published `version_number` on
      `app_sessions.flow_version_id` and runs that snapshot.
- [ ] A publish or restore during an in-progress chat does not change the
      version that chat runs; it finishes on its pinned version.
- [ ] `flowVersion.list` is metadata-only (incl. status), newest first;
      `flowVersion.get` returns exact captured definition read-only.
- [ ] `flowVersion.restore` rewrites live rows from the snapshot, preserves node
      ids, and records a new published version; no prior snapshot mutated/deleted.
- [ ] Migration back-fills version 1 for every published flow and pins existing
      sessions to it.
- [ ] `flow.version.published` / `flow.version.restored` audit events written.
- [ ] No ORM import outside `packages/adapters`.
- [ ] `./validate.sh` passes; `VERSION` and `package.json#version` match.
