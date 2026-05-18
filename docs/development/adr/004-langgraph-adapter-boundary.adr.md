# ADR-004 — LangGraph as an Adapter, Not a Domain Concept

- **Status**: Accepted
- **Date**: 2026-05-07

## Context

LangGraph.js is a powerful agent-orchestration library, but its API
(state graphs, `Annotation.Root`, `addEdge`, `compile`) is opinionated and
likely to evolve. If LangGraph types leaked into our use cases, every
breaking change in the LangGraph API would force a rewrite of the
application layer.

Other agent runtimes (CrewAI-style frameworks, Anthropic's "managed agents",
custom DAG runners, or no runtime at all) have similar shapes — a graph or
loop that consumes a prompt and produces an answer plus some trace
information.

## Decision

LangGraph lives **entirely** inside `packages/adapters/src/agents/` as one
implementation of the domain port `IAgentRunner`:

```ts
interface IAgentRunner {
  run(input: AgentInput, config?: AgentRunConfig): Promise<Result<AgentOutput>>;
}
```

`AgentInput`, `AgentOutput`, and `AgentRunConfig` are plain TypeScript
types in `packages/domain` that describe what the application needs from
*any* runtime, not just LangGraph.

The supplied `LangGraphAgentRunner` is a single-node passthrough graph. It
proves the wiring works end-to-end and gives us a place to add real nodes
when a real agent is needed.

## Consequences

**Positive**

- Application code can use agents without importing `@langchain/langgraph`.
- Swapping LangGraph for another orchestrator is one new file:
  `packages/adapters/src/agents/<other>-agent-runner.ts`.
- LangGraph version bumps are absorbed by a single adapter file.

**Negative**

- We don't expose LangGraph-specific features (checkpointing, parallel
  branches, human-in-the-loop) through the port. When we need them, we add
  them to `IAgentRunner` (or a sibling port) carefully — never as a
  LangGraph-typed leak.

## Enforcement

- ESLint blocks `@langchain/*` imports inside `packages/application/src/**`
  and `packages/domain/src/**`.
- Code review rejects any PR that adds LangGraph types to those packages.
