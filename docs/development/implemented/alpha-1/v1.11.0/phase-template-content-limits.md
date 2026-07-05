# Phase — Template Content Limits & Structural Stripping

- **Status**: Awaiting Implementation
- **Target version**: `1.11.0` (bump: MINOR — new optional config field on `ConversationalNodeConfig`, validation behaviour change at template upload)
- **Depends on**: v1.10.0 (context document extraction)

## 1. Problem

Step templates (`.docx` files uploaded per node) are extracted to plain text
and stored verbatim in `ConversationalNodeConfig.documentTemplateContent`.
That full text is injected into the chat system prompt on every turn for
that step, via `buildSystemPrompt` in
`packages/adapters/src/agents/flow-session-graph.ts`.

Two consequences:

1. **No upload-time size guard.** Unlike flow context docs (capped at
   65 536 chars total), template extracted text has no char limit. A long
   prose template inflates the system prompt indefinitely.
2. **Verbose prompt content.** The AI only needs the template *structure*
   (headings, labels, tag placeholders) to know what information to gather.
   Long body paragraphs from the template waste tokens on every turn.

Document generation is unaffected by this change — it always runs against
the raw `.docx` bytes pulled from object storage. The new field affects
only what is shown to the model during conversational turns.

## 2. Goals

- At template upload time, produce a stripped/structural version of the
  template text that preserves headings, field labels and tag placeholders,
  and discards long prose paragraphs.
- Reject uploads whose stripped structural content exceeds a fixed char limit.
- Use the stripped version in the chat system prompt; fall back to the
  full extracted text when the stripped version is absent (legacy nodes).
- Return the structural-content char count in the upload response so the UI
  can show the user how much of the prompt budget this step consumes.

## 3. Non-goals

- Backfilling existing templates — they keep working via fallback.
- Compressing or summarising flow-level context docs (already covered by
  the v1.10.0 work).
- Changing how document generation reads the template (still uses raw
  `.docx` bytes from object storage).
- Migrating `app_flow_nodes.config` shape — JSONB allows the new optional
  field to be added without DDL changes.

## 4. Approach

**AI-based structural summarisation, validated against a fixed char limit.**

When a `.docx` template is uploaded:

1. Extract full plain text (existing behaviour via `DocxGenerator.extractFullText`).
2. Call a new `SummariseTemplate` use case which uses `ILanguageModel.generateObject`
   to return a structural version — headings, labels, tag placeholders preserved;
   long prose paragraphs dropped.
3. Reject the upload with HTTP 422 if the structural version exceeds
   `TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS` (16 384 chars). The full extracted
   text is allowed to be longer — only the structural form is capped.
4. Persist **both** versions in `ConversationalNodeConfig`:
   - `documentTemplateContent` — full extracted text (unchanged shape)
   - `documentTemplateStructuredContent` — new field, used in system prompt
5. Return `tagCount` and `templateContentLength` (= structured length) in
   the upload response.

At chat time, `buildSystemPrompt` prefers `documentTemplateStructuredContent`
when present and falls back to `documentTemplateContent`. Legacy nodes
uploaded before this phase have `documentTemplateStructuredContent === undefined`
and continue working unchanged via the fallback.

### Why AI summarisation over a heuristic

A heuristic (e.g. "keep lines under N chars or containing tags") is
deterministic and free, but it produces brittle results for templates that
use long heading-style sentences, multi-line labels, or mix prose with
inline tags. The AI summariser produces a cleaner result and only runs
once per upload, so latency and cost are bounded. Failures fall back to
storing the full extracted text as `documentTemplateStructuredContent`
(so behaviour matches today) and the upload still succeeds, then the
char limit is applied to the fallback content.

### Char limit rationale

