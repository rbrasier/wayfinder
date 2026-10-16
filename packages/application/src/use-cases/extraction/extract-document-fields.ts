import {
  applyConfidenceFloor,
  domainError,
  err,
  mergeFieldResults,
  ok,
  verifyVerbatim,
  type ExtractionField,
  type ExtractionFieldResult,
  type ExtractionPromptBudget,
  type FieldSourceRef,
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
} from "@wayfinder/domain";
import {
  buildExtractionResultSchema,
  DOCUMENT_GENERATION_CHARS_PER_TOKEN,
  DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_TOKENS,
  DOCUMENT_GENERATION_DEFAULT_MAX_PROMPT_TOKENS,
  type ExtractionFieldResultData,
  type ExtractionResultData,
} from "@wayfinder/shared";
import { estimateTokens } from "../document/structured-fields";
import { buildExtractionSystemPrompt } from "./build-extraction-prompt";
import { clampOutputBudget } from "./output-budget";
import { splitDocumentText } from "./split-document-text";

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
  // Resolved from the admin ExtractionConfig against the extraction model
  // (issue #335). Omitted means the code defaults with no window limit.
  budget?: ExtractionPromptBudget;
}

const unreadableResults = (fields: ExtractionField[]): ExtractionFieldResult[] =>
  fields.map((field) => ({
    key: field.field.key,
    value: "",
    confidence: 0,
    rationale: UNREADABLE_RATIONALE,
  }));

// The label each document is given in the prompt, unique within the record. Two
// files of the same name are a routine shape here — one invoice per supplier
// folder — and the model can only name a document by the label it was shown, so
// a duplicate label would send every reference to whichever one came first.
const documentLabels = (documentTexts: RecordDocumentText[]): Map<string, string> => {
  const labelByDocumentId = new Map<string, string>();
  const used = new Set<string>();
  for (const document of documentTexts) {
    let label = document.filename;
    for (let suffix = 2; used.has(label); suffix += 1) {
      label = `${document.filename} (${suffix})`;
    }
    used.add(label);
    labelByDocumentId.set(document.documentId, label);
  }
  return labelByDocumentId;
};

const invert = (labelByDocumentId: Map<string, string>): Map<string, string> =>
  new Map([...labelByDocumentId].map(([documentId, label]) => [label, documentId]));

// Absent stays absent. A model that omits the reference, points at a document
// this record never had, or gives a blank locator produces no `sourceRef` at
// all — an empty ref would render as a link to nowhere and export as a locator
// the auditor cannot follow.
//
// The quote is stored exactly as reported, never trimmed: it is the evidence a
// `verbatim` stamp rests on, and tidying it would make the stored evidence
// something other than what was checked.
const resolveSourceRef = (
  reported: ExtractionFieldResultData["sourceRef"],
  documentIdByLabel: Map<string, string>,
): FieldSourceRef | undefined => {
  if (!reported) return undefined;
  const locator = reported.locator.trim();
  if (locator.length === 0) return undefined;
  const documentId = documentIdByLabel.get(reported.document.trim());
  if (!documentId) return undefined;
  return { documentId, locator, quote: reported.quote };
};

// Provenance and source reference are attached after the confidence floor has
// run, never before: the floor blanks a value it discards, and neither a
// verbatim claim nor a locator describes a blank (ADR-053 §1).
//
// `verbatim` is a claim the model made and this code verified, not an inference
// drawn from the value alone. The model must have returned a source reference
// that resolved to a document on this record, and `verifyVerbatim` must accept
// the quote against *that* document's text. A claim that fails is refused
// silently — the value is left unstamped, which already reads as `processed` —
// while the reference itself is kept, because the locator may well be right even
// where the quote was mis-transcribed.
//
// Only `verbatim` is stamped. `processed` is what absence already means, so
// writing it would add a member to every composed row to say what its omission
// says — the reason the phase left the extraction paths unstamped until there
// was a producer for the other value.
const annotateProvenance = (
  result: ExtractionFieldResult,
  field: ExtractionField,
  textByDocumentId: Map<string, string>,
  sourceRef: FieldSourceRef | undefined,
): ExtractionFieldResult => {
  // Blank is the floor's own definition of blank, so a whitespace-only value the
  // floor left alone is not stamped either.
  if (result.value.trim().length === 0) return result;

  const annotated: ExtractionFieldResult = { ...result };
  const verified =
    sourceRef !== undefined &&
    verifyVerbatim({
      value: result.value,
      quote: sourceRef.quote ?? "",
      documentText: textByDocumentId.get(sourceRef.documentId) ?? "",
      field: field.field,
    });
  if (verified) annotated.provenance = "verbatim";
  if (sourceRef) annotated.sourceRef = sourceRef;
  return annotated;
};

