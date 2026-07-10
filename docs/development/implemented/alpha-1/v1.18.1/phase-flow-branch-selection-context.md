# Phase: Richer Context for Flow Branch Selection

**Version:** 1.18.1 (PATCH)
**Status:** Planned
**Type:** Enhancement

## Problem

When a conversational step completes and the current node has more than one
outgoing edge, the system makes a separate AI call to pick which branch to take
(`buildBranchChoicePrompt` → `branchChoiceSchema`). Today that call is given
almost no information about the branches: each candidate is reduced to its node
`id` and `name` only.

```
Available branches:
- node-a (Approve)
- node-b (Escalate)
```

The model has the full conversation but must infer what each branch *means* and
when it applies purely from a one- or two-word label. Every node already stores
a `doneWhen` (completion criteria) and `aiInstruction`/`instruction` in its
config — that information is available but is not passed into the branch call.

## Scope

Two changes, both using data that already exists. No DB or UI changes.

1. **Branch purpose** — pass each candidate branch's purpose (its `doneWhen`,
   falling back to `aiInstruction`, then `instruction`) into the branch-choice
   prompt so the model knows what each branch is for.
2. **Selection rationale** — add a `rationale` field to `branchChoiceSchema`,
   ordered before `branchChoice`, so the model reasons before committing. This
   improves selection quality and yields an auditable reason.

Out of scope: author-defined per-edge conditions (would require a schema
migration and flow-builder UI), and persisting the rationale into
`graphCheckpoint` (can be a later enhancement).

## Approach

- Widen `BuildBranchChoicePromptInput.branchNodes` to carry an optional
  `purpose` string.
- In the chat stream route, populate `purpose` from the node config when
  assembling `branchNodes`.
- Render `purpose` in `buildBranchChoicePrompt`, gracefully omitting it when
  absent.
- Add `rationale` to `branchChoiceSchema`. The route already discards
  everything except `branchChoice`, so no consumer changes are required.

## Files Touched

- `packages/domain/src/ports/session-agent.ts` — add optional `purpose` to
  `branchNodes`.
- `packages/shared/src/schemas/confidence.ts` — add `rationale` to
  `branchChoiceSchema`.
- `packages/adapters/src/agents/flow-session-graph.ts` — render branch purpose.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — map `purpose` from
  node config.

## Tests

Written before implementation:

- `flow-session-graph` branch-prompt test: asserts each branch's purpose text
  appears in the prompt, and that the prompt is well-formed when `purpose` is
  absent.
- `confidence` schema test: `branchChoiceSchema` parses an object containing
  both `rationale` and `branchChoice`.

## Version Bump

PATCH: 1.18.0 → 1.18.1. No schema impact, no new feature surface, no breaking
changes.
