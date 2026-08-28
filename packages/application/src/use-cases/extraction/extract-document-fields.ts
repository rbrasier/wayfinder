import {
  applyConfidenceFloor,
  isVerbatimIn,
  ok,
  type ExtractionField,
  type ExtractionFieldResult,
  type FieldSourceRef,
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import {
  buildExtractionResultSchema,
  type ExtractionFieldResultData,
  type ExtractionResultData,
} from "@rbrasier/shared";
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
  // Required rather than optional so the compiler forces every caller to supply
  // a real id — a source reference resolved against a guessed one would point
  // the reader at the wrong document.
  documentId: string;
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

// First occurrence wins, so a record carrying two files of the same name
// resolves to the one the prompt listed first rather than to whichever the map
// happened to keep.
const documentIdsByFilename = (documentTexts: RecordDocumentText[]): Map<string, string> => {
  const byFilename = new Map<string, string>();
  for (const document of documentTexts) {
    if (byFilename.has(document.filename)) continue;
    byFilename.set(document.filename, document.documentId);
  }
  return byFilename;
};

// Absent stays absent. A model that omits the reference, points at a document
// this record never had, or gives a blank locator produces no `sourceRef` at
// all — an empty ref would render as a link to nowhere and export as a locator
// the auditor cannot follow.
const resolveSourceRef = (
  reported: ExtractionFieldResultData["sourceRef"],
  documentIdByFilename: Map<string, string>,
): FieldSourceRef | undefined => {
  if (!reported) return undefined;
  const locator = reported.locator.trim();
  if (locator.length === 0) return undefined;
  const documentId = documentIdByFilename.get(reported.document.trim());
  if (!documentId) return undefined;
  return { documentId, locator };
};

// Provenance and source reference are attached after the confidence floor has
// run, never before: the floor blanks a value it discards, and neither a
// verbatim claim nor a locator describes a blank (ADR-053 §1).
//
// Only `verbatim` is stamped. `processed` is what absence already means, so
// writing it would add a member to every composed row to say what its omission
// says — the reason the phase left the extraction paths unstamped until there
// was a producer for the other value.
const annotateProvenance = (
  result: ExtractionFieldResult,
  sourceTexts: string[],
  sourceRef: FieldSourceRef | undefined,
): ExtractionFieldResult => {
  if (result.value.length === 0) return result;
  const annotated: ExtractionFieldResult = { ...result };
  if (isVerbatimIn(result.value, sourceTexts)) annotated.provenance = "verbatim";
  if (sourceRef) annotated.sourceRef = sourceRef;
  return annotated;
};

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
    `For each key return { value, confidence (0-100), rationale }, plus sourceRef when you can point to where the value came from, following the extraction rules and field formats in your instructions.`,
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
  });
  if (result.error) return result;

  const object = result.data.object;
  const sourceTexts = input.documentTexts.map((document) => document.text);
  const documentIdByFilename = documentIdsByFilename(input.documentTexts);

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
    const floored = applyConfidenceFloor({
      key: field.field.key,
      value: scored.value,
      confidence: normaliseConfidence(scored.confidence),
      rationale: scored.rationale,
    });
    return annotateProvenance(
      floored,
      sourceTexts,
      resolveSourceRef(scored.sourceRef, documentIdByFilename),
    );
  });

  return ok(results);
};
