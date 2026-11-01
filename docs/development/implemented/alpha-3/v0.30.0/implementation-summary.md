# Implementation Summary — Flow Portability (v0.30.0)

- **Version**: 0.30.0 — **MINOR** (new feature, no schema change)
- **Base branch**: `main` (release line `alpha-3`)
- **Phase doc**: [`flow-portability.phase.md`](flow-portability.phase.md)
- **PRD**: `docs/development/prd/flow-portability.prd.md`
- **ADR**: `docs/development/adr/049-flow-export-archive-format.adr.md`

## What was built

A flow's definition now exports as a portable `.zip` — `manifest.json` wrapping
the existing `FlowSnapshot` verbatim, plus an `assets/` directory of uploaded
templates and context documents — and imports into another deployment as a new
draft flow. Import is inspect-then-commit: the archive is opened, validated and
reported on before a single row is written. Skills and MCP tools travel by name
and resolve against the destination; what does not resolve lands as a flagged
node that blocks publish. Duplicate is the same machinery without the file
round-trip.

## Files created

**Domain** (`packages/domain/src/`)

| File | What it holds |
|---|---|
| `entities/flow-export.ts` | `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`, `FlowImportInspection`, `FlowImportResolution`, `FLOW_EXPORT_FORMAT_VERSION`, `MIN_SUPPORTED_FORMAT_VERSION` |
| `entities/flow-export-manifest.ts` | `validateManifest`, `migrateManifest`, `ManifestMigration`, `MANIFEST_MIGRATIONS` |
| `entities/flow-export-dependencies.ts` | `collectDependencies`, `FlowDependencyRef` |
| `entities/flow-import-resolve.ts` | `resolveFlowDependencies`, `DependencyCandidates` |
| `entities/flow-import-rewrite.ts` | `rewriteSnapshot`, `remapNodeReferences` |
| `ports/flow-archive.ts` | `IFlowArchiveReader`, `IFlowArchiveWriter`, `FlowArchiveLimits`, `FLOW_ARCHIVE_LIMITS` |

**Adapters** (`packages/adapters/src/`)

| File | What it holds |
|---|---|
| `archives/zip-guards.ts` | The zip-slip, entry-count, per-entry and decompression-bomb guards — one implementation, shared |
| `flows/zip-flow-archive.ts` | `ZipFlowArchive`, the only place PizZip appears for flow archives |

**Application** (`packages/application/src/use-cases/flow/`)
`export-flow.ts`, `inspect-flow-import.ts`, `import-flow.ts`, `duplicate-flow.ts`.

**Web** (`apps/web/src/`)
`app/api/flows/[id]/export/route.ts`, `app/api/flows/import/route.ts`,
`lib/container-flow-portability.ts`,
`lib/http-errors.ts`, `components/flow/flow-import-dialog.tsx`,
`components/flow/flow-import-inspection-panel.tsx`,
`components/flow/flow-import-summary.ts`, `components/flow/flow-row-actions.tsx`,
`components/canvas/unresolved-dependencies.ts`,
`components/canvas/unresolved-dependencies-badge.tsx`.

## Files modified

- `packages/domain/src/entities/flow-node.ts` — `unresolvedDependencies?` on
  `ConversationalNodeConfig` and `McpNodeConfig`; `McpNodeConfig.serverId`
  widened to `string | null`.
- `packages/adapters/src/extraction/zip-ingestor.ts` — refactored onto the
  shared guards; behaviour unchanged and its existing tests pass untouched.
- `packages/application/src/use-cases/flow/publish-flow-version.ts` — refuses a
  flow whose live nodes still carry `unresolvedDependencies`.
- `apps/web/src/server/routers/flow.ts` — `flow.duplicate`.
- `apps/web/src/lib/container.ts` — builds the portability module (net zero lines).
- `apps/web/src/app/(admin)/admin/flows/_content.tsx` — Import button, row actions.
- `apps/web/src/app/(user)/flows/[id]/config/_flow-config-header.tsx` — Export.
- `apps/web/src/components/canvas/conversational-node.tsx`, `mcp-node.tsx` — badge.
- `packages/domain/src/entities/audit-hash.ts` — `Sha256Bytes`, the byte-oriented
  counterpart to the existing `Sha256Hex`.
- `packages/adapters/src/audit/sha256.ts` — `sha256Bytes` implementing it.
- Barrels in domain, adapters and application.

## Migrations

**None.** No table was added, altered or dropped, and no migration was
generated. The `unresolvedDependencies` flag lives in the existing node `config`
jsonb column (ADR-006), which is what let this ship as a MINOR with no schema
impact.

## Deviations from the approved change summary

Six, all recorded here rather than absorbed silently.

1. **`FlowExportDependency` carries an opaque `sourceId`.** The manifest keys
   dependencies by name while the embedded snapshot keeps the exporting
   deployment's ids verbatim, so nothing linked `skillRefs: ["<id>"]` to the
   named dependency describing it — a hole in ADR-049 as written. `sourceId` is
   that join key. Resolution is still by name and the id is never looked up
   locally. The PRD's "no MCP server id appears in a manifest" criterion is
   therefore met in substance but not to the letter.

2. **`resolveFlowDependencies` is a pure domain function, not an adapter.** The
   phase doc placed a `dependency-resolver.ts` in adapters. It needs only the
   skill and server lists the existing repositories already return, so making it
   an adapter would have meant a new port for no gain.

