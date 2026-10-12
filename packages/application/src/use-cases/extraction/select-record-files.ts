import { domainError, err, ok, type ILanguageModel, type Result } from "@wayfinder/domain";
import { fileGroupingSchema, type FileGroupingData } from "@wayfinder/shared";
import { clampOutputBudget } from "./output-budget";

// A file offered to the grouping pass: its id, display name, preserved tree path
// (for folder criteria), and an optional lightweight content signal (headings /
// first-page text) for content criteria (ADR-033 §4a).
export interface SelectableFile {
  id: string;
  filename: string;
  treePath: string;
  contentSignal?: string;
}

export interface RecordGroup {
  label: string;
  fileIds: string[];
}

export interface FileGrouping {
  groups: RecordGroup[];
  // Files that matched no record — routed to the run's exceptions bucket, never
  // silently dropped (ADR-033 §4a).
  exceptionFileIds: string[];
}

export interface SelectRecordFilesInput {
  files: SelectableFile[];
  selectionCriteria: string;
}

// Under one-file-per-record the grouping pass is trivial: one record per file.
export const oneRecordPerFile = (files: SelectableFile[]): FileGrouping => ({
  groups: files.map((file) => ({ label: file.filename, fileIds: [file.id] })),
  exceptionFileIds: [],
});

const buildGroupingPrompt = (input: SelectRecordFilesInput): string => {
  const fileLines = input.files
    .map((file) => {
      const signal = file.contentSignal ? `\n    content: ${file.contentSignal}` : "";
      return `- id: ${file.id}\n    filename: ${file.filename}\n    path: ${file.treePath}${signal}`;
    })
    .join("\n");

  return [
    "Group the input files into records according to the selection criteria.",
    "A file may belong to more than one record when it genuinely informs several.",
    "Leave a file out of every record if it fits none — do not force it in.",
    `\nSelection criteria:\n${input.selectionCriteria}`,
    `\nInput files:\n${fileLines}`,
  ].join("\n");
};

// Each file id is echoed back inside a record, so the reply grows with the
// number of files.
const TOKENS_PER_FILE = 64;
const REPLY_OVERHEAD_TOKENS = 1024;

export const groupingOutputBudget = (fileCount: number): number =>
  clampOutputBudget(REPLY_OVERHEAD_TOKENS + TOKENS_PER_FILE * fileCount);

const GROUPING_FAILED_MESSAGE =
  "The AI model could not group the files into records — its reply was incomplete or not in the expected shape, twice. Try the run again; if it keeps failing, simplify the selection criteria or ask an administrator to check Admin → Errors.";

// A rejected grouping reply is usually a one-off (a cut-off or malformed tool
// call), and without a grouping the run cannot start at all, so the call is
// retried once before giving up. A quota refusal is final and is not retried.
const requestGrouping = async (
  languageModel: ILanguageModel,
  input: SelectRecordFilesInput,
): Promise<Result<{ object: FileGroupingData }>> => {
  const request = () =>
    languageModel.generateObject<FileGroupingData>({
      purpose: "extractionFileGrouping",
      system:
        "You group document files into records for a bulk extraction. Only ever reference the file ids you are given.",
      prompt: buildGroupingPrompt(input),
      schema: fileGroupingSchema,
      maxTokens: groupingOutputBudget(input.files.length),
    });

  const first = await request();
  if (!first.error || first.error.code !== "AI_PROVIDER_FAILED") return first;

  const second = await request();
  if (!second.error || second.error.code !== "AI_PROVIDER_FAILED") return second;
  return err(domainError("AI_PROVIDER_FAILED", GROUPING_FAILED_MESSAGE, second.error));
};

// Interprets the plain-English selection criteria to materialise records
// (ADR-033 §4a). Runs the decorated model, then post-processes best-effort:
// unknown file ids are dropped, empty records are removed, and any file in no
// kept record becomes an exception. Over-matching (a file in several records) is
// preserved deliberately.
export const selectRecordFiles = async (
  languageModel: ILanguageModel,
  input: SelectRecordFilesInput,
): Promise<Result<FileGrouping>> => {
  const result = await requestGrouping(languageModel, input);
  if (result.error) return result;

  const knownIds = new Set(input.files.map((file) => file.id));
  const assignedIds = new Set<string>();
  const groups: RecordGroup[] = [];

  for (const record of result.data.object.records) {
    const fileIds = record.fileIds.filter((id) => knownIds.has(id));
    if (fileIds.length === 0) continue;
    for (const id of fileIds) assignedIds.add(id);
    groups.push({ label: record.label, fileIds });
  }

  const exceptionFileIds = input.files
    .map((file) => file.id)
    .filter((id) => !assignedIds.has(id));

  return ok({ groups, exceptionFileIds });
};
