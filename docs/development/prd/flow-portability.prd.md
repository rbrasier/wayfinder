# PRD — Flow Portability (Export / Import / Duplicate)

- **Status**: Draft
- **Date**: 2026-08-11
- **Author**: Solo / Claude Code
- **Target version**: **0.30.0** — **MINOR** (new feature, no schema change).
  Allocated at `/doc-review`; `main` sat at `0.28.4` and `0.29.0` is claimed on
  another branch. See §9.

## 1. Problem

A flow cannot leave the database it was authored in. There is no export, import,
clone or duplicate anywhere in the product.

A customer with a staging environment cannot promote a flow to production — they
rebuild it by hand on the production canvas and hope the two match. For the
regulated deployments this product targets, all of which have change control that
assumes artefacts move between environments, that is a procurement blocker rather
than an inconvenience.

Nothing can ship with the product either. Every install starts at a blank canvas
by design (`wayfinder.prd.md` §4), so the reference procurement flow exists only
as loose `.docx` files in `docs/templates/` and each new customer spends their
first day rebuilding it. And a flow cannot be backed up, diffed or reviewed
outside a database client.

## 2. Users / Personas

- **Admin / Platform Owner** — moves a flow from staging to production, and
  imports flows shipped with the product or shared by another team.
- **Business Analyst / Policy Owner (Flow Owner)** — duplicates an existing flow
  as a starting point rather than rebuilding it, and exports a flow for review or
  backup.
- **Auditor / Change Manager** — indirect. Needs a flow definition to exist as a
  reviewable artefact outside the running system, and needs export itself to be
  an audited event.

## 3. Goals

- An authorised user can **export** a flow as a single portable `.zip` containing
  its definition **and** its uploaded templates and context documents.
- An authorised user can **import** that archive into another deployment and get
  a working flow, in draft, without re-uploading anything.
- Import **inspects before it commits**: the user sees the flow's contents and a
  resolved/unresolved dependency report before any row is written.
- An archive with unresolved dependencies still imports, landing as draft with
  the gaps listed and the affected nodes flagged — never silently dropped.
- A flow can be **duplicated in place** without a file round-trip.
- Export never carries instance data — no sessions, messages, documents,
  approvals or step outputs, under any circumstances.

## 4. Non-goals

- **Updating or merging into an existing flow** from an archive. Import always
  creates a new flow.
- **A hosted template gallery or marketplace.** This PRD delivers the format and
  the two operations; distribution is a separate concern.
- **Exporting instance data** of any kind.
- **Knowledge-base collections.** The product has no collection concept — the
  `kb_` tables hold context-document content and chunks, and no node config
  references a collection. A flow's knowledge *is* its context documents, and
  those are bundled as assets. There is no `kb_collection` dependency kind.
- **Signing or verifying archives** (provenance, tamper-evidence).
- **Cross-version migration of flows authored on a newer deployment** beyond the
  refuse-and-report policy in §9.
- **Exporting extraction flows** is in scope only insofar as `FlowSnapshot`
  already carries `extraction`; no extraction-specific assets are bundled.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `FlowExportManifest` | `packages/domain/src/entities/flow-export.ts` | new | `{ formatVersion, exportedAt, exportedFrom, snapshot, dependencies, assets }`. |
| `FlowExportAsset` | `packages/domain/src/entities/flow-export.ts` | new | `{ id, kind: "template" \| "context_doc", path, filename, mimeType, sizeBytes, sha256 }`. |
| `FlowExportDependency` | `packages/domain/src/entities/flow-export.ts` | new | `{ kind: "skill" \| "mcp_tool", name, toolName?, nodeIds }`. For `mcp_tool`, `name` is the server's `label` — see §9. |
| `FlowImportInspection` | `packages/domain/src/entities/flow-export.ts` | new | `{ manifest, resolved, unresolved, assetCount, warnings }`. |
| `IFlowArchiveReader` / `IFlowArchiveWriter` | `packages/domain/src/ports/flow-archive.ts` | new | Ports; the zip library lives in adapters only. |
| `FlowSnapshot` | `packages/domain/src/entities/flow-version.ts` | existing | Embedded verbatim. Reused, not reimplemented — see ADR-049 §2. |
| `IObjectStorage` | `packages/domain/src/ports/object-storage.ts` | existing | Reads assets on export, writes them under fresh keys on import. Unchanged: `get` returns a whole `Buffer`, so both sides buffer — the ceilings in §10 are what bounds peak memory. |
| `IAuditLogger` | existing | existing | Export emits `flow.exported`; import emits `flow.imported`. |

## 6. User stories

1. As an **admin**, I export a flow from staging and import it into production,
   and the templates come with it.
2. As an **admin**, I choose an archive to import and see its flow name, step
   count, bundled assets and which skills and MCP tools will not resolve here —
   before anything is written.
