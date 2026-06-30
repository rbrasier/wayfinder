# PRD — Flow Skills & MCP Servers

- **Status**: Draft
- **Date**: 2026-06-30
- **Author**: John (john769160@gmail.com)
- **Target version**: 1.52.0 then 1.53.0 (bump: MINOR per phase — see `docs/guides/versioning.md`)

## 1. Problem

Flow authors can only steer a conversational step with free-text instructions
typed into the node. Reusable, battle-tested know-how authored elsewhere — a
`SKILL.md` found in another project or shared by a colleague — cannot be dropped
into a Wayfinder step. There is also no way for a step to *do* anything beyond
talk to the user or call a pre-registered n8n webhook: the AI cannot reach an
external system through a standard tool protocol. Both gaps push authors toward
copy-pasting prose and toward bespoke n8n workflows for things the wider
ecosystem already exposes as MCP tools.

## 2. Users / Personas

- **Flow author (ops/HR/procurement lead)** — wants to reuse a skill they found
  elsewhere in a step, and wants steps that can call external tools, without
  writing code.
- **Platform admin** — must govern which external MCP servers the platform may
  reach and with what credentials, the same way they govern n8n and HR data.
- **End-user operator** — runs the flow; benefits from more capable steps but
  should see no new configuration burden.

## 3. Goals

- A flow author can upload a `SKILL.md` and have its instructions apply to a
  conversational step — either from a reusable library or as a one-off on the step.
- The same skill can be referenced by many steps and versioned independently of
  any one flow.
- An admin can register remote MCP servers (HTTP/SSE) once, with stored
  credentials, and flow authors can use their tools without seeing secrets.
- A flow author can add a deterministic `mcp` step that calls one MCP tool with
  mapped inputs and captures the result as step output.
- A conversational step can call MCP tools mid-conversation, limited to the tools
  a skill's `allowed-tools` permits.
- Every MCP tool call is auditable and counts toward existing usage records.

## 4. Non-goals

- **Local/stdio MCP servers.** Hosted multi-tenant runtime only talks to remote
  (HTTP/SSE) servers (ADR-032). Process-spawning transports are explicitly out.
- **Author-supplied MCP servers per flow.** Registration is an admin action only.
- **Executing arbitrary scripts/code bundled in a skill.** A skill is parsed for
  frontmatter + markdown instructions and an `allowed-tools` declaration; any
  bundled scripts/assets are ignored at runtime (ADR-031).
- **MCP elicitation / sampling / server-initiated prompts.** Phase 1 of MCP uses
  request/response tool calls only.
