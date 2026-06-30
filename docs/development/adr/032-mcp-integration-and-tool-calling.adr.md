# ADR-032 — MCP Integration and Tool-Calling Architecture

- **Status**: Proposed
- **Date**: 2026-06-30
- **Relates to**: Flow Skills & MCP PRD, ADR-031 (runtime skills),
  ADR-010/ADR-013 (external workflow integration / auto-node structured data),
  ADR-020 (reuse of `session_step_outputs`), ADR-016 (prompt structure),
  ADR-026/027 (usage governance)

## Context

Wayfinder steps can talk to the user (`conversational`) or call a pre-registered
n8n webhook (`auto`). They cannot reach the growing ecosystem of tools exposed via
the **Model Context Protocol (MCP)**. We want two things:

1. A deterministic step that calls one MCP tool (like the auto-node, but MCP).
2. A conversational step that can call MCP tools mid-conversation, bounded by what
   a skill's `allowed-tools` permits (ADR-031).

Two hard constraints frame the decision:

- **Architecture rules.** `packages/domain` has zero external deps;
  `packages/application` imports only domain + shared (no SDKs); SDKs live in
  `packages/adapters`. So any MCP client SDK and any tool-calling SDK feature must
  live in adapters, behind domain ports.
- **The conversational turn is a single structured generation today.**
  `buildSystemPrompt` → `generateObject`/`streamObject` emits
  `{response, rationale, stepCompleteConfidence, contextGathered}`. `ILanguageModel`
  has no tool-calling surface. Introducing tools must not break that contract or
  the confidence/auto-advance semantics.

## Decision

### 1. Remote-only, admin-registered MCP servers

The hosted multi-tenant runtime talks only to **remote** MCP servers over
HTTP/SSE. Local/stdio (process-spawning) transports are out of scope — they are a
sandbox-escape and operability risk in a shared container.

Registration is an **admin** action, mirroring the n8n governance model:

- `admin_mcp_servers` — `label`, `transport` (`http` | `sse`), `url`,
  `auth_kind`, `credential_ref`, `status`.
- `admin_mcp_tools` (optional cache) — discovered tool schemas per server,
  refreshable; the flow editor reads this, falling back to a live `listTools`.

Flow authors **select** from registered servers; they never see credentials and
never register servers themselves.

### 2. Ports in domain, SDK in adapters

- `IMcpClient` (domain port) — `listTools(server)` and
  `callTool(server, name, args)`, both `Result`-typed. No SDK types leak across.
- `IMcpServerDirectory` (domain port) — lists servers + tools for the editor,
  directly analogous to `IN8nWorkflowDirectory`.
- `IMcpServerRepository` (domain port) — admin CRUD.
- The **MCP client adapter** (`packages/adapters/src/mcp/`) implements `IMcpClient`
  using the Vercel AI SDK MCP client (verify the exact API in `node_modules`
  before building — do not rely on training data). Credentials are resolved inside
  the adapter from `credential_ref`; the plaintext value never crosses a boundary.

### 3. Credentials are referenced, never stored or returned in the clear

`admin_mcp_servers.credential_ref` points at the secret store; the secret is
resolved only inside the MCP adapter at call time. No read endpoint returns it.
(Open question: which store backs the ref — see below.)

### 4. The deterministic `mcp` node reuses the existing executor path

Add `"mcp"` to `FlowNodeType` and an `McpNodeConfig` (`serverId`, `toolName`,
`requestFields` + `requestFieldValues` keyed by `FieldValueSource`,
`responseFields`). Implement `McpNodeExecutor implements INodeExecutor` and add it
to the `NodeExecutors` registry beside `n8n`/`mock`. It:

1. Resolves `requestFields` to tool arguments via the existing `FieldValueSource`
   machinery (same as the auto-node).
2. Calls `IMcpClient.callTool`.
3. Coerces the result into `responseFields` and persists them to
   `session_step_outputs` via the **existing** path (ADR-020) — no new persistence.

This keeps the deterministic case entirely within proven infrastructure. The
synchronous MCP call returns `completed` (or `failed`) directly — unlike n8n, there
is no inbound-webhook `pending` round-trip.

### 5. Tool-calling in conversational steps lives in a separate agentic runner — `ILanguageModel` is unchanged

This is the load-bearing choice. Two options were weighed:

- **(a) Extend `ILanguageModel`** with a tool-enabled generate. Rejected: it
  pushes tool-loop concerns into the port every provider implements and into the
  simple structured-turn fast path, for a feature only some steps use.
- **(b) A separate agentic runner in the agents adapter** owns the tool loop and
  the `IMcpClient`, and is invoked **only** when a conversational step has
  `allowedMcpToolRefs`. Chosen.

The runner (alongside `FlowSessionGraph`/`langgraph-agent-runner`) runs the
tool-call loop, then produces the **same**
`{response, rationale, stepCompleteConfidence, contextGathered}` structured output
the existing path returns — so confidence, auto-advance, and step-completion
semantics are untouched downstream. Steps without allowed tools keep using the
existing single-generation path with zero behavioural change.

Tool exposure is **deny-by-default**: the runner offers the model only the tools in
the node's `allowedMcpToolRefs`. A call to anything else is refused before any
network request. The editor pre-fills `allowedMcpToolRefs` from the applied
skills' `allowedTools` (ADR-031), but the node config — not the skill — is the
enforcement boundary.

### 6. Tool output is untrusted external data

MCP results entering the prompt are framed and isolated the way
`<reference_documents>` are (ADR-016): clearly delimited, never treated as
instructions. The agent is told tool output is data, not direction.

### 7. Audit and usage reuse existing infrastructure

Every tool call writes an `audit-logger` entry attributed to session/flow/user and
a usage record through the existing usage repository (so tool turns count toward
ADR-026/027 governance). No new ledger table (ADR-020 reasoning): introduce one
only if a concrete audit/retention requirement proves step/usage records
insufficient.

## Consequences

**Positive**

- Domain/application stay SDK-free; all MCP and tool-loop machinery is confined to
  adapters, satisfying the architecture rules and `validate.sh`.
- The deterministic `mcp` node is almost entirely existing infrastructure
  (executor registry + `FieldValueSource` + ADR-020 persistence).
- The simple conversational turn keeps its exact shape and cost profile; the tool
  loop is opt-in and isolated, limiting blast radius.
- Admin-only remote registration gives one governed, auditable egress surface.

**Negative**

- Two AI execution paths for conversational steps (with/without tools) to maintain.
  Mitigated by both emitting the identical structured contract.
- Synchronous MCP calls block the `mcp` step for the tool's duration; slow tools
  need timeouts and surface as failed steps (no async callback like n8n).
- Tool loops add latency and tokens; usage governance must account for them.
- Live tool discovery depends on server reachability; the `admin_mcp_tools` cache
  mitigates editor-time flakiness but can drift until refreshed.

## Open questions (resolve during build)

- **Secret store for `credential_ref`** — encrypted column vs. env-referenced
  secret vs. `system_setting`. Must guarantee no client exposure.
- **Tool-loop + streaming + structured output** — confirm via a spike that the
  chosen SDK can stream a tool-using turn and still yield the structured object.
- **Per-tool timeouts / retry** — defaults and whether they are admin-configurable
  per server.
- **`allowed-tools` resolution** — soft warning when a skill names an unregistered
  tool (ADR-031 leans soft); confirm the editor UX.
