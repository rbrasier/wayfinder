import type {
  DocumentSplitEstimate,
  ExtractionDraftDocument,
  ExtractionPromptBudget,
  ExtractionSchema,
  FlowContextDoc,
  RunFitEstimate,
} from "@wayfinder/domain";
import { DOCUMENT_GENERATION_CHARS_PER_TOKEN } from "@wayfinder/shared";
import {
  documentRoomTokens,
  MIN_DOCUMENT_TOKENS_PER_PART,
  SEGMENT_LABEL_OVERHEAD_CHARS,
} from "./extract-document-fields";

export interface EstimateRunFitInput {
  schema: ExtractionSchema;
  documents: ExtractionDraftDocument[];
  budget: ExtractionPromptBudget;
  summaryRecordCap: number;
}

const contextChars = (contextDocs: FlowContextDoc[]): number =>
  contextDocs.reduce(
    (total, doc) =>
      doc.extractionStatus === "complete" && doc.extractedText ? total + doc.extractedText.length : total,
    0,
  );

// The longest label is the worst case for every document's call, so one sizing
// covers the whole intake.
const longestFilename = (documents: ExtractionDraftDocument[]): string =>
  documents.reduce((longest, document) => (document.filename.length > longest.length ? document.filename : longest), "");

const splitEstimates = (documents: ExtractionDraftDocument[], roomChars: number): DocumentSplitEstimate[] =>
  documents.flatMap((document) => {
    if (document.textLength === null) return [];
    const parts = Math.ceil((document.textLength + document.filename.length + SEGMENT_LABEL_OVERHEAD_CHARS) / roomChars);
    return parts > 1 ? [{ documentId: document.id, filename: document.filename, parts }] : [];
  });

// Only under one-file-per-record is the record count known before a run; under
// grouping it depends on a model pass that has not happened yet.
const summaryCoverage = (
  schema: ExtractionSchema,
  documentCount: number,
  cap: number,
): RunFitEstimate["summaryCoverage"] => {
  if (!schema.output.generateSummary || schema.input.cardinality !== "one_per_file") return null;
  return documentCount > cap ? { read: cap, total: documentCount } : null;
};

// Sizes a run from the staged documents' recorded text lengths before anything
// is sent to a model (issue #335), using the same sizing the extraction call
// itself applies.
export const estimateRunFit = (input: EstimateRunFitInput): RunFitEstimate => {
  const roomTokens = documentRoomTokens({
    fields: input.schema.fields,
    instruction: input.schema.input.guidance,
    contextDocs: input.schema.output.contextDocs,
    recordLabel: longestFilename(input.documents),
    budget: input.budget,
  });
  const blocking = roomTokens < MIN_DOCUMENT_TOKENS_PER_PART;

  return {
    blocking,
    documentsToSplit: blocking ? [] : splitEstimates(input.documents, roomTokens * DOCUMENT_GENERATION_CHARS_PER_TOKEN),
    unknownSizeCount: input.documents.filter((document) => document.textLength === null).length,
    contextTruncated: contextChars(input.schema.output.contextDocs) > input.budget.contextBudgetChars,
    summaryCoverage: summaryCoverage(input.schema, input.documents.length, input.summaryRecordCap),
  };
};