- **A skill marketplace / sharing between tenants.** Upload only.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Skill` | `packages/domain/src/entities/skill.ts` | new | Parsed SKILL.md: name, description, frontmatter, body, `allowedTools`, version, status. |
| `ParsedSkill` (value) | `packages/domain/src/entities/skill.ts` | new | Result of parsing a raw SKILL.md before it becomes a stored `Skill` or inline config. |
| `McpServer` | `packages/domain/src/entities/mcp-server.ts` | new | Admin-registered remote server: label, transport, url, credential ref, status. |
| `McpTool` (value) | `packages/domain/src/entities/mcp-server.ts` | new | A discovered tool: name, description, JSON-schema input. Cached, refreshable. |
| `ConversationalNodeConfig` | `packages/domain/src/entities/flow-node.ts` | existing → extend | Add `skillRefs?: string[]`, `inlineSkill?: ParsedSkill`, `allowedMcpToolRefs?: McpToolRef[]`. |
| `FlowNodeType` | `packages/domain/src/entities/flow-node.ts` | existing → extend | Add `"mcp"`. |
| `McpNodeConfig` | `packages/domain/src/entities/flow-node.ts` | new | `serverId`, `toolName`, `requestFields` + `requestFieldValues`, `responseFields`. |
| `ISkillRepository` | `packages/domain/src/ports/skill-repository.ts` | new | CRUD + list for the library. |
| `IMcpServerRepository` | `packages/domain/src/ports/mcp-server-repository.ts` | new | CRUD + list for registered servers (admin). |
| `IMcpClient` | `packages/domain/src/ports/mcp-client.ts` | new | `listTools(server)` / `callTool(server, name, args)` — Result pattern. |
| `IMcpServerDirectory` | `packages/domain/src/ports/mcp-server-directory.ts` | new | Lists servers + their tools for the flow editor (mirrors `IN8nWorkflowDirectory`). |

## 6. User stories

1. As a flow author, I can upload a `SKILL.md` to my skill library and give it a
   name, so I can reuse it across flows.
2. As a flow author, I can attach one or more library skills to a conversational
   step, so the AI follows that skill's instructions.
3. As a flow author, I can paste/upload a one-off skill directly onto a single
   step without adding it to the library, so quick experiments stay local.
4. As an admin, I can register a remote MCP server with its URL and credentials,
   so the platform can reach its tools under governance.
5. As a flow author, I can add an `mcp` step, pick a server + tool, map inputs
   from earlier steps, and capture the output, so a step performs a concrete
   external action deterministically.
6. As a flow author, I can allow a conversational step to use specific MCP tools
   (typically the ones a skill declares), so the AI can act mid-conversation.
7. As an admin/auditor, I can see every MCP tool call attributed to a session,
   flow, and user, so external actions are traceable.

## 7. Pages / surfaces affected

- `/admin/skills` — new: skill library (upload, list, view, version, archive).
- `/admin/mcp-servers` — new: register/list/test/disable remote MCP servers.
- Conversational step editor — new: skill picker (library multi-select + inline
  upload) and an "allowed MCP tools" picker.
- Canvas — new `mcp` node type with its own editor (server + tool + field mapping),
  styled alongside the existing `auto` node.
- `apps/api` tRPC: `skill.*` (list/get/create/update/archive/parse),
  `mcpServer.*` (list/get/create/update/disable/test), `mcpDirectory.listTools`.
- Wiring: `apps/*/lib/container.ts` registers the new repositories, the MCP client
  adapter, the directory, and the `mcp` node executor.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_skills` | NEW — uploaded skills (name, description, frontmatter jsonb, body text, allowed_tools jsonb, version int, status) | yes (app_) |
| `admin_mcp_servers` | NEW — registered remote servers (label, transport, url, auth_kind, credential_ref, status) | yes (admin_) |
| `admin_mcp_tools` | NEW (optional cache) — discovered tool schemas per server (server_id, name, description, input_schema jsonb, last_synced_at) | yes (admin_) |

Node-config additions (`ConversationalNodeConfig`, new `McpNodeConfig`) live in the
existing `flow_nodes.config` jsonb column — **no migration**.

Credentials are **not** stored in plaintext: `credential_ref` points at the
existing system-secret mechanism; the value never leaves the adapter layer and is
never returned to the client. (See ADR-032 §Credentials — open question on the
secret store flagged in §12.)

Tool-call usage/audit reuses the existing `audit-logger` and usage repository —
**no new ledger table** (consistent with ADR-020's reuse-first stance).

## 9. Architectural decisions

- **ADR-031** — Runtime skills as injected step instructions (library + inline).
  Introduces the `Skill` entity, parsing rules, and the `<skills>` system-prompt
  block; establishes that bundled scripts are ignored and only frontmatter +
  body + `allowed-tools` are honoured.
- **ADR-032** — MCP integration: admin-registered remote servers, the `IMcpClient`
  port + adapter, governance mirroring the n8n directory, and the tool-calling
  architecture — a **separate agentic runner** in the agents adapter owns the
  conversational tool loop, leaving `ILanguageModel` unchanged; the `mcp` node
  uses the existing `INodeExecutor` path.
- Assumes ADR-013 (auto-node structured data) and ADR-020 (reuse of
  `session_step_outputs` for end-of-step metadata).

## 10. Acceptance criteria

- [ ] A valid `SKILL.md` uploaded to the library is parsed into name, description,
      body, and `allowedTools`; an invalid one returns a `DomainError`, not a throw.
- [ ] A conversational step with `skillRefs` renders each skill body inside a
      `<skills>` block in the system prompt, above per-turn retrieved chunks.
- [ ] An inline skill on a step applies without a library row existing.
- [ ] An admin can create, list, disable, and connection-test an MCP server;
      credentials are never returned by any read endpoint.
- [ ] `mcpDirectory.listTools` returns the tools of an enabled server (cached,
      refreshable), and an empty/typed error for a disabled or unreachable one.
- [ ] An `mcp` node maps `requestFields` via `FieldValueSource`, calls the tool,
      and persists `responseFields` to `session_step_outputs` via the existing path.
- [ ] A conversational step restricted to `allowedMcpToolRefs` can call only those
      tools; a tool not in the list is refused before any external call.
- [ ] Every tool call writes an audit entry attributed to session/flow/user and a
      usage record; failures are captured as a failed step/turn, never a throw
      across a boundary.
- [ ] `packages/domain` and `packages/application` gain no MCP/AI-SDK dependency
      (the MCP client lives in `packages/adapters`); `validate.sh` passes.

## 11. Out of scope / future work

- Local/stdio MCP transports.
- Per-flow or per-author server registration; org-scoped server visibility.
- MCP resources, prompts, elicitation, and sampling.
- A cross-tenant skill marketplace and skill dependency resolution.
- A dedicated tool-call ledger table (revisit only if audit/usage proves
  insufficient, per ADR-020 reasoning).

## 12. Risks / open questions

- **Tool-calling changes the conversational turn shape.** Today a turn is a single
  structured generation (`buildSystemPrompt` → `generateObject`/`streamObject`).
  A tool loop must preserve the `{response, confidence, contextGathered}` contract
  and confidence/auto-advance semantics. ADR-032 isolates this in a separate
  agentic runner to keep the simple path unchanged — needs a build-time spike to
  confirm streaming + structured output coexist with tool calls.
- **Credential storage.** Which secret store backs `credential_ref` — an encrypted
  column, env-referenced secret, or `system_setting`? Pick during ADR-032 build;
  must guarantee secrets never reach the client.
- **Untrusted tool output.** MCP tool results are external data entering the
  prompt; need framing/guarding so results can't redirect the agent (treat like
  `<reference_documents>`).
- **Cost/latency.** Tool loops and tool discovery add latency and tokens; ensure
  usage governance (ADR-026/027) counts tool turns.
- **Skill ↔ tool coupling.** A skill's `allowed-tools` names may not match any
  registered MCP tool. Decide whether that's a soft warning (skill still injects)
  or a hard block (ADR-031 leans soft: instructions inject; missing tools are
  surfaced in the editor, not fatal at runtime).
