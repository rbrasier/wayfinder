import {
  ok,
  type ConversationalNodeConfig,
  type IDocumentGenerator,
  type Result,
  type SessionMessage,
  type TemplateField,
} from "@rbrasier/domain";

// Number of template fields gathered per model call. Small enough to keep each
// prompt and structured output bounded; large enough that typical templates
// resolve in one or two calls. Shared by document generation and the
// pre-generation evaluation gate so both batch identically.
export const DEFAULT_FIELD_BATCH_SIZE = 12;

// Inline (author-pinned) fields take precedence; otherwise the fields are
// extracted from the template bytes. Pure and synchronous — the caller supplies
// the already-fetched template bytes.
export const resolveTemplateFields = (
  documentGenerator: IDocumentGenerator,
  config: ConversationalNodeConfig,
  templateBytes: Buffer,
): Result<TemplateField[]> => {
  if (config.documentTemplateFields && config.documentTemplateFields.length > 0) {
    return ok(config.documentTemplateFields);
  }
  const fieldsResult = documentGenerator.extractFields({ templateBytes });
  if (fieldsResult.error) return fieldsResult;
  return ok(fieldsResult.data.fields);
};

export const batchTemplateFields = (
  fields: TemplateField[],
  batchSize: number = DEFAULT_FIELD_BATCH_SIZE,
): TemplateField[][] => {
  if (fields.length === 0) return [];
  const size = batchSize > 0 ? batchSize : DEFAULT_FIELD_BATCH_SIZE;
  const batches: TemplateField[][] = [];
  for (let index = 0; index < fields.length; index += size) {
    batches.push(fields.slice(index, index + size));
  }
  return batches;
};

// Cap mirrors the model context budget guard — only user/assistant turns are
// relevant to filling a template's fields.
const TRANSCRIPT_CHAR_CAP = 8000;

// Keeps the most recent turns within the cap: a document is filled from the
// latest information the user gave, so truncating from the front (dropping older
// turns) is correct — the previous head-slice discarded everything the user said
// after the first ~8k characters. Whole messages are dropped oldest-first; a
// single most-recent message that alone exceeds the cap is tail-sliced so it is
// never dropped to empty.
export const buildDocumentTranscript = (
  messages: readonly Pick<SessionMessage, "role" | "content">[],
): string => {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`);

  const SEPARATOR = "\n\n";
  const kept: string[] = [];
  let total = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const addition = kept.length === 0 ? line.length : line.length + SEPARATOR.length;
    if (total + addition > TRANSCRIPT_CHAR_CAP) {
      if (kept.length === 0) {
        kept.unshift(line.slice(line.length - TRANSCRIPT_CHAR_CAP));
      }
      break;
    }
    kept.unshift(line);
    total += addition;
  }
  return kept.join(SEPARATOR);
};
