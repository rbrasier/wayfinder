import {
  DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
  SUGGESTED_AI_TASK_REVIEW_THRESHOLD,
  aiTaskInputModeOf,
  validateAiTaskNodeConfig,
  validateEmailNodeConfig,
  type AiTaskNodeConfig,
  type AiTaskProblemField,
  type AiTaskReviewer,
  type EmailNodeConfig,
  type EmailProblemField,
  type FieldValueSource,
  type McpToolRef,
  type PriorStepField,
  type StepProblem,
  type TemplateField,
  TRIGGER_INPUT_SCOPE,
  type TriggerInput,
} from "@rbrasier/domain";
import { fieldLineError, parseFieldLines } from "./template-field-editor";

// The AI task and Email step editors' form state, and its mapping to and from
// the stored node config. Pure, so the editors stay thin and this is testable.

// One value handed to the AI when the step does not accept all inputs: an
// earlier step's field or a trigger input, picked from a dropdown the way a
// scheduled step picks its anchor. It is named after the field it reads.
export type AiTaskInputSource = Extract<
  FieldValueSource,
  { kind: "step_field" } | { kind: "trigger_input" }
>;

export interface AiTaskForm {
  instruction: string;
  acceptAllInputs: boolean;
  inputs: AiTaskInputSource[];
  outputLines: string[];
  confidenceThreshold: number;
  reviewer: AiTaskReviewer;
  skillRefs: string[];
  allowedMcpToolRefs: McpToolRef[];
}

// A problem shown above the editor field it belongs to; `outputRow` points at
// the output field row that is wrong.
export interface AiTaskEditorProblem extends StepProblem<AiTaskProblemField> {
  outputRow?: number;
}

export interface AiTaskEditorContext {
  priorStepFields: PriorStepField[];
  triggerInputs: TriggerInput[];
}

const readFields = (value: unknown): TemplateField[] =>
  Array.isArray(value) ? (value as TemplateField[]) : [];

const readStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const isInputSource = (source: FieldValueSource | undefined): source is AiTaskInputSource =>
  source?.kind === "step_field" || source?.kind === "trigger_input";

export const aiTaskFormFromConfig = (config: Record<string, unknown>): AiTaskForm => {
  const sources = (config.inputFieldValues as Record<string, FieldValueSource> | undefined) ?? {};
  return {
    instruction: typeof config.instruction === "string" ? config.instruction : "",
    acceptAllInputs: aiTaskInputModeOf(config as unknown as AiTaskNodeConfig) === "all",
    inputs: readFields(config.inputFields)
      .map((field) => sources[field.key])
      .filter(isInputSource),
    // A config written outside this editor may omit `raw`; the label is the
    // closest line that still parses.
    outputLines: readFields(config.structuredFields).map((field) => field.raw ?? field.label),
    confidenceThreshold:
      typeof config.confidenceThreshold === "number"
        ? config.confidenceThreshold
        : DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD,
    reviewer: (config.reviewer as AiTaskReviewer | undefined) ?? { mode: "run_owner" },
    skillRefs: readStrings(config.skillRefs),
    allowedMcpToolRefs: Array.isArray(config.allowedMcpToolRefs)
      ? (config.allowedMcpToolRefs as McpToolRef[])
      : [],
  };
};

// Review is opt-in: a threshold of 0 lets every result through, so any higher
// threshold means the author asked for low-confidence results to be reviewed.
export const aiTaskReviewEnabled = (form: AiTaskForm): boolean => form.confidenceThreshold > 0;

export const withAiTaskReview = (form: AiTaskForm, enabled: boolean): AiTaskForm => {
  if (!enabled) return { ...form, confidenceThreshold: 0 };
  return aiTaskReviewEnabled(form) ? form : { ...form, confidenceThreshold: SUGGESTED_AI_TASK_REVIEW_THRESHOLD };
};

const labelFor = (source: AiTaskInputSource, context: AiTaskEditorContext): string => {
  if (source.kind === "trigger_input") {
    return (
      context.triggerInputs.find((input) => input.key === source.inputKey)?.label || source.inputKey
    );
  }
  const prior = context.priorStepFields.find(
    (candidate) => candidate.nodeId === source.nodeId && candidate.field.key === source.fieldKey,
  );
  return prior?.field.label ?? source.fieldKey;
};

const keyFor = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "input";

// Each picked input becomes a declared text field keyed from its name, so the
// stored config keeps the shape the run reads (inputFields plus their sources).
const inputFieldsFrom = (sources: AiTaskInputSource[], context: AiTaskEditorContext) => {
  const used = new Map<string, number>();
  const fields: TemplateField[] = [];
  const values: Record<string, FieldValueSource> = {};
  for (const source of sources) {
    const label = labelFor(source, context);
    const base = keyFor(label);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const key = count === 1 ? base : `${base}_${count}`;
    fields.push({ key, label, type: "text", optional: false, raw: label });
    values[key] = source;
  }
  return { fields, values };
};

const FIELD_ORDER: AiTaskProblemField[] = [
  "instruction",
  "inputs",
  "outputs",
  "threshold",
  "reviewer",
];

