# Enhancement — MCP Internal/External Server Governance (v2.5.0)

**Status:** Implemented
**Version:** 2.5.0 (MINOR — new column + migration `0031`)
**Addresses:** Richard's review on fork PR #132 (item #1b — write-action governance)

> The product owner's governance model for MCP, a deliberately simpler answer to
> Richard's Context/Actions + per-action human-in-the-loop request. Rather than
> classifying every tool and confirming each write, we classify the **server**
> and lean on the governance Wayfinder already has.

## Model

An admin (the only role that can register MCP servers) sets one classification
per server: **"Permitted to communicate outside Wayfinder."**

- **Internal (default, off)** — self-contained utilities such as spellcheck and
  calculation. These are the target of adding MCP at this stage. They are
  offered to flow authors and run synchronously; the **existing human review of
  the generated document is the governance** — no separate per-action
  confirmation step.
- **External (on)** — integrations that talk to systems outside Wayfinder. They
  can be registered (and are visible/testable in the admin registry), but are
  **not selectable in flows** yet. Integration-grade governance is future work.

## Enforcement (defence in depth)

- **Registry UI** (`/admin/mcp-servers`) — a "Permitted to communicate outside
  Wayfinder" checkbox on register; a Scope column (Internal/External badge).
- **Flow picker** — `McpServerDirectory.listServersWithTools` returns only
  internal servers, so external ones never appear as options in a flow.
- **Turn resolution** — `ResolveStepTools` drops any `allowedMcpToolRef` whose
  server is external (covers a server reclassified after a flow was authored).
- **Node runtime** — `RunMcpNode` refuses to call an external server with a
  typed `VALIDATION_FAILED`.

## Files

- domain: `entities/mcp-server.ts` (`communicatesExternally`)
- adapters: `db/schema/admin.ts` (`communicates_externally` column),
  `repositories/drizzle-mcp-server-repository.ts`,
  `mcp/mcp-server-directory.ts` (internal-only filter),
  migration `0031_lyrical_rockslide.sql`
- application: `use-cases/mcp/mcp.ts` (register/update + `ResolveStepTools`
  filter), `use-cases/session/run-mcp-node.ts` (runtime backstop)
- web: `server/routers/mcp-server.ts`, `app/(admin)/admin/mcp-servers/_content.tsx`
- tests: `ResolveStepTools` external-drop, `RunMcpNode` external-refusal
- e2e: `tests/e2e/enhance-mcp-internal-external.spec.ts`

## Relationship to Richard's #1b

This **closes #1b** with the product owner's chosen model: internal tools rely on
document review (sufficient, per the owner); external integrations are held back
rather than gated with a per-action confirm dialog. The fork's
`kind`/`prepare-mcp-node`/`confirm-mcp-node` machinery is therefore **not**
ported.

## Verification

- Unit (green): `ResolveStepTools` drops external servers; `RunMcpNode` refuses
  external; existing MCP/transport suites still pass.
- Web typechecks clean; jsx-a11y strict passes.
- Migration `0031` adds one boolean column, default false (existing rows stay
  internal). Run `pnpm db:migrate`.

## Version

MINOR: `2.4.1 → 2.5.0` (schema change, migration `0031`).