const buildDocumentsSection = (
  documentTexts: RecordDocumentText[],
  labelByDocumentId: Map<string, string>,
): string =>
  documentTexts
    .map(
      (document) =>
        `\n[${labelByDocumentId.get(document.documentId) ?? document.filename}]\n${document.text}`,
    )
    .join("\n");

// Each field returns a value, a confidence, a rationale and often a quoted
// source reference, so the reply grows with the field count rather than with
// the length of the documents.
const TOKENS_PER_FIELD = 400;
const REPLY_OVERHEAD_TOKENS = 1024;

export const extractionOutputBudget = (fieldCount: number): number =>
  clampOutputBudget(REPLY_OVERHEAD_TOKENS + TOKENS_PER_FIELD * fieldCount);

// Which slice of an oversized record one call reads (issue #335).
interface DocumentPart {
  index: number;
  total: number;
}

// The reply has to fit in the model's window alongside the prompt; the admin
// ceiling is a prompt-only guard, the same as document generation's.
export const extractionPromptCeiling = (
  budget: ExtractionPromptBudget,
  fieldCount: number,
): number =>
  Math.min(budget.maxPromptTokens, budget.contextWindowTokens - extractionOutputBudget(fieldCount));

// Below this much room for document text a split would need an unreasonable
// number of calls, so the instructions themselves are what has to change.
export const MIN_DOCUMENT_TOKENS_PER_PART = 1_000;

// Room for a label line around each segment ("\n[name (n)]\n" plus a joining
// newline), so a packed part never overshoots the space it was planned for.
export const SEGMENT_LABEL_OVERHEAD_CHARS = 16;

export const DEFAULT_PROMPT_BUDGET: ExtractionPromptBudget = {
  contextBudgetChars: DOCUMENT_GENERATION_DEFAULT_CONTEXT_BUDGET_TOKENS * DOCUMENT_GENERATION_CHARS_PER_TOKEN,
  maxPromptTokens: DOCUMENT_GENERATION_DEFAULT_MAX_PROMPT_TOKENS,
  contextWindowTokens: Number.POSITIVE_INFINITY,
};

const TOO_LARGE_MESSAGE =
  "The flow's instructions and context material alone exceed the model's limit, leaving no room for the documents. Trim the context material or raise the extraction limits.";

const partNote = (part: DocumentPart | null): string =>
  part
    ? `\nThis is part ${part.index} of ${part.total} of the record's source documents, split because they are too long to read at once. Extract only what this part supports, and leave a field blank when this part does not contain it.`
    : "";

const buildUserPrompt = (
  recordLabel: string,
  keys: string[],
  documentsSection: string,
  part: DocumentPart | null,
): string =>
  [
    `Extract the fields for the record "${recordLabel}".`,
    `Return a JSON object whose keys are exactly: ${JSON.stringify(keys)}.`,
    `For each key return { value, confidence (0-100), rationale }, plus sourceRef when you can point to where the value came from, following the extraction rules and field formats in your instructions.${partNote(part)}`,
    `\nRecord source documents:\n${documentsSection}`,
  ].join("\n");

const segmentsOf = (documentTexts: RecordDocumentText[], maxChars: number): RecordDocumentText[] =>
  documentTexts.flatMap((document) =>
    splitDocumentText(document.text, maxChars - document.filename.length - SEGMENT_LABEL_OVERHEAD_CHARS).map(
      (text) => ({ ...document, text }),
    ),
  );

const segmentSize = (segment: RecordDocumentText): number =>
  segment.filename.length + SEGMENT_LABEL_OVERHEAD_CHARS + segment.text.length;

// Packs segments, in document order, into as few parts as fit `maxChars` each.
const planParts = (documentTexts: RecordDocumentText[], maxChars: number): RecordDocumentText[][] => {
  const parts: RecordDocumentText[][] = [];
  let current: RecordDocumentText[] = [];
  let used = 0;
  for (const segment of segmentsOf(documentTexts, maxChars)) {
    const size = segmentSize(segment);
    if (current.length > 0 && used + size > maxChars) {
      parts.push(current);
      current = [];
      used = 0;
    }
    current.push(segment);
    used += size;
  }
  if (current.length > 0) parts.push(current);
  return parts;
};

const labelWithPart = (results: ExtractionFieldResult[], part: DocumentPart): ExtractionFieldResult[] =>
  results.map((result) => ({
    ...result,
    rationale: `[Part ${part.index} of ${part.total}] ${result.rationale}`,
  }));

