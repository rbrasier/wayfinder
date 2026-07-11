# v2.4.7 — Group B slice 6a: the `TurnStreamWriter` port (write-side decoupling)

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group B** (streaming inside the `ILanguageModel` port), item 6 — first slice of
the `ExecuteTurn` extraction. **Bump**: PATCH (2.4.6 → 2.4.7). No schema change;
a new outbound port + its adapter + a behaviour-preserving rewire of the chat
stream write-side.

## Why this is slice "6a", not the whole extraction

The phase names item 6 (extract `ExecuteTurn` into the application layer, with
E14 falling out of it) **"the riskiest change — it rewrites the most-exercised
path,"** to be landed behind a real test net. Two facts shaped the approach:

1. **The e2e chat suite mocks `/api/chat/[id]/stream` at the HTTP boundary**
   (`tests/e2e/helpers/base.ts` → `mockInternalChatRoute`). In the default mock
   mode it never executes the real turn orchestration, so an e2e spec is **not**
   the safety net for this refactor — the deterministic unit tests around the
   helpers and gates are. (An e2e would only exercise the real path under
   `USE_REAL_AI=true`.)
2. Moving the ~280-line orchestration into `packages/application` is only sound
   once it depends on **ports**, not the Vercel AI SDK writer. Today the SDK
   coupling (`formatDataStreamPart`, `writeMessageAnnotation`, `DataStreamWriter`)
   is spread across `route.ts`, `stream-turn.ts`, and `turn-helpers.ts`.

So this slice does the **enabling, keystone step**: introduce the framework-free
`TurnStreamWriter` port and route every client write through it, leaving the
orchestration in place but now depending only on the port. The application-layer
move (`ExecuteTurn`) and E14 (repo-reach narrowing) follow in 6b/6c.

## Change

- **Domain port** (`packages/domain/src/ports/turn-stream-writer.ts`): new
  `TurnStreamWriter` interface with semantic operations only —
  `writeText(text)`, `endBubble()` (the finish_step bubble boundary), and
  `writeAnnotation(annotation)` — plus a `TurnStreamAnnotation` union
  (`confidence` | `cross-checking` | `generating-document`). Pure TypeScript,
  zero imports, so the future application-layer orchestration can depend on it.
- **Adapter** (`apps/web/.../stream/turn-stream-writer.ts`): `DataStreamTurnWriter`
  wraps the Vercel `DataStreamWriter` and is now the **only** file in the stream
  path that touches `formatDataStreamPart` — mapping `writeText`/`endBubble` onto
  text/finish_step parts and `writeAnnotation` onto `writeMessageAnnotation`.
- **Rewire** (`route.ts`, `stream-turn.ts`, `turn-helpers.ts`): the streaming
  pump, the cross-check pass note, the gap-followup boundary, the confidence /
  cross-checking / generating-document annotations, and the quota-block message
  all go through the port. `route.ts` constructs one `DataStreamTurnWriter` at
  the top of the stream and passes it down; it no longer imports
  `formatDataStreamPart`. The route-local `StreamTurnWriter` / `DataStreamPartWriter`
  ad-hoc interfaces and the `writeMessageBoundary` helper are deleted (their
  behaviour now lives on the port).

## Tests

- `turn-stream-writer.test.ts` (new): pins the wire format — `writeText` emits a
  text part, `endBubble` emits `finish_step {finishReason:"stop",
  isContinued:false}`, `writeAnnotation` forwards each typed annotation verbatim.
- `stream-turn.test.ts` / `turn-helpers.test.ts`: updated to the port shape.
  The seam assertions are preserved semantically — the gap-followup and the
  cross-check pass note still assert `endBubble` precedes their text (new bubble),
  and the streamed deltas are asserted via `writeText`.
- Full stream suite: **63 passing** (60 prior + 3 adapter). `./validate.sh` 19/19.

## Caching (item 4 re-verification)

The rewire touches only the **client write-side**. The model-call path —
`streamTurn`'s `messagesWithCachedSystem` with the Anthropic
`cacheControl: { type: "ephemeral" }` marker on the system message, and the
`ILanguageModel.streamObject` input — is byte-identical. The
"attaches an Anthropic cache_control marker" unit test still passes, so prompt
caching is structurally preserved; no paid real-AI re-probe was warranted for a
change that does not alter the model request.

## Next (still open under item 6)

- **6b**: move the turn orchestration out of `route.ts`'s inline `execute`
  callback into an `ExecuteTurn` use case that depends on `TurnStreamWriter` +
  the existing ports; the route shrinks to auth + lease claim/release + HTTP
  translation.
- **6c / E14**: narrow the route's remaining direct `container.repos.*` reach
  (claimTurn/heartbeatTurn/releaseTurn, users.findById, sessionUploads,
  sessionMessages) as the orchestration takes explicit port dependencies.