3. As an **admin**, I import an archive that references an MCP server this
   deployment lacks, and get the flow as a draft with that node flagged, rather
   than a refusal or a silent gap.
4. As a **flow owner**, I duplicate a flow to use as the starting point for a new
   one, without exporting and re-importing.
5. As a **flow owner**, I export a flow to attach to a change request, so the
   definition is reviewable outside the system.
6. As an **auditor**, I can see in the audit log who exported which flow and
   when.

## 7. Pages / surfaces affected

- `/admin/flows` and `/flows` — **Import** action; **Export** and **Duplicate**
  on each row.
- `/admin/flows/[id]` and `/flows/[id]/config` — **Export** on the canvas
  toolbar.
- **Flow Import dialog** (new) — file picker, then an inspection panel: flow
  name, description, node count, bundled asset list, and a dependency table
  splitting resolved from unresolved. Commit and Cancel.
- Canvas — imported nodes with unresolved dependencies carry a warning badge.
- tRPC: `flow.export`, `flow.inspectImport`, `flow.import`, `flow.duplicate` —
  all new, all permission-gated.
- Route handlers for the archive download and upload (binary payloads do not go
  through tRPC).

## 8. Database changes

**None.**

Export reads `app_flows`, `app_flow_nodes`, `app_flow_edges` (or an
`app_flow_versions` snapshot) and object storage. Import writes ordinary rows
through the existing repositories and stores assets under freshly generated
object-storage keys.

## 9. Architectural decisions

- **Introduces ADR-049** — the archive format and the import contract: a zip
  around the existing `FlowSnapshot`; dependencies exported by stable name;
  unresolved dependencies degrade to a flagged draft; inspect-then-commit; new
  flow always; the untrusted-input guards; and the `formatVersion` policy.
- **Assumes ADR-015** *(Flow Versioning via Immutable Snapshots)* for the
  serialisation, **ADR-033** *(Immutable Audit Log & Legal Hold)* for the export
  event, and **ADR-018** *(Approval Step and Approver Resolution)* for approval
  nodes — already portable, since `ApproverSourceMode` bakes in no user id.
  ADRs are cited by title here because 015, 031, 032 and 033 each carry more
  than one document; the skills-library and MCP decisions the code cites as
  "ADR-031" / "ADR-032" have no matching ADR file, so this PRD relies on the
  code (`entities/skill.ts`, `entities/mcp-server.ts`) rather than a number.
- **Identity of an exported reference**: skills resolve on `app_skills.name`,
  MCP tools on `admin_mcp_servers.label` plus `McpToolRef.toolName`. Neither
  column is unique, so resolution can be ambiguous; see §10 for the decided
  behaviour.
- **Branch and version**: standard routing per `CLAUDE.md` — new features land on
  **`main`**, the next release line. Target version **0.30.0**; implemented docs
  land in `docs/development/implemented/alpha-3/v0.30.0/`, the line `CLAUDE.md`
  names for `main`.

## 10. Acceptance criteria

- [ ] Export produces a `.zip` containing `manifest.json` and an `assets/`
      directory; the manifest validates against the `FlowExportManifest` schema.
- [ ] The manifest embeds `FlowSnapshot` **verbatim** — a field added to a node
      config travels with no change to this feature.
- [ ] Every uploaded `.docx`/`.xlsx` template and every context document
      referenced by the flow is present in `assets/` with a matching `sha256`.
- [ ] The archive contains **no** session, message, document, approval or
      step-output data — asserted by a test over the archive's contents.
- [ ] `skillRefs` export as `app_skills.name` and `McpToolRef` as the server's
      `admin_mcp_servers.label` plus `toolName`; no `app_skills` id and no
      `admin_mcp_servers` id appears in the manifest.
- [ ] A dependency matching **more than one** local skill name, or more than one
      server label, is **not auto-resolved**: it is reported as unresolved with a
      warning naming the candidates, and the node is flagged. Guessing wires a
      flow to the wrong tool silently, which is the one outcome this format
      refuses.
- [ ] `inspectFlowImport` returns the inspection **without writing any row or
      object** — asserted by a test that counts rows before and after.
- [ ] Import resolves dependencies by name, rewrites node config to local ids,
      and lists what did not resolve.
- [ ] An archive with unresolved dependencies imports as `draft`, with the
      affected nodes flagged and the flow not publishable until resolved. The
      flag is a node-config field (`unresolvedDependencies?: FlowExportDependency[]`,
      jsonb — no migration), and `PublishFlowVersion` refuses a flow whose live
      nodes still carry one, with a `VALIDATION_FAILED` naming them. Without
      that gate the criterion is a claim with no enforcement.
- [ ] An imported flow is always new, owned by the importer, and `draft`; no
      existing flow is modified by any import.
- [ ] Node ids are regenerated and every edge is rewritten against the new ids;
      no edge is orphaned.