// Extracts one record's fields against the schema (phase §8). Empty-text records
// are flagged unreadable up front (no model call). Otherwise the model returns
// every field's value, a 0-100 confidence, and a rationale; results are mapped
// back in schema order, best-effort — a missing key becomes a blank,
// zero-confidence result rather than failing the extraction. A record too large
// for one call is read in parts and merged by ADR-033's many-per-record rule,
// so the best-supported answer wins and an earlier part keeps a tie (issue #335).
export interface DocumentRoomInput {
  fields: ExtractionField[];
  instruction: string;
  contextDocs: FlowContextDoc[];
  recordLabel: string;
  budget: ExtractionPromptBudget;
}

interface CallSizing {
  system: string;
  roomTokens: number;
}

// The one sizing both the extraction call and the pre-run estimate use, so the
// warning an author sees and the split a run makes cannot drift apart.
const sizeCall = (input: DocumentRoomInput): CallSizing => {
  const keys = input.fields.map((field) => field.field.key);
  const system = buildExtractionSystemPrompt({
    fields: input.fields,
    guidance: input.instruction,
    contextDocs: input.contextDocs,
    contextBudgetChars: input.budget.contextBudgetChars,
  });
  // Sized with a part note in place so a split call can never outgrow its plan.
  const promptShell = buildUserPrompt(input.recordLabel, keys, "", { index: 1, total: 1 });
  const roomTokens =
    extractionPromptCeiling(input.budget, keys.length) - estimateTokens(system) - estimateTokens(promptShell);
  return { system, roomTokens };
};

// Tokens left for document text in one extraction call.
export const documentRoomTokens = (input: DocumentRoomInput): number => sizeCall(input).roomTokens;

export const extractDocumentFields = async (
  languageModel: ILanguageModel,
  input: ExtractDocumentFieldsInput,
): Promise<Result<ExtractionFieldResult[]>> => {
  const hasReadableText = input.documentTexts.some((document) => document.text.trim().length > 0);
  if (!hasReadableText) return ok(unreadableResults(input.fields));

  const { system, roomTokens } = sizeCall({ ...input, budget: input.budget ?? DEFAULT_PROMPT_BUDGET });
  if (roomTokens < MIN_DOCUMENT_TOKENS_PER_PART) {
    return err(domainError("VALIDATION_FAILED", TOO_LARGE_MESSAGE));
  }

  const roomChars = roomTokens * DOCUMENT_GENERATION_CHARS_PER_TOKEN;
  const wholeSection = buildDocumentsSection(input.documentTexts, documentLabels(input.documentTexts));
  if (wholeSection.length <= roomChars) {
    return extractPart(languageModel, input, system, input.documentTexts, null);
  }

  const parts = planParts(input.documentTexts, roomChars);
  let merged: ExtractionFieldResult[] = [];
  for (const [offset, documentTexts] of parts.entries()) {
    const part = { index: offset + 1, total: parts.length };
    const extracted = await extractPart(languageModel, input, system, documentTexts, part);
    if (extracted.error) return extracted;
    merged = mergeFieldResults(merged, labelWithPart(extracted.data, part));
  }
  return ok(merged);
};

// One model call over one set of document texts — the whole record, or one part
// of it. Source references and verbatim checks resolve against this call's own
// texts, which is what the model was shown.
const extractPart = async (
  languageModel: ILanguageModel,
  input: ExtractDocumentFieldsInput,
  system: string,
  documentTexts: RecordDocumentText[],
  part: DocumentPart | null,
): Promise<Result<ExtractionFieldResult[]>> => {
  const keys = input.fields.map((field) => field.field.key);
  const labelByDocumentId = documentLabels(documentTexts);
  const prompt = buildUserPrompt(
    input.recordLabel,
    keys,
    buildDocumentsSection(documentTexts, labelByDocumentId),
    part,
  );

  const result = await languageModel.generateObject<ExtractionResultData>({
    purpose: "extractionFieldExtraction",
    userId: input.userId,
    flowId: input.flowId,
    system,
    prompt,
    // An explicit keyed schema (every field required) forces a complete result —
    // a free-form record let the model silently drop fields it was unsure of.
    schema: buildExtractionResultSchema(keys),
    maxTokens: extractionOutputBudget(keys.length),
  });
  if (result.error) return result;

  const object = result.data.object;
  // Keyed by id rather than flattened: a quote is verified against the document
  // the model named, since one that verifies against a different document of the
  // record establishes nothing about where this value came from.
  const textByDocumentId = new Map(
    documentTexts.map((document) => [document.documentId, document.text]),
  );
  const documentIdByLabel = invert(labelByDocumentId);

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
      field,
      textByDocumentId,
      resolveSourceRef(scored.sourceRef, documentIdByLabel),
    );
  });

  return ok(results);
};
