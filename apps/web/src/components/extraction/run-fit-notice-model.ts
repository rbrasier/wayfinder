import type { DocumentSplitEstimate, RunFitEstimate } from "@wayfinder/domain";

export interface RunFitNotice {
  // "block" stops the run from starting; "note" is a heads-up only.
  tone: "block" | "note";
  message: string;
}

const BLOCKING_MESSAGE =
  "This flow's instructions and context material are too large for the model on their own, so no document can be read. Remove or shorten context documents, or ask an admin to raise the extraction limits.";

const CONTEXT_TRUNCATED_MESSAGE =
  "The context material is longer than the extraction budget allows, so the end of it will be left out.";

const splitMessage = (documents: DocumentSplitEstimate[]): string => {
  const [only] = documents;
  if (documents.length === 1 && only) {
    return `${only.filename} is larger than one model call and will be read in about ${only.parts} parts.`;
  }
  const mostParts = Math.max(...documents.map((document) => document.parts));
  return `${documents.length} documents are larger than one model call and will be read in parts (up to about ${mostParts} each).`;
};

const unknownSizeMessage = (count: number): string =>
  count === 1
    ? "1 document was uploaded before sizes were recorded, so it is not part of this check. Re-upload it to include it."
    : `${count} documents were uploaded before sizes were recorded, so they are not part of this check. Re-upload them to include them.`;

// The pre-run notices for the run setup (issue #335). A blocking estimate shows
// only its own notice: nothing else matters until the run can start at all.
export const runFitNotices = (estimate: RunFitEstimate | null): RunFitNotice[] => {
  if (!estimate) return [];
  if (estimate.blocking) return [{ tone: "block", message: BLOCKING_MESSAGE }];

  const notices: RunFitNotice[] = [];
  if (estimate.documentsToSplit.length > 0) {
    notices.push({ tone: "note", message: splitMessage(estimate.documentsToSplit) });
  }
  if (estimate.contextTruncated) notices.push({ tone: "note", message: CONTEXT_TRUNCATED_MESSAGE });
  if (estimate.summaryCoverage) {
    const { read, total } = estimate.summaryCoverage;
    notices.push({ tone: "note", message: `The run summary will read the first ${read} of ${total} records.` });
  }
  if (estimate.unknownSizeCount > 0) {
    notices.push({ tone: "note", message: unknownSizeMessage(estimate.unknownSizeCount) });
  }
  return notices;
};
