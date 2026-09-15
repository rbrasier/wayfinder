import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { FlowContextDoc } from "./flow";
import { parseTemplateField, type TemplateField } from "./template-field";

// Two documents/three is the synchronous sample size (phase §8); the full batch
// path lands in Phase 2. Kept here so the surface and the runner agree.
export const SAMPLE_MAX_DOCUMENTS = 3;

// The run control's preview flag defaults on above this many input files
// (ADR-033 §6 / phase §6). At or below it, preview defaults off.
export const PREVIEW_FILE_THRESHOLD = 5;

// How many input documents Auto Analyse may read when proposing a field set,
// and how many it reads unless the author says otherwise (ADR-059, ADR-060).
// Deliberately separate from SAMPLE_MAX_DOCUMENTS: that sizes a sample *run* —
// how many records an author previews before committing to a full batch — and
// has no business moving because the analysis read ceiling moved.
export const MAX_ANALYSE_DOCUMENTS = 10;
export const DEFAULT_ANALYSE_DOCUMENTS = 3;

export const shouldPreviewByDefault = (inputFileCount: number): boolean =>
  inputFileCount > PREVIEW_FILE_THRESHOLD;

// The unit of work (input document) is separated from the unit of output
// (record). Under one_per_file the two are 1:1; under many_per_record several
// files aggregate into one record via the selection/grouping pass (ADR-033 §4).
export type RecordCardinality = "one_per_file" | "many_per_record";

export type ExtractionOutputFormat = "docx" | "xlsx";

// One ordered field in the extraction schema: the parsed TemplateField
// annotation (the lingua franca — ADR-013) plus a plain-English instruction and
// an optional completion criterion.
export interface ExtractionField {
  field: TemplateField;
  instruction: string;
  doneWhen: string | null;
}

// Author-supplied field before parsing — the label, the annotation line
// (`Label (annotations)`), the extraction instruction, and an optional
// "done when".
export interface ExtractionFieldDraft {
  label: string;
  annotation: string;
  instruction: string;
  doneWhen: string | null;
}

export interface ExtractionInputConfig {
  cardinality: RecordCardinality;
  // Plain-English criteria describing which files form one record. Required for
  // many_per_record; must be null for one_per_file (ADR-033 §4a).
  selectionCriteria: string | null;
  guidance: string;
  // Whether uploading documents drafts the field set automatically (ADR-059).
  // Optional on the way in so no existing author config has to be rewritten;
  // parseExtractionSchema always returns it populated. Read it through
  // isAutoAnalyseOn rather than defaulting at each call site.
  autoAnalyse?: boolean;
  // How many documents one analysis reads, within MAX_ANALYSE_DOCUMENTS. Same
  // optional-in/populated-out contract as autoAnalyse; read it through
  // analyseDocumentCount.
  analyseSampleSize?: number;
}

// Absent means "on" only where turning it on changes nothing. A config already
// describing the manual grouping path was authored before this setting existed,
// and defaulting it on would silently discard its cardinality and criteria —
// so absence is read as off there. An explicit value always wins.
export const isAutoAnalyseOn = (input: ExtractionInputConfig): boolean => {
  if (input.autoAnalyse !== undefined) return input.autoAnalyse;

  const hasManualGrouping =
    input.cardinality === "many_per_record" ||
    (input.selectionCriteria?.trim().length ?? 0) > 0;
  return !hasManualGrouping;
};

export const analyseDocumentCount = (input: ExtractionInputConfig): number =>
  input.analyseSampleSize ?? DEFAULT_ANALYSE_DOCUMENTS;

export interface ExtractionOutputConfig {
  format: ExtractionOutputFormat;
  outputTemplate: FlowContextDoc | null;
  instruction: string;
  generateSummary: boolean;
  summaryTemplate: FlowContextDoc | null;
  contextDocs: FlowContextDoc[];
}

// The extraction authoring config that lives inside the FlowSnapshot jsonb
// (ADR-033 §3) — no new authoring tables.
export interface ExtractionSchema {
  fields: ExtractionField[];
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
}