export const aiTaskConfigFromForm = (
  form: AiTaskForm,
  context: AiTaskEditorContext,
): { config: AiTaskNodeConfig; problems: AiTaskEditorProblem[] } => {
  const inputs = form.acceptAllInputs
    ? { fields: [], values: {} }
    : inputFieldsFrom(form.inputs, context);
  const outputs = parseFieldLines(form.outputLines, { disallowSection: true });
  const config: AiTaskNodeConfig = {
    instruction: form.instruction,
    inputMode: form.acceptAllInputs ? "all" : "selected",
    inputFields: inputs.fields,
    inputFieldValues: inputs.values,
    outputType: "structured",
    structuredFields: outputs.fields,
    confidenceThreshold: form.confidenceThreshold,
    reviewer: form.reviewer,
    skillRefs: form.skillRefs,
    allowedMcpToolRefs: form.allowedMcpToolRefs,
  };
  const rowProblems = form.outputLines.flatMap((line, outputRow): AiTaskEditorProblem[] => {
    const message = fieldLineError(line, true);
    return message ? [{ field: "outputs", outputRow, message }] : [];
  });
  const problems: AiTaskEditorProblem[] = [
    ...(!form.acceptAllInputs && form.inputs.length === 0
      ? [{ field: "inputs" as const, message: "Pick at least one input, or accept all inputs." }]
      : []),
    ...rowProblems,
    // A row that is wrong is reported on the row; "add at least one" would
    // only repeat it.
    ...validateAiTaskNodeConfig(config).filter(
      (problem) => !(problem.field === "outputs" && rowProblems.length > 0),
    ),
  ];
  problems.sort(
    (first, second) => FIELD_ORDER.indexOf(first.field) - FIELD_ORDER.indexOf(second.field),
  );
  return { config, problems };
};

export interface InputOptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

export const inputSourceValue = (source: AiTaskInputSource): string =>
  source.kind === "trigger_input"
    ? `input:${source.inputKey}`
    : `step:${source.nodeId}:${source.fieldKey}`;

export const inputSourceFrom = (value: string): AiTaskInputSource | null => {
  const [scope, ...rest] = value.split(":");
  if (scope === "input" && rest.length === 1 && rest[0])
    return { kind: "trigger_input", inputKey: rest[0] };
  if (scope === "step" && rest.length === 2 && rest[0] && rest[1]) {
    return { kind: "step_field", nodeId: rest[0], fieldKey: rest[1] };
  }
  return null;
};

// The choices for one picked input, laid out like the scheduled step's anchor
// dropdown: trigger inputs first, then each earlier step's fields under it.
export const aiTaskInputOptions = (
  priorStepFields: PriorStepField[],
  triggerInputs: TriggerInput[],
): InputOptionGroup[] => {
  const groups: InputOptionGroup[] = [];
  if (triggerInputs.length > 0) {
    groups.push({
      label: "Trigger inputs",
      options: triggerInputs.map((input) => ({
        value: inputSourceValue({ kind: "trigger_input", inputKey: input.key }),
        label: `${input.label || input.key} (${input.type})`,
      })),
    });
  }
  for (const prior of priorStepFields) {
    let group = groups.find((candidate) => candidate.label === prior.stepLabel);
    if (!group) {
      group = { label: prior.stepLabel, options: [] };
      groups.push(group);
    }
    group.options.push({
      value: inputSourceValue({
        kind: "step_field",
        nodeId: prior.nodeId,
        fieldKey: prior.field.key,
      }),
      label: `${prior.stepLabel} — ${prior.field.label} (${prior.field.type})`,
    });
  }
  return groups;
};

export type EmailForm = EmailNodeConfig;

export const emailFormFromConfig = (
  config: Record<string, unknown> | EmailNodeConfig,
): EmailForm => {
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
): { config: EmailNodeConfig; problems: StepProblem<EmailProblemField>[] } => ({
  config: form,
  problems: validateEmailNodeConfig(form, allowedDomains),
});

export interface PlaceholderOption {
  label: string;
  token: string;
}

// What the Email editor's "Insert field" menu offers: the flow's trigger
// inputs, then one token per field an earlier step declares, named by the step
// keys `flowStepKeys` gives — the syntax `renderMessageTemplate` reads.
export const placeholderOptions = (
  priorStepFields: PriorStepField[],
  triggerInputs: TriggerInput[],
  stepKeys: ReadonlyMap<string, string>,
): PlaceholderOption[] => [
  ...triggerInputs.map((input) => ({
    label: `Trigger input → ${input.label || input.key}`,
    token: `{{ ${TRIGGER_INPUT_SCOPE}.${input.key} }}`,
  })),
  ...priorStepFields.flatMap((prior) => {
    const stepKey = stepKeys.get(prior.nodeId);
    if (!stepKey) return [];
    return [
      {
        label: `${prior.stepLabel} → ${prior.field.label}`,
        token: `{{ ${stepKey}.${prior.field.key} }}`,
      },
    ];
  }),
];
