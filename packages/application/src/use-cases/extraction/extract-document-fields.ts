import {
  applyConfidenceFloor,
  ok,
  type ExtractionField,
  type ExtractionFieldResult,
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { buildExtractionResultSchema, type ExtractionResultData } from "@rbrasier/shared";
import { buildExtractionSystemPrompt } from "./build-extraction-prompt";

// Shown when a record's source documents carry no readable text (e.g. a scanned
// PDF with no text layer). The value is left blank rather than letting the model
// emit confident nonsense over an empty document (phase §5).
export const UNREADABLE_RATIONALE =
  "The source document has no readable text — it may be a scanned image. Extraction was skipped.";

// Model confidence is reported 0-100 (the self-assessment convention); the
// domain bands in 0..1, so normalise and clamp.
const normaliseConfidence = (confidence: number): number =>
  Math.min(1, Math.max(0, confidence / 100));

export interface RecordDocumentText {
  filename: string;
  text: string;
}

export interface ExtractDocumentFieldsInput {
  fields: ExtractionField[];
  recordLabel: string;
  documentTexts: RecordDocumentText[];
  contextDocs: FlowContextDoc[];
  // How the AI should read the input documents (the input card's guidance).
  instruction: string;
  userId?: string | null;
  flowId?: string | null;
}

const unreadableResults = (fields: ExtractionField[]): ExtractionFieldResult[] =>
  fields.map((field) => ({
    key: field.field.key,
    value: "",
    confidence: 0,
    rationale: UNREADABLE_RATIONALE,
  }));

const buildDocumentsSection = (documentTexts: RecordDocumentText[]): string =>
  documentTexts
    .map((document) => `\n[${document.filename}]\n${document.text}`)
    .join("\n");

// Extracts one record's fields against the schema (phase §8). Empty-text records
// are flagged unreadable up front (no model call). Otherwise the model returns
// every field's value, a 0-100 confidence, and a rationale in one call; results
// are mapped back in schema order, best-effort — a missing key becomes a blank,
// zero-confidence result rather than failing the extraction.
export const extractDocumentFields = async (
  languageModel: ILanguageModel,
  input: ExtractDocumentFieldsInput,
): Promise<Result<ExtractionFieldResult[]>> => {
  const hasReadableText = input.documentTexts.some((document) => document.text.trim().length > 0);
  if (!hasReadableText) return ok(unreadableResults(input.fields));

  const keys = input.fields.map((field) => field.field.key);

  const prompt = [
    `Extract the fields for the record "${input.recordLabel}".`,
    `Return a JSON object whose keys are exactly: ${JSON.stringify(keys)}.`,
    `For each key return { value, confidence (0-100), rationale }, following the extraction rules and field formats in your instructions.`,
    `\nRecord source documents:\n${buildDocumentsSection(input.documentTexts)}`,
  ].join("\n");

  const system = buildExtractionSystemPrompt({
    fields: input.fields,
    guidance: input.instruction,
    contextDocs: input.contextDocs,
  });

  const result = await languageModel.generateObject<ExtractionResultData>({
    purpose: "extractionFieldExtraction",
    userId: input.userId,
    flowId: input.flowId,
    system,
    prompt,
    // An explicit keyed schema (every field required) forces a complete result —
    // a free-form record let the model silently drop fields it was unsure of.
    schema: buildExtractionResultSchema(keys),
    temperature: 0.2,
  });
  if (result.error) return result;

  const object = result.data.object;
  const results = input.fields.map((field): ExtractionFieldResult => {
    const scored = object[field.field.key];
    if (!scored) {
      return {
        key: field.field.key,
        value: "",
        confidence: 0,
        rationale: "The model did not return this field.",
      };
    }
    return applyConfidenceFloor({
      key: field.field.key,
      value: scored.value,
      confidence: normaliseConfidence(scored.confidence),
      rationale: scored.rationale,
    });
  });

  return ok(results);
};
