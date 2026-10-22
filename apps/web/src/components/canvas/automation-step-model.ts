import {
  DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
  validateAiTaskNodeConfig,
  validateEmailNodeConfig,
  type AiTaskNodeConfig,
  type AiTaskReviewer,
  type EmailNodeConfig,
  type FieldValueSource,
  type McpToolRef,
  type PriorStepField,
  type TemplateField,
  type TriggerInput,
} from "@rbrasier/domain";
import { parseFieldLines } from "./template-field-editor";

// The AI task and Email step editors' form state, and its mapping to and from
// the stored node config. Pure, so the editors stay thin and this is testable.

// One value handed to the AI: a name for it and where it comes from, chosen
// from earlier steps' fields the way a scheduled step picks its values.
export interface AiTaskInputRow {
  label: string;
  source: FieldValueSource;
}

export interface AiTaskForm {
  instruction: string;
  inputs: AiTaskInputRow[];
  outputLines: string[];
  confidenceThreshold: number;
  reviewer: AiTaskReviewer;
  skillRefs: string[];
  allowedMcpToolRefs: McpToolRef[];
}

const readFields = (value: unknown): TemplateField[] =>
  Array.isArray(value) ? (value as TemplateField[]) : [];

const readStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const aiTaskFormFromConfig = (config: Record<string, unknown>): AiTaskForm => {
  const sources = (config.inputFieldValues as Record<string, FieldValueSource> | undefined) ?? {};
  return {
    instruction: typeof config.instruction === "string" ? config.instruction : "",
    inputs: readFields(config.inputFields).map((field) => ({
      label: field.label,
      source: sources[field.key] ?? { kind: "ai" },
    })),
    outputLines: readFields(config.structuredFields).map((field) => field.raw),
    confidenceThreshold:
      typeof config.confidenceThreshold === "number"
        ? config.confidenceThreshold
        : DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
    reviewer: (config.reviewer as AiTaskReviewer | undefined) ?? { mode: "run_owner" },
    skillRefs: readStrings(config.skillRefs),
    allowedMcpToolRefs: Array.isArray(config.allowedMcpToolRefs) ? (config.allowedMcpToolRefs as McpToolRef[]) : [],
  };
};

// What an input is called by default: the name of the field it reads.
export const inputLabelFor = (
  source: FieldValueSource,
  priorStepFields: PriorStepField[],
  triggerInputs: TriggerInput[],
): string => {
  if (source.kind === "step_field") {
    const prior = priorStepFields.find(
      (candidate) => candidate.nodeId === source.nodeId && candidate.field.key === source.fieldKey,
    );
    return prior?.field.label ?? "";
  }
  if (source.kind === "trigger_input") {
    return triggerInputs.find((input) => input.key === source.inputKey)?.label ?? source.inputKey;
  }
  return "";
};

const keyFor = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "input";

// Each input becomes a declared text field keyed from its name, so the stored
// config keeps the shape the run reads (inputFields plus their sources).
const inputFieldsFrom = (rows: AiTaskInputRow[]) => {
  const used = new Map<string, number>();
  const fields: TemplateField[] = [];
  const values: Record<string, FieldValueSource> = {};
  for (const row of rows) {
    const base = keyFor(row.label);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const key = count === 1 ? base : `${base}_${count}`;
    const label = row.label.trim();
    fields.push({ key, label, type: "text", optional: false, raw: label });
    values[key] = row.source;
  }
  return { fields, values };
};

export const aiTaskConfigFromForm = (
  form: AiTaskForm,
): { config: AiTaskNodeConfig; problems: string[] } => {
  const inputs = inputFieldsFrom(form.inputs);
  const outputs = parseFieldLines(form.outputLines, { disallowSection: true });
  const config: AiTaskNodeConfig = {
    instruction: form.instruction,
    inputFields: inputs.fields,
    inputFieldValues: inputs.values,
    outputType: "structured",
    structuredFields: outputs.fields,
    confidenceThreshold: form.confidenceThreshold,
    reviewer: form.reviewer,
    skillRefs: form.skillRefs,
    allowedMcpToolRefs: form.allowedMcpToolRefs,
  };
  const problems = [
    ...(form.inputs.some((row) => row.label.trim() === "") ? ["Name every input."] : []),
    ...(outputs.valid ? [] : ["Fix the highlighted output fields."]),
    ...validateAiTaskNodeConfig(config),
  ];
  return { config, problems };
};

export type EmailForm = EmailNodeConfig;

export const emailFormFromConfig = (config: Record<string, unknown> | EmailNodeConfig): EmailForm => {
  const source = config as Partial<EmailNodeConfig>;
  return {
    recipients: source.recipients ?? [],
    subjectTemplate: source.subjectTemplate ?? "",
    bodyTemplate: source.bodyTemplate ?? "",
    attachStepIds: source.attachStepIds ?? [],
  };
};

export const emailConfigFromForm = (
  form: EmailForm,
  allowedDomains: readonly string[],
): { config: EmailNodeConfig; problems: string[] } => ({
  config: form,
  problems: validateEmailNodeConfig(form, allowedDomains),
});

export interface PlaceholderOption {
  label: string;
  token: string;
}

// What the Email editor's "Insert field" menu offers: one token per field an
// earlier step declares, in the syntax `renderMessageTemplate` reads.
export const placeholderOptions = (priorStepFields: PriorStepField[]): PlaceholderOption[] =>
  priorStepFields.map((prior) => ({
    label: `${prior.stepLabel} → ${prior.field.label}`,
    token: `{{ step.${prior.nodeId}.${prior.field.key} }}`,
  }));
