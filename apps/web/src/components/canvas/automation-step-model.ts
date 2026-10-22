import {
  DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
  validateAiTaskNodeConfig,
  validateEmailNodeConfig,
  type AiTaskNodeConfig,
  type AiTaskReviewer,
  type EmailNodeConfig,
  type FieldValueSource,
  type PriorStepField,
  type TemplateField,
} from "@rbrasier/domain";
import { parseFieldLines } from "./template-field-editor";

// The AI task and Email step editors' form state, and its mapping to and from
// the stored node config. Pure, so the editors stay thin and this is testable.

export interface AiTaskForm {
  instruction: string;
  inputLines: string[];
  inputFieldValues: Record<string, FieldValueSource>;
  outputLines: string[];
  confidenceThreshold: number;
  reviewer: AiTaskReviewer;
}

const readFields = (value: unknown): TemplateField[] =>
  Array.isArray(value) ? (value as TemplateField[]) : [];

export const aiTaskFormFromConfig = (config: Record<string, unknown>): AiTaskForm => ({
  instruction: typeof config.instruction === "string" ? config.instruction : "",
  inputLines: readFields(config.inputFields).map((field) => field.raw),
  inputFieldValues: (config.inputFieldValues as Record<string, FieldValueSource> | undefined) ?? {},
  outputLines: readFields(config.structuredFields).map((field) => field.raw),
  confidenceThreshold:
    typeof config.confidenceThreshold === "number"
      ? config.confidenceThreshold
      : DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
  reviewer: (config.reviewer as AiTaskReviewer | undefined) ?? { mode: "run_owner" },
});

export const aiTaskConfigFromForm = (
  form: AiTaskForm,
): { config: AiTaskNodeConfig; problems: string[] } => {
  const inputs = parseFieldLines(form.inputLines);
  const outputs = parseFieldLines(form.outputLines, { disallowSection: true });
  const inputKeys = new Set(inputs.fields.map((field) => field.key));
  const config: AiTaskNodeConfig = {
    instruction: form.instruction,
    inputFields: inputs.fields,
    inputFieldValues: Object.fromEntries(
      Object.entries(form.inputFieldValues).filter(([key]) => inputKeys.has(key)),
    ),
    outputType: "structured",
    structuredFields: outputs.fields,
    confidenceThreshold: form.confidenceThreshold,
    reviewer: form.reviewer,
  };
  const problems = [
    ...(inputs.valid ? [] : ["Fix the highlighted input fields."]),
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