3. **Export, inspect and import are route handlers only — not tRPC procedures.**
   The phase doc listed all four as tRPC procedures *and* as binary routes.
   Base64 through tRPC inflates a 50 MB upload by a third, which the PRD
   explicitly rules out. `flow.duplicate` remains a tRPC procedure; the other
   three live at `/api/flows/[id]/export` and `/api/flows/import`.

4. **Component logic is tested as pure modules, not with a component test
   runner.** The repo has no `@testing-library/react` and no `.test.tsx` files;
   its actual convention is a thin component beside a pure `.ts` model with a
   `.test.ts` (`sidebar-model.ts`, `site-banner.ts`, `usage-ring-model.ts`).
   `flow-import-summary.ts` and `unresolved-dependencies.ts` follow it. Adding a
   component-test stack would have been infrastructure work outside this phase.

5. **Asset hashing is injected, not imported.** `ExportFlow` first called
   `node:crypto` directly, which `validate.sh` rejects — `packages/application`
   may import only `@rbrasier/domain` and `@rbrasier/shared`. It now takes a
   `Sha256Bytes` function, wired to the adapter's `sha256Bytes`, mirroring how
   `Sha256Hex` already serves the audit hash-chain.

6. **`collectDependencies` also collects the tool a deterministic MCP node
   calls.** The phase doc named only `skillRefs` and `allowedMcpToolRefs`.
   `McpNodeConfig.serverId`/`toolName` is equally a cross-deployment reference,
   and omitting it would have imported MCP nodes with a dangling server id.

Two additions surfaced during the build and were folded in with the approver's
sight of them at Step 0:

- **Approval config carries node ids.** `ApprovalSubject` and
  `ChangesRequestedTarget` both hold `{ kind: "step", nodeId }`. Regenerating
  node ids without remapping them would leave an imported approval step pointing
  at a node that does not exist, and a `changes_requested` decision would
  silently fall back to `nearest_editable`. `remapNodeReferences` handles both.
- **A server that communicates outside Wayfinder is never resolved against.**
  `RunMcpNode` refuses one at execution time, so resolving to it would produce a
  flow that looks complete and fails on first run.

## Known limitations

- **`migrateManifest` has no production migration to run.** Format 1 is the only
  version that exists, so `MANIFEST_MIGRATIONS` is empty. The walk itself is
  covered by tests using an injected registry; the first real migration adds an
  entry and a case beside it. The phase's "an older supported version migrates
  forward" criterion is met as a mechanism, not as an exercised path — there is
  nothing older to exercise.
- **Assets are buffered, not streamed.** `IObjectStorage.get` returns a whole
  `Buffer`. Peak memory is roughly one uncompressed archive per concurrent
  import, bounded by the ceilings (50 MB compressed, 200 MB uncompressed, 100
  assets, 25 MB each). Streaming is recorded as out of scope in PRD §11.
- **Import is not transactional.** It creates a flow, then nodes, then edges
  through the existing per-entity repositories, so a mid-way infrastructure
  failure can leave a partial draft flow. This matches every other multi-step
  flow-authoring use-case in the codebase; no unit-of-work spans them today.
- **Row actions are mounted on `/admin/flows` only.** The user-facing `/flows`
  list was left alone; `FlowRowActions` is not coupled to the admin page and can
  be mounted there when that surface is next touched.
- **The root container was at its size ceiling.** `container.ts` was already 796
  lines against an 800-line hard limit, so this feature's wiring lives in
  `lib/container-flow-portability.ts` alongside the existing `container-*`
  modules. The net change to `container.ts` is zero lines.
- **A failed export still downloads.** The row action and canvas control are
  plain `<a download>` links, so when the route answers with a JSON error the
  browser saves that body as `export.json`, named from the URL's last segment,
  rather than reporting the error in the page. Routing the download through
  JavaScript would mean buffering the whole archive in the page, which the link
  avoids. The e2e spec asserts the `.zip` extension precisely because that is
  what distinguishes a real export from this case.
- **Duplicate does not copy flow permissions.** The copy is owned by whoever
  duplicated it, with no shared-viewer grants carried over.

## Tests added

| Layer | File | Count |
|---|---|---|
| domain | `flow-export-manifest.test.ts` | 20 |
| domain | `flow-export-dependencies.test.ts` | 12 |
| domain | `flow-import-rewrite.test.ts` | 22 |
| domain | `flow-import-resolve.test.ts` | 10 |
| adapters | `archives/zip-guards.test.ts` | 18 |
| adapters | `flows/zip-flow-archive.test.ts` | 19 |
| application | `flow-portability.test.ts` | 33 |
| application | `flow-version.test.ts` (publish gate) | +3 |
| web | `app/api/flows/import/route.test.ts` | 10 |
| web | `app/api/flows/[id]/export/route.test.ts` | 6 |
| web | `server/routers/flow-portability.test.ts` | 5 |
| web | `lib/http-errors.test.ts` | 11 |
| web | `components/flow/flow-import-summary.test.ts` | 12 |
| web | `components/canvas/unresolved-dependencies.test.ts` | 9 |

`ZipIngestor`'s eight existing tests pass **unchanged** after its refactor onto
the shared guards — which is the evidence that it was a refactor.

## E2E

One spec, `apps/web/e2e/flow-portability.spec.ts`, covering the export download
and the import upload — e2e policy **group 3** (file upload and download).
Nothing else in the feature qualifies; the rest is covered at the layers above.
The spec was written and reviewed by reading, not run locally: CI runs the
sharded suite against a full stack on every pull request.
