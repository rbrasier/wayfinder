# Phase — Flow Portability (Export / Import / Duplicate)

- **Status**: Reviewed — `/doc-review` passed, ready to build
- **Target version**: **0.30.0** — **MINOR** (new feature, **no schema change**).
  `main` sat at `0.28.4`; `0.29.0` is claimed on another branch.
- **Base branch**: **`main`**, per `CLAUDE.md` — new features land on the next
  release line. Implemented docs go to
  `docs/development/implemented/alpha-3/v0.30.0/` (`alpha-3` is the next release
  line named in `CLAUDE.md`, read from the branch and never from the version
  number). An earlier draft of this doc targeted `release/alpha-2`; that was
  reverted to the standard routing before the build.
- **PRD**: `docs/development/prd/flow-portability.prd.md`
- **ADR**: `docs/development/adr/049-flow-export-archive-format.adr.md`
- **Depends on**: ADR-015 *Flow Versioning via Immutable Snapshots*
  (`FlowSnapshot` — the serialisation this reuses), ADR-006 *Wayfinder Flow and
  Session Schema* (jsonb node config), ADR-033 *Immutable Audit Log & Legal
  Hold*, ADR-018 *Approval Step and Approver Resolution* (already portable — no
  user id baked in), and `IObjectStorage` for assets. Cited by title because 015
  and 033 each number two different ADRs. The skills and MCP decisions the code
  labels "ADR-031"/"ADR-032" have no ADR file at all — 031 is
  *Usage Limit Scope Cascade* and the three 032s are unrelated — so read
  `entities/skill.ts` and `entities/mcp-server.ts` instead.

## 1. Problem

A flow cannot leave the database it was authored in — there is no export,
import, clone or duplicate anywhere in the product. A customer cannot promote a
flow from staging to production, nothing can ship with the product (every install
begins at a blank canvas by design, `wayfinder.prd.md` §4), and a flow cannot be
backed up or reviewed outside a database client.

The serialisation, however, already exists: `FlowSnapshot`
(`packages/domain/src/entities/flow-version.ts`) is a self-contained frozen copy
of a flow's full definition, exercised on every publish and restore. What it
lacks is the binaries — `FlowContextDoc.storagePath` and
`ConversationalNodeConfig.documentTemplatePath` point into object storage, and
`documentTemplateContent` is only the extracted text — and id-free references,
since `skillRefs` and `McpToolRef.serverId` mean nothing on another deployment.

See the PRD for full detail.

## 2. Goals

- Export a flow as one `.zip`: manifest **plus** its templates and context
  documents.
- Import that archive into another deployment and get a working draft flow with
  nothing to re-upload.
- **Inspect before commit** — the dependency report is shown before any row is
  written.
- Unresolved dependencies degrade to a flagged draft, never a silent drop and
  never a refusal.
- Duplicate a flow in place with no file round-trip.
- Never export instance data of any kind.

## 3. Non-goals

Updating/merging an existing flow from an archive, a hosted gallery or
marketplace, exporting instance data, signing or verifying archives, bulk
export/import, a separate export permission, end-to-end streaming. (PRD §4, §11.)
Knowledge-base collections are not a non-goal — they do not exist; a flow's
context documents travel as assets.

## 4. Approach

Per ADR-049. The archive is `manifest.json` + `assets/`; the manifest embeds
`FlowSnapshot` **verbatim** so new node types and config fields stay portable
without touching this feature. Dependencies export by stable name and resolve on
import. Import is two operations — `inspect` writes nothing, `import` commits.

The archive is **untrusted input**: no path inside it is ever used as a write
path (assets are re-keyed by the importer, making zip-slip structurally
impossible), ceilings are enforced before extraction, and every asset's `sha256`
is verified.

Build bottom-up (domain → application → adapters → web), test file before
implementation file (`CLAUDE.md`).

