# ADR-007 — Session-Scoped LangGraph (FlowSessionGraph)

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Each Wayfinder session is a stateful multi-turn conversation:

- It tracks which step (node) is current.
- It builds confidence over multiple user messages before advancing.
- It selects a branch when a node has multiple outgoing edges.
- It triggers document generation when a step completes with a template.
- It must survive a server restart.

ADR-004 already establishes that LangGraph lives in `packages/adapters` behind
an `IAgentRunner` port, and that the template ships a single-node passthrough
graph. Wayfinder needs the real thing: a per-session graph derived from the
flow's nodes and edges.

## Decision

Introduce `FlowSessionGraph` in `packages/adapters/src/agents/`. It implements
a new domain port, `ISessionAgent`, that sits alongside `IAgentRunner`
(passthrough demo) and `ILanguageModel` (raw LLM calls).

```ts
// packages/domain/src/ports/session-agent.ts
interface ISessionAgent {
  start(input: StartSessionInput): Promise<Result<SessionTurn>>;
  turn(input: TurnInput): Promise<Result<SessionTurn>>;
}

interface SessionTurn {
  assistantMessage: string;          // streamed in the route, but the port returns the final
  confidence: ConfidenceScore;       // { score, missingInformation, readyToAdvance }
  advanced: boolean;                 // true if step completed on this turn
  newNodeId: string | null;          // populated when advanced
  documentToGenerate: DocumentSpec | null; // populated when completed step has a template
}
```

Streaming is handled by the route handler, not the port: the port returns the
final state. The streaming layer (`useChat` + `streamText`) co-exists with
the port — the route handler calls the LLM directly for the streamed text and
the port for state updates. Two-call design is intentional:

1. The token stream goes straight to the client without round-tripping through
   the port (avoids buffering).
2. The structured `confidence` and advance decision are produced by a parallel
   `streamObject` and persisted via the port.

### Graph construction

When a session starts:

1. Load `app_flows`, `app_flow_nodes`, `app_flow_edges`, and
   `app_flow_context_docs` for the flow.
2. Build a LangGraph state graph where each FlowNode becomes a LangGraph node.
3. Edges in the FlowNode graph become conditional LangGraph edges with the
   advance predicate: `confidence.score >= node.config.advance_confidence_threshold && confidence.readyToAdvance`.
4. Compile the graph; cache the compiled instance in-memory keyed by
   `(flowId, flowVersionHash)` so two sessions on the same flow share the
   compiled artefact.

### State persistence

LangGraph state is persisted to `app_sessions.graph_checkpoint` (jsonb) after
every turn. The checkpoint contains:

- `currentNodeId`
- `gatheredContext` — accumulated per-node summary used as input to the next
  node's system prompt
- `confidenceByNode` — last confidence reading for each node visited

Message history is **not** in the checkpoint. It lives in
`app_session_messages` and is loaded separately on resume — this keeps the
checkpoint small and bounded.

### Branching

When a node has multiple outgoing edges, the AI is asked to pick a branch as
part of the `streamObject` schema:

```ts
const turnSchema = z.object({
  confidence: z.object({ score: z.number().min(0).max(100), readyToAdvance: z.boolean(), missingInformation: z.array(z.string()) }),
  branchChoice: z.string().nullable(), // node id of the chosen branch, null if not branching
});
```

If `branchChoice` is null but there are multiple outgoing edges, the graph
does not advance (waits for the next turn). The "Determine Type" node in the
procurement flow is the worked example — it has 5 outgoing branches.

### Why session-scoped, not flow-scoped?

A LangGraph graph is compiled once per `(flow, flowVersionHash)` and shared.
"Session-scoped" refers to the running state (checkpoint + message history),
not the compiled graph object. The compiled graph is purely a function of
the flow config and is safe to share across sessions on the same flow.

## Consequences

**Positive**

- Sessions survive server restart (checkpoint is in Postgres).
- Branching is handled in the graph, not in ad-hoc application code.
- Adding `auto-node` in Phase 5 means adding a new LangGraph node type to
  the builder — the port shape stays the same.

**Negative**

- Two LLM calls per turn (text stream + structured confidence). Mitigation:
  fire in parallel; render the text stream immediately; show "evaluating…" on
  the confidence bar until the structured call resolves. Cost: ~1.3x per turn.
- `graph_checkpoint` jsonb can grow if `gatheredContext` is not bounded. The
  adapter caps each node's gathered context to 4000 characters and stores
  full content only in `app_session_messages`.

## Enforcement (relation to ADR-004)

- `ISessionAgent` lives in `packages/domain`, alongside `IAgentRunner`. The
  application layer imports `ISessionAgent` only.
- `FlowSessionGraph` in `packages/adapters` imports `@langchain/langgraph`.
  Application code does not.
- The existing `IAgentRunner` passthrough demo is retained — it's used by
  the `/sample` page and is not affected by Wayfinder.

## Open question

Should `gatheredContext` be regenerated on resume (in case a flow's AI
instructions changed between session pause and resume) or trusted from the
checkpoint? Default: trust the checkpoint. Flow edits to a published flow
require an explicit re-publish that bumps `flowVersionHash`; the
`flowVersionHash` mismatch between session and current flow is detected on
load and surfaces a "Flow changed — start a new session?" prompt. Implementing
this prompt is Phase 4 polish.
