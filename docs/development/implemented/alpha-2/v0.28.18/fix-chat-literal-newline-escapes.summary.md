# Summary — chat replies printed `\n` instead of breaking the line (0.28.18)

## Symptom

An assistant reply reached the chat bubble with the two characters `\` and `n`
printed as text where a line break belonged:

```
… I just need two more things:\n\n1. What type of equipment does Joe need …
```

Because the reply arrived as one unbroken line, the numbered list it contained
never became a list either — the lead-in and both questions ran together in a
single paragraph. Intermittent: the same step broke its lines correctly on other
turns.

## Root cause

The agent returns JSON, not prose. `FlowSessionGraph.buildSystemPrompt` requires
an object whose `response` field carries the user-facing text. A line break
inside a JSON string is written `\n` — one backslash. To produce the two
characters seen on screen the model has to write `\\n`: it escapes the escape.
Nothing in the prompt told it how to break a line, or that its reply is decoded
exactly once.

The rest of the path was read end to end and none of it touches the string:
`streamObject` (Vercel AI SDK) decodes the JSON once; `stream-turn.ts` forwards
the new characters verbatim; `formatDataStreamPart` and `useChat` are a
symmetric encode/decode pair; `turn-helpers.ts` persists `object.response`
unchanged. The corrupt characters were therefore already in the model's output,
which is why they appeared in the live stream, in the database, and after a
reload — and why it was intermittent rather than deterministic.

The renderer was where it became visible and had no defence:
`parseMarkdownBlocks` splits on real newlines only, so an affected reply was one
line and no fence, heading, bullet or numbered list anywhere in it was
recognised.

## Fix applied

- **`packages/adapters/src/agents/flow-session-graph.ts`** — new `FORMATTING_BLOCK`
  rendered into the system prompt between `<constraints>` and `<output>`. It
  states the permitted vocabulary (short paragraphs, `**bold**`, `-` bullets,
  `1.` numbered lists — no headings, tables, code blocks, links, images or HTML)
  and requires an actual line break in the string, naming the `\n` failure mode
  explicitly. It sits above the per-turn retrieved chunks and current-date
  blocks, so the cached prompt prefix (ADR-016 Decision 5) is unaffected.
- **`apps/web/src/components/chat/markdown.ts`** — new
  `normaliseEscapedLineBreaks`, applied at the top of `parseMarkdownBlocks`
  before the input is split. `\n`, `\r\n` and `\r` written as escape sequences
  become real line breaks; content inside a fenced code block is left verbatim.
  Normalising before the split is what restores the lost structure — the
  repaired text goes through heading, bullet and list detection like any other
  reply.

Doing the guard at render time rather than before persistence means it also
repairs the assistant messages already stored with the corrupt characters. No
migration, no back-fill.

## Regression tests added

- **`apps/web/src/components/chat/markdown.test.ts`** — the reported sample must
  parse into a paragraph plus a two-item ordered list (failed before the fix);
  `\r\n` and `\r` normalise the same way (failed before the fix); a real newline
  is untouched; a lone backslash stays literal; escape sequences inside a fenced
  block survive verbatim.
- **`packages/adapters/src/agents/flow-session-graph.test.ts`** — the built
  system prompt states the permitted formatting and forbids a written-out `\n`,
  and the block sits above `<reference_documents>` and `<current_context>` so the
  cache prefix stays stable.

## E2E test

None. Text parsing is not one of the six groups in
`docs/guides/e2e-test-policy.md`. The parser regression tests are the guard and
run on every `./validate.sh`.

## Version

PATCH bump `0.28.17` → `0.28.18` (`VERSION` and root `package.json`). No schema
change.

## Known limitations

- Content legitimately containing a backslash followed by `n` — a Windows path,
  a regex shown to the user — renders as a line break when it appears outside a
  fenced block. Accepted for a business-workflow chat surface; the fence
  exclusion is the escape hatch.
- The prompt rule is guidance, not a hard constraint on the model. The renderer
  guard is what makes the symptom unreachable.