The zip library is **PizZip** — already a dependency of `packages/adapters` and
already driving `ZipIngestor`. Its API must still be re-read in `node_modules`
before step 5, particularly the generate/write path this repo does not yet
exercise; `CLAUDE.md` forbids working from training data on third-party shapes.
Note `node_modules` is not present in a fresh checkout — run `pnpm install`
first.

The flow archive gets its own reader rather than reusing `IArchiveExtractor`
(ADR-049 §10): `ZipIngestor` drops entries whose MIME it cannot sniff, which
would silently discard `manifest.json` and every `.xlsx` template. The **guards**
are shared, not reimplemented — see step 5.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow-export.ts` | new — `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`, `FlowImportInspection`, `FLOW_EXPORT_FORMAT_VERSION` |
| domain | `packages/domain/src/entities/flow-export-manifest.ts` | new — pure `validateManifest(unknown)` and `migrateManifest(manifest)` (older supported versions forward; newer refused) |
| domain | `packages/domain/src/entities/flow-export-dependencies.ts` | new — pure `collectDependencies(snapshot)`: walks node config for `skillRefs` and `allowedMcpToolRefs` (no KB refs exist) |
| domain | `packages/domain/src/entities/flow-import-rewrite.ts` | new — pure `rewriteSnapshot(snapshot, resolution)`: regenerates node ids, rewrites edges, points config at local ids, flags unresolved |
| domain | `packages/domain/src/ports/flow-archive.ts` | new — `IFlowArchiveWriter.write(manifest, assets)`, `IFlowArchiveReader.read(bytes)` with the ceilings as input |
| domain | `packages/domain/src/entities/flow-version.ts` | **unchanged** — `FlowSnapshot` reused as-is |
| domain | `packages/domain/src/entities/flow-node.ts` | add `unresolvedDependencies?: FlowExportDependency[]` to the node configs that can carry one; jsonb, so no migration |
| domain | `packages/domain/src/ports/object-storage.ts` | **unchanged** — `get` stays buffer-only; ceilings bound memory instead (ADR-049 §7) |
| application | `packages/application/src/use-cases/flow/export-flow.ts` | new — authorise, build the snapshot, collect dependencies, stream assets from `IObjectStorage`, emit `flow.exported` |
| application | `packages/application/src/use-cases/flow/inspect-flow-import.ts` | new — read + validate + resolve; **writes nothing** |
| application | `packages/application/src/use-cases/flow/import-flow.ts` | new — rewrite, store assets under fresh keys, create the flow as `draft`, emit `flow.imported` |
| application | `packages/application/src/use-cases/flow/duplicate-flow.ts` | new — in-place clone; copies assets rather than sharing keys |
| application | `packages/application/src/use-cases/flow/publish-flow-version.ts` | refuse a flow whose live nodes still carry `unresolvedDependencies`, naming them |
| adapters | `packages/adapters/src/archives/zip-guards.ts` | new — the zip-slip / count / per-entry / bomb checks lifted out of `zip-ingestor.ts`, one implementation for both readers |
| adapters | `packages/adapters/src/extraction/zip-ingestor.ts` | refactor onto `zip-guards.ts`; behaviour unchanged, existing tests must stay green |
| adapters | `packages/adapters/src/flows/zip-flow-archive.ts` | new — implements both archive ports over PizZip, using `zip-guards.ts` |
| adapters | `packages/adapters/src/flows/dependency-resolver.ts` | new — resolve skill names and MCP server `label` + tool names to local ids; **two matches is unresolved**, never a guess |
| web | `apps/web/src/server/routers/flow.ts` | add `export`, `inspectImport`, `import`, `duplicate` — permission-gated |
| web | `apps/web/src/app/api/flows/[id]/export/route.ts` | new — archive download (binary, not tRPC) |
| web | `apps/web/src/app/api/flows/import/route.ts` | new — archive upload, size-capped |
| web | `apps/web/src/components/flow/flow-import-dialog.tsx` | new — file picker → inspection panel → commit (note: `components/flow/`, singular) |
| web | `apps/web/src/components/flow/flow-row-actions.tsx` | new — Export / Duplicate actions, consumed by the flow list pages |
| web | `apps/web/src/app/(user)/flows/page.tsx`, `apps/web/src/app/(admin)/admin/flows/page.tsx` | mount the row actions and the Import entry point |
| web | `apps/web/src/components/canvas/*` | Export on the canvas toolbar; warning badge on nodes with unresolved dependencies |
| web | `apps/web/src/lib/container.ts` | wire the archive adapter, resolver and four use-cases |
| e2e | `apps/web/e2e/flow-portability.spec.ts` | new — export download + import upload (policy group 3). Named for the capability; no existing spec covers it (`chat-composer-upload` is session attachments) |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — manifest types and validation.** Write
   `flow-export-manifest.test.ts` **first**: (a) a well-formed manifest
   validates; (b) a missing/extra/mistyped field fails with an actionable
   message; (c) `formatVersion` greater than `FLOW_EXPORT_FORMAT_VERSION` is
   refused with **both** versions named; (d) an older supported version migrates
   forward. Then implement. Domain stays dependency-free.

2. **Domain — dependency collection.** `flow-export-dependencies.test.ts`:
   `skillRefs` on multiple nodes collapse to one dependency listing all
   `nodeIds`; `allowedMcpToolRefs` produce `{ kind: "mcp_tool", name, toolName }`
   where `name` is the server's label; a flow with no external references
   produces an empty list; approval nodes contribute nothing (no user ids exist
   to carry). Only two kinds exist — there is no KB collection in the product.

   Note the asymmetry to handle: `collectDependencies` is pure and receives a
   snapshot holding `serverId`, not a label. The export use-case (step 4) is what
   resolves ids to labels before the manifest is written; the domain function
   emits the ids it can see and the use-case maps them. Keep the lookup out of
   `packages/domain` — it has no repositories.

3. **Domain — import rewrite.** `flow-import-rewrite.test.ts`: (a) every node id
   is regenerated and no original id survives; (b) every edge is rewritten and
   none is orphaned; (c) a resolved dependency rewrites node config to the local
   id; (d) an unresolved one leaves the node flagged and the config's stale
   reference cleared, not left dangling; (e) the rewrite is pure — the input
   snapshot is not mutated.

4. **Application — export.** `export-flow.test.ts`: (a) the manifest embeds the
   snapshot verbatim; (b) every referenced template and context doc appears as an
   asset with a matching `sha256`; (c) **no** session, message, document,
   approval or step-output data appears anywhere in the output — assert over the
   whole payload; (d) a non-owner non-admin gets `FORBIDDEN`; (e) `flow.exported`
   is emitted to the audit logger.

5. **Adapters — the archive.** Two parts, in order.

   **5a. Extract the guards.** Lift the zip-slip, entry-count, per-entry-size and
   decompression-bomb checks out of `zip-ingestor.ts` into
   `archives/zip-guards.ts` and refactor `ZipIngestor` onto it. Pure refactor —
   the existing ingestor tests must pass untouched, and that is the check that it
   was a refactor. One implementation of a zip-slip check, not two.

   **5b. The flow archive.** *Re-read PizZip in `node_modules` first — the
   generate/write path especially, which this repo has not used.*
   `zip-flow-archive.test.ts`: round-trips a manifest and assets; **rejects an
   entry whose path escapes the archive root** (`../`); enforces the four
   ceilings **before** extraction (50 MB compressed, 200 MB uncompressed, 100
   assets, 25 MB per asset); a malformed zip and a missing manifest each return a
   Result error rather than throwing; an asset whose `sha256` mismatches fails
   and its bytes are not returned; a `manifest.json` and an `.xlsx` asset both
   survive the read — the regression that reusing `ZipIngestor` would have
   caused.

6. **Application — inspect.** `inspect-flow-import.test.ts`: (a) returns
   resolved and unresolved dependencies correctly; (b) **writes no row and no
   object** — assert counts before and after; (c) a refused `formatVersion`
   surfaces as a Result error, not an inspection; (d) two skills sharing a name
   (or two servers sharing a label) resolve to **nothing** — the dependency comes
   back unresolved with both candidates named in a warning. Neither
   `app_skills.name` nor `admin_mcp_servers.label` is unique, so this is a real
   deployment state, not a contrived one.

7. **Application — import.** `import-flow.test.ts`: (a) always creates a new
   flow, owned by the importer, `status: "draft"`; (b) no existing flow is
   modified by any import; (c) assets are stored under **freshly generated
   keys**, never a path from the archive; (d) an archive with unresolved
   dependencies still imports, writing `unresolvedDependencies` onto each
   affected node's config; (e) `flow.imported` is emitted.

   Then the gate, in `publish-flow-version.test.ts`: publishing a flow whose live
   nodes still carry `unresolvedDependencies` returns `VALIDATION_FAILED` naming
   them, and succeeds once they are cleared. Without this, "not publishable until
   resolved" has nothing enforcing it.

8. **Application — duplicate.** `duplicate-flow.test.ts`: independent draft copy,
   suffixed name, fresh node ids, its own asset copies; deleting the original's
   template leaves the copy's intact.

9. **Web — routes and tRPC.** Binary download and upload route handlers (upload
   capped at 50 MB at the edge, before the archive reader sees it); `flow.export`,
   `flow.inspectImport`, `flow.import`, `flow.duplicate`. Router tests cover the
   authorisation boundary on each: owner-or-admin, using the existing procedure
   helpers — **no new `PermissionKey`** (ADR-049 §9).

10. **Web — UI.** Import dialog: file picker → inspection panel (flow name,
    description, node count, asset list, resolved/unresolved dependency table) →
    commit. Export and Duplicate on flow rows; Export on the canvas toolbar.
    Warning badges on nodes carrying `unresolvedDependencies`. Component tests
    for the panel and the badge.

11. **E2E — one spec.** `flow-portability.spec.ts`: export a flow and assert the
    download; upload that archive and assert the inspection panel, then commit.
    This is the only part of the feature that earns a browser
    (`docs/guides/e2e-test-policy.md` group 3 — file upload and download).
    Everything else stays at the layer that owns it. No `test.skip()` on a
    condition the spec itself probes; no `isVisible()` for control flow.

12. **Version + validate.** Set `VERSION` and root `package.json#version` to
    **0.30.0**. Run `./validate.sh`; fix all failures. Move this doc to
    `docs/development/implemented/alpha-3/v0.30.0/` with an implementation
    summary.

## 7. Acceptance criteria

Mirror PRD §10. In particular:

- [ ] Export produces a `.zip` of `manifest.json` + `assets/`; the manifest
      validates and embeds `FlowSnapshot` verbatim.
- [ ] Every referenced template and context doc is bundled with a matching
      `sha256`.
- [ ] No instance data of any kind appears in an archive — asserted over the
      whole payload.
- [ ] Dependencies export by name — `app_skills.name`, and the server's
      `admin_mcp_servers.label` plus `toolName`. No local skill or MCP server id
      appears in a manifest.
- [ ] An ambiguous match (two skills of one name, two servers of one label) is
      reported unresolved with both candidates named — never auto-resolved.
- [ ] `inspectFlowImport` writes no row and no object.
- [ ] Unresolved dependencies import as a flagged draft — `unresolvedDependencies`
      on the affected node configs — and `PublishFlowVersion` refuses such a flow
      with a `VALIDATION_FAILED` naming them.
- [ ] Import always creates a new flow; no existing flow is ever modified.
- [ ] Node ids are regenerated, edges rewritten, none orphaned.
- [ ] **Zip-slip is impossible** — a `../` entry is rejected, and no archive path
      is used as a write path.
- [ ] Size, count and per-asset ceilings are enforced before extraction: 50 MB
      compressed (at the upload route), 200 MB uncompressed, 100 assets, 25 MB
      per asset.
- [ ] One zip-slip implementation exists, in `archives/zip-guards.ts`, used by
      both readers; `ZipIngestor`'s existing tests pass unchanged after the
      refactor.
- [ ] A newer `formatVersion` is refused naming both versions; an older supported
      one migrates forward.
- [ ] Malformed zip, missing manifest and invalid manifest each return an
      actionable Result error — never a throw across a boundary.
- [ ] Export is owner/admin only and audited; import is audited.
- [ ] Duplicate produces an independent copy with its own assets.
- [ ] Round trip into a clean deployment with the same skills and MCP servers
      yields an equivalent snapshot modulo regenerated ids.
- [ ] One Playwright spec covers export download and import upload; no other e2e
      spec is added.
- [ ] PizZip appears only in `packages/adapters`; ports in `domain`; Result at
      every boundary; `VERSION` = `package.json#version` = `0.30.0`;
      `./validate.sh` passes.

## 8. Risks / decisions

Carried from PRD §12. The four questions PRD §12 left open were closed at
`/doc-review` and are marked **Decided** below — nothing here is still a
question at build time.

- **Import is the largest untrusted-input surface in the product.** Zip-slip,
  decompression bombs, oversized assets and manifest drift. ADR-049 §7 is the
  mitigation and its guards are acceptance criteria above, not implementation
  detail.
- **Export is a new exfiltration path** — prompt IP, skills and whole context
  documents in one click. **Decided**: owner/admin plus an audit event, no new
  `PermissionKey`; a distinct export permission is future work (PRD §11).
- **`formatVersion` discipline** — the refuse-newer policy only works if the
  version is incremented honestly and read-side migrations are maintained from
  the first release.
- **Asset size** — **Decided**: buffer both sides and bound it with the ceilings
  in step 5b, rather than reworking `IObjectStorage.get` (buffer-only) for
  streaming. Residual risk is roughly one uncompressed archive in memory per
  concurrent import; if that bites, the ceilings move to `runtime-config-store`
  next to the existing archive-intake limits before the port changes.
- **Name collisions** — neither `app_skills.name` nor `admin_mcp_servers.label`
  has a unique constraint, so ambiguity is a live deployment state.
  **Decided**: never auto-resolve — report unresolved with the candidates named
  (step 6d). A heuristic like "most recently updated" wires a step to the wrong
  tool in a way nobody audits later.
- **Zip library** — **Decided**: PizZip, already in `packages/adapters` and
  already used by `ZipIngestor`. Still re-read its API in `node_modules` at
  step 5b; the write path is new to this repo.
- **A second zip reader** — `IArchiveExtractor` cannot be reused (it drops
  `manifest.json` and `.xlsx` on MIME sniffing), so a second reader exists. The
  guards are shared via `zip-guards.ts` so there is still only one zip-slip
  implementation; the risk is that a later change touches one reader and not the
  shared module.
- **Duplicate copies assets** rather than sharing keys, so storage grows per
  duplicate. Accepted: shared keys would let one flow's template deletion corrupt
  another's.

## 9. Approved change summary

Recorded per the `/new-feature` lifecycle; approved 2026-08-11.

**Headline.** A flow's definition exports as a portable `.zip` — a JSON manifest
plus the uploaded templates and context documents — then imports into another
deployment or clones in place. The manifest reuses the existing `FlowSnapshot`
shape (ADR-015), so the serialisation already exists and is already proven by
versioning. Import is inspect-then-commit: the archive is opened and reported on
— what resolves, what does not — before a single row is written.

- **Goal** — staging-to-production promotion, shippable starter flows, in-place
  duplication, and a flow definition reviewable outside the database.
- **Business rules** — definition only, never instance data; references export by
  stable name; unresolved references degrade to a flagged draft; import always
  creates a new draft flow owned by the importer; node ids regenerated and edges
  rewritten.
- **UI** — Export/Duplicate on flow rows and the canvas; an Import dialog whose
  inspection panel precedes any write; warning badges on unresolved nodes.
- **Data** — `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`,
  `FlowImportInspection`, `IFlowArchiveReader` / `IFlowArchiveWriter`, and
  `unresolvedDependencies` on node config (jsonb).
- **Database** — none.
- **Risks** — untrusted-archive handling (zip-slip, bombs, drift); export as an
  exfiltration path; `formatVersion` discipline; asset size; name collisions.
- **Out of scope** — merging into an existing flow, a marketplace, instance data,
  signed archives, a separate export permission, end-to-end streaming.

**Amended at `/doc-review` (2026-08-17).** Version fixed at 0.30.0 on `main`
(docs to `implemented/alpha-3/`); the `kb_collection` dependency kind removed (no such concept
exists); MCP identity corrected to the server `label`; ambiguous matches decided
as unresolved-not-guessed; the unresolved flag given a home and a publish gate;
ceilings given numbers and buffering accepted in place of streaming; PizZip
confirmed as the library with its guards shared with `ZipIngestor`; one
Playwright spec added under e2e policy group 3.

## 10. Approved build summary

Approved at `/build`, 2026-08-17. Base `main`, target **0.30.0**, docs to
`implemented/alpha-3/v0.30.0/`.

**Headline.** A flow's definition becomes a portable `.zip` — `manifest.json`
wrapping `FlowSnapshot` verbatim, plus an `assets/` directory of uploaded
templates and context documents. Export from the flow list or the canvas; import
into any other deployment, where the archive is opened, validated and reported on
before a single row is written, then committed as a new draft flow owned by the
importer. Skills and MCP tools travel by name and resolve against the
destination; what does not resolve lands as a flagged node that blocks publish
rather than a silent gap. Duplicate is the same machinery without the file
round-trip.

- **Goal** — staging-to-production promotion, shippable starter flows, in-place
  duplication, a definition reviewable outside the database, and export as an
  audited event.
- **Business rules** — definition only, never instance data; references export by
  name and an ambiguous match is never guessed; unresolved dependencies block
  publish but not import; import always creates a new draft flow; the archive is
  untrusted input throughout.
- **UI** — Export/Duplicate on flow rows, Import on the list header, Export on
  the canvas toolbar; an import dialog whose inspection panel precedes any write;
  warning badges on flagged nodes; publish errors naming what is unresolved.
- **Data** — `FlowExportManifest`, `FlowExportAsset`, `FlowExportDependency`,
  `FlowImportInspection`, `IFlowArchiveReader`/`IFlowArchiveWriter`, and
  `unresolvedDependencies` on node config. `FlowSnapshot` and `IObjectStorage`
  unchanged.
- **Database** — none. No migration, no `-- data-impact:` line.
- **Tests** — test file before implementation file at every layer; one Playwright
  spec (`flow-portability.spec.ts`) under e2e policy group 3, file upload and
  download; nothing else in the feature qualifies.
- **Risks** — untrusted-archive handling; refactoring the security-critical
  `ZipIngestor` onto shared guards; buffered assets bounded only by the ceilings;
  export as an exfiltration path.
- **Out of scope** — merging into an existing flow, a marketplace, signed
  archives, instance data, exporting a specific published version, a distinct
  export permission, end-to-end streaming.

**Added at `/build` (not in §5–§7 above).** `ApprovalSubject`
(`{ kind: "step", nodeId }`) and `ChangesRequestedTarget`
(`{ kind: "step", nodeId }`) embed node ids *inside node config*. Regenerating
node ids without remapping them would leave an imported approval node pointing at
an id that does not exist, and a `changes_requested` decision would silently fall
back to `nearest_editable`. `rewriteSnapshot` remaps both, with a test asserting
it.
