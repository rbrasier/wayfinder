# Fix — chat replies print `\n` instead of breaking the line

## Symptom

An assistant reply reaches the chat bubble with the two-character escape sequence
`\n` printed as visible text, instead of the line break it stands for. Reported
sample, rendered exactly as shown:

```
Hi! Let's get the IT Equipment Request sorted for Joe Bloggs. We already have his
name carried over from the New Hire form. I just need two more things:\n\n1. What
type of equipment does Joe need - a Laptop, Desktop, or Mobile?\n2. Who is
requesting this equipment (your name, since you're processing this)?
```

Two things go wrong at once. The backslashes are visible, and — because the reply
arrives as one unbroken line — the numbered list never becomes a list either: the
lead-in and both questions run together in a single paragraph.

It is intermittent. The same step, on another turn, breaks its lines correctly.

## Reproduction

1. Open any session whose current step asks the user more than one thing at once
   (the `<constraints>` block invites the agent to "group closely related
   questions into a single message").
2. Send a message that leaves two fields outstanding.
3. Observe the reply. On an affected turn the bubble shows `\n` in the text, both
   while it streams and after it settles — the persisted message carries the same
   characters, so a page reload reproduces it from the database.

Parser-level reproduction, which is what the regression test pins:

```ts
parseMarkdownBlocks("I need two more things:\\n\\n1. What type?\\n2. Who is asking?")
// today  → one paragraph whose text contains literal backslashes
// wanted → a paragraph, then an ordered list of two items
```

## Root cause

The agent does not return prose. `FlowSessionGraph.buildSystemPrompt`
(`packages/adapters/src/agents/flow-session-graph.ts`) closes with an `<output>`
block requiring a JSON object, and the user-facing text is one field of it:

```
{
  "response": "Your conversational reply to the user",
  "rationale": "...",
  "stepCompleteConfidence": 0-100,
  "contextGathered": [ ... ]
}
```

A line break inside a JSON string is written `\n` — one backslash. To emit the
two characters that show up on screen, the model has to write `\\n`: it escapes
the escape, as if the string were going to be decoded twice. That is the whole
bug. Nothing in the prompt tells the model how to break a line, or that its reply
is decoded exactly once.

The rest of the path was ruled out by reading it end to end, and none of it
touches the string:

| Stage | File | What it does to `response` |
| --- | --- | --- |
| Model call | `packages/adapters/src/ai/language-model-adapter.ts` | Vercel AI SDK `streamObject`; decodes the JSON once. `"a\nb"` becomes a real newline, `"a\\nb"` becomes backslash + `n`. |
| Stream fan-out | `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts` | Slices the accumulated `response` and forwards the new characters verbatim. |
| Wire framing | `.../stream/turn-stream-writer.ts` | `formatDataStreamPart("text", …)` JSON-encodes each frame; `useChat` in `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` decodes it. Symmetric — a real newline survives, and nothing new is introduced. |
| Persistence | `.../stream/turn-helpers.ts` | Writes `object.response` to `core_session_messages.content` unchanged. |
| Render | `apps/web/src/components/chat/markdown.ts` | `parseMarkdownBlocks` splits on `"\n"` — a real newline only. |

So the corrupt characters are already present in what the model returned, which
is why the same characters appear in the live stream, in the database, and after
a reload. It also explains the intermittency: over-escaping is a per-generation
slip, not a deterministic transform.

The renderer is where the defect becomes visible, and it is defenceless. Because
`parseMarkdownBlocks` splits on real newlines only, an affected reply is a single
line: no paragraph split, no heading, no bullet or numbered list is recognised
anywhere in it. The backslashes are the obvious half of the symptom; the lost
list structure is the worse half.

## Fix plan

Two layers — one that stops the model producing it, one that stops it reaching
the screen if the model slips anyway.

### 1. Tell the model what formatting it may use — `flow-session-graph.ts`

Add a `<formatting>` block to the system prompt built by `buildSystemPrompt`. It
states the permitted vocabulary — short paragraphs, `**bold**`, `-` bullets,
`1.` numbered lists, and nothing else — and states that a line break is a real
newline in the JSON string, never a written-out `\n`.

It sits with the other stable structural blocks, above the per-turn retrieved
chunks, so the prompt cache prefix (ADR-016 Decision 5) is unaffected.

The narrow vocabulary is deliberate and matches what the bubble renders well.
Headings are permitted nowhere: `MarkdownText` already collapses them to a bold
lead-in, so asking for one buys nothing.

### 2. Normalise stray escape sequences — `markdown.ts`

Normalise `\n`, `\r\n` and `\r` written as literal escape sequences into real
line breaks at the top of `parseMarkdownBlocks`, before the input is split. Doing
it there rather than at the point of persistence means the guard also repairs the
messages already stored with the corrupt characters — no data migration, and no
back-fill.

Applying it before the split is what restores the lost structure: the repaired
text goes through fence, heading and list detection like any other reply, so the
sample's `1.` / `2.` lines become an ordered list rather than mid-paragraph text.

Fenced code content is excluded from the normalisation, so a reply that
deliberately shows an escape sequence inside a fence keeps it verbatim.

## Tests

- `apps/web/src/components/chat/markdown.test.ts` — the reported sample must
  parse into a paragraph plus a two-item ordered list; `\r\n` and `\r` normalise
  the same way; real-newline input is untouched; a lone trailing backslash stays
  literal; a fenced block keeps its escapes.
- `packages/adapters/src/agents/flow-session-graph.test.ts` — the built system
  prompt states the permitted formatting and forbids a written-out `\n`.
- **No Playwright e2e spec.** Text parsing is not one of the six groups in
  `docs/guides/e2e-test-policy.md`. The parser regression test is the guard, and
  it runs on every `./validate.sh`.

## Risks

- Content legitimately containing a backslash followed by `n` — a Windows path, a
  regex shown to the user — renders as a line break outside a fenced block.
  Accepted for a business-workflow chat surface where such content is not
  expected, and mitigated by the fence exclusion.
- Replies become marginally plainer where the model would previously have reached
  for a heading. Headings already rendered as a bold lead-in, so the visible loss
  is minimal.

## Out of scope

- Normalising server-side before persistence, or back-filling existing rows — the
  render-time guard covers both.
- Any change to the streaming chunk protocol in `stream-turn.ts`.
- Broadening the renderer to support tables or nested lists.