Per CLAUDE.md, the existing context docs total budget is 65 536 chars
(~16 K tokens). 16 384 chars (~4 K tokens) per template structural form
sits well inside that envelope and leaves room for context docs, conversation
history, role block and instructions. A flow with 4–5 steps each holding a
16 KB structural template stays comfortably below model context limits.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| shared | `packages/shared/src/schemas/templates.ts` | NEW — constants |
| shared | `packages/shared/src/schemas/index.ts` | re-export new module |
| domain | `packages/domain/src/entities/flow-node.ts` | Extend `ConversationalNodeConfig` |
| application | `packages/application/src/use-cases/document/summarise-template.ts` | NEW — use case |
| application | `packages/application/src/use-cases/document/summarise-template.test.ts` | NEW — test |
| application | `packages/application/src/index.ts` | export new use case |
| apps/web | `apps/web/src/lib/container.ts` | wire `SummariseTemplate` |
| apps/web | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts` | call summariser, validate, persist both, return length |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | prefer structured content in `templateBlock` |

## 6. Shared constants

`packages/shared/src/schemas/templates.ts`:

```ts
export const TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS = 16_384;
export const TEMPLATE_STRUCTURED_CONTENT_WARNING_THRESHOLD_CHARS = 12_288;
```

Re-exported from `packages/shared/src/schemas/index.ts` alongside the
context docs constants.

## 7. Domain changes

### `ConversationalNodeConfig` (extend)

```ts
export interface ConversationalNodeConfig {
  aiInstruction: string;
  doneWhen: string;
  outputType: "conversation_only" | "generate_document";
  documentTemplateContent?: string | null;
  documentTemplateStructuredContent?: string | null;  // NEW
  documentTemplatePath?: string | null;
  documentTemplateFilename?: string | null;
  advanceConfidenceThreshold?: number;
}
```

The field is optional. Nodes uploaded before this phase have it `undefined`
and the prompt builder falls back to `documentTemplateContent`.

## 8. Application changes

### `SummariseTemplate` use case (new)

`packages/application/src/use-cases/document/summarise-template.ts`:

```ts
export interface SummariseTemplateInput {
  fullExtractedText: string;
  tags: string[];
}

export interface SummariseTemplateOutput {
  structuredContent: string;
}

export class SummariseTemplate {
  constructor(private readonly languageModel: ILanguageModel) {}

  async execute(input: SummariseTemplateInput): Promise<Result<SummariseTemplateOutput>>;
}
```

Behaviour:

- Calls `languageModel.generateObject` with a structural-summary prompt and
  a Zod schema expecting `{ structuredContent: string }`.
- Prompt instructs the model to: preserve headings, field labels and
  every tag placeholder verbatim; drop long prose paragraphs that don't
  contain a tag or label.
- On language model error: returns `{ data: { structuredContent: input.fullExtractedText } }`
  rather than failing — fallback preserves today's behaviour. The char-limit
  check at the call site still applies, so an oversized fallback rejects
  the upload with a clear message ("template too large to use as a prompt
  structure — reduce length and re-upload").

### `documentSummarySchema` is unrelated

A separate Zod schema (`templateStructureSchema`) lives in
`packages/shared/src/schemas/document.ts` (or alongside it) — it is
distinct from `documentSummarySchema` already used by `GenerateDocument`.

## 9. Upload flow changes

In `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`,
after `docxGenerator.extractFullText`:

```ts
const fullText = textResult.data?.text ?? null;

if (!fullText) {
  return NextResponse.json(
    { error: "Could not extract text from template" },
    { status: 422 },
  );
}

const summariseResult = await container.useCases.summariseTemplate.execute({
  fullExtractedText: fullText,
  tags: validationResult.data.tags,
});
if (summariseResult.error) {
  return NextResponse.json({ error: "Failed to process template" }, { status: 500 });
}

const structuredContent = summariseResult.data.structuredContent;

if (structuredContent.length > TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS) {
  return NextResponse.json(
    {
      error: `Template structural content (${structuredContent.length} chars) exceeds limit of ${TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS} chars. Reduce template length and try again.`,
    },
    { status: 422 },
  );
}

