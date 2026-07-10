# Phase — DOCX Template Full-Text Extraction for AI Prompt Context

- **Status**: Awaiting Implementation
- **Target version**: `1.8.2` (bump: PATCH — no schema changes, behaviour fix)

## 1. Problem

When a DOCX template is uploaded to a conversational flow step, the system
stores the file path and filename but never extracts the document's text
content. The `documentTemplateMarkdown` field on `ConversationalNodeConfig`
is designed to be injected into the AI system prompt via `buildSystemPrompt`,
but it is never populated, so the AI cannot see the document structure or its
`{{variable}}` placeholders in context.

As a result, the AI improvises its own questions (e.g. asking for date of
birth, email) rather than asking for the fields the document actually requires.

## 2. Goals

- At template upload time, extract the full plain text from the DOCX (including
  `{{variable}}` placeholders in their surrounding sentence context) and persist
  it to `documentTemplateMarkdown` on the node config.
- At inference time, the existing `buildSystemPrompt` logic already injects this
  field into `<document_template>` when set — no change needed there.

## 3. Non-goals

- Markdown conversion — plain text with paragraph breaks is sufficient.
- Header/footer extraction — body text only.
- Image or table-structure extraction.
- Re-extraction on template update (treated as immutable).

## 4. Approach

Use PizZip (already in the codebase) to unzip the DOCX and parse
`word/document.xml`. Walk `<w:p>` paragraphs, join `<w:t>` run text within
each paragraph, and separate paragraphs with newlines. This preserves
`{{variable}}` placeholders exactly where they appear in the document prose.

No new dependencies needed.

Cap stored text at 32 768 characters to keep it within a sensible prompt
budget. Truncate at a word boundary.

## 5. Key entities / files

| Layer    | File                                                                 | Change                                               |
|----------|----------------------------------------------------------------------|------------------------------------------------------|
| domain   | `packages/domain/src/ports/document-generator.ts`                   | Add `ExtractFullTextInput`, `ExtractFullTextOutput`, method `extractFullText` to `IDocumentGenerator` |
| adapters | `packages/adapters/src/documents/docx-generator.ts`                 | Implement `extractFullText`                          |
| adapters | `packages/adapters/src/documents/docx-generator.test.ts`            | Tests for `extractFullText`                          |
| web      | `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`  | Call `extractFullText` on upload, save to node config |

`packages/adapters/src/agents/flow-session-graph.ts` — **no change needed**.
The injection at line 28 already fires when `documentTemplateMarkdown` is set.

## 6. Domain changes

### `IDocumentGenerator` (extend)

```ts
export interface ExtractFullTextInput {
  templateBytes: Buffer;
}

export interface ExtractFullTextOutput {
  text: string;
}

export interface IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput>;
  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput>;
  generate(input: GenerateDocxInput): Result<GenerateDocxOutput>;
}
```

## 7. Adapter implementation — `extractFullText`

```ts
extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput> {
  try {
    const zip = new PizZip(input.templateBytes);
    const file = zip.file("word/document.xml");
    if (!file) return err(domainError("VALIDATION_FAILED", "word/document.xml not found"));
    const xml = file.asText();
    const paragraphs = this.extractParagraphTexts(xml);
    const fullText = paragraphs.filter(p => p.trim()).join("\n");
    const capped = this.capText(fullText, 32_768);
    return ok({ text: capped });
  } catch (cause) {
    return err(domainError("VALIDATION_FAILED", "Failed to extract text from DOCX.", cause));
  }
}
```

`extractParagraphTexts` — matches `<w:p>` elements, joins `<w:t>` run text
within each, returns array of strings.

`capText` — slices at word boundary at or before `maxChars`.

## 8. Upload route change

After `validationResult` succeeds and the file is stored:

```ts
const textResult = docxGenerator.extractFullText({ templateBytes: buffer });
const documentTemplateMarkdown = textResult.data?.text ?? null;

const updatedConfig = {
  ...existingConfig,
  documentTemplatePath: storageKey,
  documentTemplateFilename: safeFilename,
  documentTemplateMarkdown,
};
```

Extraction failure is non-blocking — `documentTemplateMarkdown` is set to
`null` and the upload succeeds.

## 9. Acceptance criteria

- [ ] Uploading a DOCX with `{{variable}}` placeholders populates
      `documentTemplateMarkdown` with the full document text including the
      placeholders in context.
- [ ] Text is capped at 32 768 characters at a word boundary.
- [ ] Extraction failure does not block the upload — `documentTemplateMarkdown`
      is null and the response still returns 200 with path/filename/tagCount.
- [ ] `DocxGenerator.extractFullText` is covered by unit tests.
- [ ] `VERSION` and `package.json#version` = `1.8.2`. `validate.sh` passes.

## 10. Validation

Run `./validate.sh`. Move this file to
`docs/development/implemented/v1.8.2/` and write `summary.md`.