- [ ] **Zip-slip is impossible**: no path from the archive is used as a write
      path; assets are re-keyed by the importer. Asserted by a test with a
      malicious `../` entry.
- [ ] Archive size, uncompressed size, asset count and per-asset size ceilings
      are enforced **before** extraction; exceeding any returns
      `VALIDATION_FAILED`. Defaults: **50 MB** compressed (rejected at the upload
      route, before the reader is called), **200 MB** uncompressed, **100**
      assets, **25 MB** per asset — the last matching the extraction intake's
      existing per-entry cap. These bound peak memory, which is what makes
      buffering acceptable in place of streaming.
- [ ] An asset whose `sha256` does not match fails the import; the bytes are not
      stored.
- [ ] An archive whose `formatVersion` exceeds this deployment's support is
      refused with a message naming both versions; an older supported version is
      migrated forward on read.
- [ ] A malformed zip, a missing manifest and a manifest failing schema
      validation each return a Result error with an actionable message — never a
      throw across a boundary.
- [ ] Export is restricted to the flow owner or an admin and emits
      `flow.exported` to `core_audit_log`; import emits `flow.imported`. **No new
      `PermissionKey` is added** — the registry is developer-owned and a key with
      no distinct enforcement is meaningless (ADR-021). Splitting export from
      flow edit is future work, recorded in §11.
- [ ] A Playwright spec covers the export download and the import upload. This
      is group 3 of `docs/guides/e2e-test-policy.md` — "file upload and download
      … exports" — and is the only part of this feature that qualifies;
      everything else is tested at the layer that owns it.
- [ ] Duplicate produces an independent draft copy with a suffixed name, its own
      node ids, and its own copies of the assets.
- [ ] Round trip: export a flow, import it into a clean deployment with the same
      skills and MCP servers registered, and the imported flow's snapshot is
      equivalent to the original's modulo regenerated ids.
- [ ] Architecture boundaries intact — the zip library appears only in
      `packages/adapters`; ports in `domain`; Result at every boundary.
      `VERSION` matches `package.json#version`; `./validate.sh` passes.

## 11. Out of scope / future work

- A starter-flow pack shipped with the product, and the AU Gov procurement flow
  as its first member — this PRD makes it possible; packaging it is separate.
- Import that updates an existing flow, with a diff and a merge decision.
- A template gallery or marketplace, hosted or in-app.
- Signed archives and provenance verification.
- A dedicated export permission, distinct from flow edit.
- Streaming assets end-to-end. `IObjectStorage.get` returns a whole `Buffer`;
  adding a streaming method would ripple through the MinIO adapter and every
  caller, for a payload the §10 ceilings already bound.
- Exporting a *specific* published version rather than the current definition.
- Bulk export/import of every flow in a deployment.

## 12. Risks / open questions

- **Import is the largest untrusted-input surface in the product.** Zip-slip,
  decompression bombs, oversized assets and manifest drift are all live risks.
  ADR-049 §7 is the mitigation and its guards are acceptance criteria above, not
  implementation detail.
- **Export is an exfiltration path that did not previously exist.** A single
  click removes prompt IP, applied skills and whole context documents. Gating to
  owner/admin plus auditing narrows it; it does not close it. **Decided**: no
  separate permission in this release (§10); revisit if a customer needs to let
  someone edit a flow without being able to remove it from the building.
- **`formatVersion` discipline.** The refuse-newer policy only works if the
  version is incremented honestly and the read-side migrations are maintained
  from the first release.
- **Asset size.** A flow with a large context-document corpus produces a large
  archive. **Decided**: buffer both sides, bounded by the §10 ceilings, rather
  than reworking `IObjectStorage` for streaming. The residual risk is a peak of
  roughly one archive's uncompressed size per concurrent import; if that proves
  too coarse, the ceilings move to `runtime-config-store` alongside the existing
  archive-intake limits before the port changes.
- **Name collisions on resolution.** Neither `app_skills.name` nor
  `admin_mcp_servers.label` carries a unique constraint, so ambiguity is
  possible today, not hypothetical. **Decided**: never auto-resolve an ambiguous
  match — report it as unresolved with the candidates named (§10). This is the
  same "degrade loudly" rule as an absent dependency, and it keeps the resolver
  free of a heuristic nobody can audit later.
- **Zip library.** **Decided**: PizZip, already a dependency of
  `packages/adapters` and already driving `ZipIngestor`. Its real API must still
  be re-read in `node_modules` at build time (`CLAUDE.md` forbids working from
  training data) — in particular the generate/write path, which this repo does
  not yet exercise for archive output.
- **Duplicate and asset copies.** Duplicating a flow copies its assets rather
  than sharing keys, so storage grows per duplicate. Accepted: shared keys would
  make one flow's template deletion corrupt another's.