export interface ExtractionSchemaDraft {
  fields: ExtractionFieldDraft[];
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
}

export const extractionFieldKey = (field: ExtractionField): string => field.field.key;

export const buildExtractionField = (draft: ExtractionFieldDraft): Result<ExtractionField> => {
  const instruction = draft.instruction.trim();
  if (instruction.length === 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Extraction field "${draft.label}" needs a plain-English instruction telling the AI what to pull.`,
      ),
    );
  }

  const parsed = parseTemplateField(draft.annotation);
  if (parsed.error) return parsed;

  const doneWhen = draft.doneWhen?.trim();
  return ok({
    field: parsed.data,
    instruction,
    doneWhen: doneWhen && doneWhen.length > 0 ? doneWhen : null,
  });
};

const validateInputConfig = (input: ExtractionInputConfig): Result<ExtractionInputConfig> => {
  const criteria = input.selectionCriteria?.trim() ?? "";
  const autoAnalyse = isAutoAnalyseOn(input);
  const analyseSampleSize = analyseDocumentCount(input);

  // Checked whether or not auto analyse is currently on, so a bad value cannot
  // sit dormant in the config and surface the moment the author toggles it back.
  if (
    !Number.isInteger(analyseSampleSize) ||
    analyseSampleSize < 1 ||
    analyseSampleSize > MAX_ANALYSE_DOCUMENTS
  ) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Auto analyse reads between 1 and ${MAX_ANALYSE_DOCUMENTS} documents; ${analyseSampleSize} is outside that range.`,
      ),
    );
  }

  // Auto analyse owns the input questions it hides: it always means one file per
  // record, so criteria left over from a manual config are cleared rather than
  // rejected (ADR-059). The manual rules below apply only when it is off.
  if (autoAnalyse) {
    return ok({
      cardinality: "one_per_file",
      selectionCriteria: null,
      guidance: input.guidance.trim(),
      autoAnalyse: true,
      analyseSampleSize,
    });
  }

  if (input.cardinality === "many_per_record" && criteria.length === 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "Many-files-per-record needs plain-English selection criteria describing which files make up one record.",
      ),
    );
  }

  if (input.cardinality === "one_per_file" && criteria.length > 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "One-file-per-record does not use selection criteria — each file is its own record.",
      ),
    );
  }

  return ok({
    cardinality: input.cardinality,
    selectionCriteria: input.cardinality === "many_per_record" ? criteria : null,
    guidance: input.guidance.trim(),
    autoAnalyse: false,
    analyseSampleSize,
  });
};

const normaliseOutputConfig = (output: ExtractionOutputConfig): ExtractionOutputConfig => ({
  format: output.format,
  outputTemplate: output.outputTemplate,
  instruction: output.instruction.trim(),
  generateSummary: output.generateSummary,
  // A summary template is meaningless when summary generation is off.
  summaryTemplate: output.generateSummary ? output.summaryTemplate : null,
  contextDocs: output.contextDocs,
});

export const parseExtractionSchema = (draft: ExtractionSchemaDraft): Result<ExtractionSchema> => {
  if (draft.fields.length === 0) {
    return err(
      domainError("VALIDATION_FAILED", "An extraction flow needs at least one field to pull."),
    );
  }

  const fields: ExtractionField[] = [];
  const seenKeys = new Set<string>();
  for (const fieldDraft of draft.fields) {
    const built = buildExtractionField(fieldDraft);
    if (built.error) return built;

    const key = built.data.field.key;
    if (seenKeys.has(key)) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Two fields resolve to the duplicate key "${key}". Give each field a distinct name.`,
        ),
      );
    }
    seenKeys.add(key);
    fields.push(built.data);
  }

  const input = validateInputConfig(draft.input);
  if (input.error) return input;

  return ok({ fields, input: input.data, output: normaliseOutputConfig(draft.output) });
};

// The TemplateField[] the extraction/grading calls consume — the schema's fields
// carry their annotations directly.
export const extractionTemplateFields = (schema: ExtractionSchema): TemplateField[] =>
  schema.fields.map((field) => field.field);