const updatedConfig = {
  ...existingConfig,
  documentTemplatePath: storageKey,
  documentTemplateFilename: safeFilename,
  documentTemplateContent: fullText,
  documentTemplateStructuredContent: structuredContent,
};
```

Response shape:

```ts
{
  path: storageKey,
  filename: safeFilename,
  tagCount: validationResult.data.tags.length,
  templateContentLength: structuredContent.length,  // NEW
  documentTemplateContent: fullText,  // existing (unchanged)
}
```

## 10. Container wiring

`apps/web/src/lib/container.ts` registers `SummariseTemplate` under
`container.useCases.summariseTemplate`, depending on `container.services.languageModel`
(already exists).

## 11. Prompt change

`packages/adapters/src/agents/flow-session-graph.ts`, line 28-31:

```ts
const templateBlock =
  nodeConfig.outputType === "generate_document"
    ? (() => {
        const content =
          nodeConfig.documentTemplateStructuredContent ??
          nodeConfig.documentTemplateContent;
        return content
          ? `\n\n  <document_template>\n    This step produces a document. Your goal is to gather all information needed to fully complete the following template:\n    ${content}\n  </document_template>`
          : "";
      })()
    : "";
```

Behaviour:

- New uploads use the stripped structural content (≤ 16 KB).
- Legacy nodes fall back to full content (no behaviour change for them).
- Nodes with neither remain template-block-free.

## 12. Test plan

### `summarise-template.test.ts`

- ✅ Mocked `ILanguageModel.generateObject` returns structuredContent shorter than input → use case returns it via Result.
- ✅ Mocked `generateObject` returns an error → falls back to `fullExtractedText` and returns Result.ok.
- ✅ Prompt passed to `generateObject` mentions the tags and instructs preservation of headings, labels, placeholders.
- ✅ Result shape matches `SummariseTemplateOutput`.

### Manual verification (after build)

- Upload a small `.docx` template — succeeds, response includes `templateContentLength`.
- Upload a template producing > 16 384 chars of structural content — rejected with 422 and clear message.
- Start a session on a node with the new template — chat works, AI references field labels.
- Existing nodes (no `documentTemplateStructuredContent`) still work — `templateBlock` falls back to full content.

## 13. Risks / open questions

- **Summariser AI call adds latency to template upload.** Acceptable —
  templates upload once per node and the AI call is bounded by template size.
- **Summariser might drop a tag placeholder.** The prompt instructs preservation
  verbatim, but the model could hallucinate. Mitigation: the use case does NOT
  re-validate tag presence in this phase — `extractTags` was already called on
  the raw `.docx`, and document generation uses raw `.docx` bytes, not the
  structured content. The structured content is only used to guide the AI
  during conversation, so a missing tag in the structural form is a minor
  prompt-quality issue, not a correctness bug.
- **Model cost for very large templates.** A 100 KB template means a 100 KB
  prompt to the summariser. If a template would exceed budgets at this stage,
  upload fails. Future work could pre-truncate aggressively before summarisation.

## 14. Acceptance criteria

- [ ] `packages/shared` exports `TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS` (16 384) and the warning threshold.
- [ ] `ConversationalNodeConfig` has `documentTemplateStructuredContent?: string | null`.
- [ ] `SummariseTemplate` use case exists with a test file written before the implementation.
- [ ] Template upload route calls the summariser, persists both content variants, and returns `templateContentLength`.
- [ ] Template upload route rejects (422) when structured content exceeds the cap.
- [ ] `buildSystemPrompt` prefers `documentTemplateStructuredContent`, falls back to `documentTemplateContent`.
- [ ] `VERSION` and `package.json#version` both equal `1.11.0`.
- [ ] `./validate.sh` passes.

## 15. Validation

Run `./validate.sh`. Then move this file to
`docs/development/implemented/v1.11.0/` and write `summary.md`.
