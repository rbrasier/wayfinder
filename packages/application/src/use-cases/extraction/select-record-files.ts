import { ok, type ILanguageModel, type Result } from "@rbrasier/domain";
import { fileGroupingSchema, type FileGroupingData } from "@rbrasier/shared";

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

// Interprets the plain-English selection criteria to materialise records
// (ADR-033 §4a). Runs the decorated model, then post-processes best-effort:
// unknown file ids are dropped, empty records are removed, and any file in no
// kept record becomes an exception. Over-matching (a file in several records) is
// preserved deliberately.
export const selectRecordFiles = async (
  languageModel: ILanguageModel,
  input: SelectRecordFilesInput,
): Promise<Result<FileGrouping>> => {
  const result = await languageModel.generateObject<FileGroupingData>({
    purpose: "extractionFileGrouping",
    system:
      "You group document files into records for a bulk extraction. Only ever reference the file ids you are given.",
    prompt: buildGroupingPrompt(input),
    schema: fileGroupingSchema,
    temperature: 0.2,
  });
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
