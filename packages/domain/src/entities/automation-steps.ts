import { deriveStepKeys } from "./approval-record";
import type { AiTaskNodeConfig, EmailNodeConfig } from "./flow-node";

export const DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD = 80;

export const aiTaskConfidenceThresholdOf = (config: AiTaskNodeConfig): number =>
  typeof config.confidenceThreshold === "number"
    ? config.confidenceThreshold
    : DEFAULT_AI_TASK_CONFIDENCE_THRESHOLD;

export const meetsConfidenceThreshold = (confidence: number, threshold: number): boolean =>
  confidence >= threshold;

const isBlank = (value: string | undefined | null): boolean => !value || value.trim().length === 0;

const reviewerIsComplete = (config: AiTaskNodeConfig): boolean => {
  if (config.reviewer?.mode === "user") return !isBlank(config.reviewer.userId);
  return config.reviewer !== undefined;
};

// Which part of the step editor a problem belongs to, so the editor can show
// it beside that field rather than in a list the author has to match up.
export type AiTaskProblemField = "instruction" | "inputs" | "outputs" | "threshold" | "reviewer";

export interface StepProblem<Field extends string> {
  field: Field;
  message: string;
}

// What an AI task is handed besides its instruction (ADR-065 §3): everything the
// run knows — trigger inputs, the payload it started with and every earlier
// step's output — or only the values the author picked.
export type AiTaskInputMode = "all" | "selected";

// A config saved before the mode existed picked its inputs if it listed any.
export const aiTaskInputModeOf = (config: AiTaskNodeConfig): AiTaskInputMode =>
  config.inputMode ?? ((config.inputFields ?? []).length > 0 ? "selected" : "all");

// Problems an author must fix before an AI task can run, in the order the editor
// shows them. Empty means runnable.
export const validateAiTaskNodeConfig = (config: AiTaskNodeConfig): StepProblem<AiTaskProblemField>[] => {
  const problems: StepProblem<AiTaskProblemField>[] = [];
  if (isBlank(config.instruction)) problems.push({ field: "instruction", message: "Add an instruction for the AI task." });
  if ((config.structuredFields ?? []).length === 0) {
    problems.push({ field: "outputs", message: "Add at least one output field." });
  }
  const threshold = aiTaskConfidenceThresholdOf(config);
  if (threshold < 0 || threshold > 100) {
    problems.push({ field: "threshold", message: "The confidence threshold must be between 0 and 100." });
  }
  if (!reviewerIsComplete(config)) {
    problems.push({ field: "reviewer", message: "Choose who reviews low-confidence results." });
  }
  return problems;
};

const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

// An empty allow-list means any domain. A listed domain matches exactly, never as
// a suffix, so `evilagency.gov.au` cannot pass for `agency.gov.au`.
export const isEmailAddressAllowed = (email: string, allowedDomains: readonly string[]): boolean => {
  const match = EMAIL_PATTERN.exec(email.trim());
  if (!match) return false;
  if (allowedDomains.length === 0) return true;
  const domain = match[1]!.toLowerCase();
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
};

export type EmailProblemField = "recipients" | "subject" | "body";

export const validateEmailNodeConfig = (
  config: EmailNodeConfig,
  allowedDomains: readonly string[],
): StepProblem<EmailProblemField>[] => {
  const problems: StepProblem<EmailProblemField>[] = [];
  if ((config.recipients ?? []).length === 0) {
    problems.push({ field: "recipients", message: "Add at least one recipient." });
  }
  if (isBlank(config.subjectTemplate)) problems.push({ field: "subject", message: "Add a subject." });
  if (isBlank(config.bodyTemplate)) problems.push({ field: "body", message: "Add a message body." });
  for (const recipient of config.recipients ?? []) {
    if (recipient.kind !== "address") continue;
    if (!isEmailAddressAllowed(recipient.email, allowedDomains)) {
      problems.push({ field: "recipients", message: `${recipient.email} is not on an allowed email domain.` });
    }
  }
  return problems;
};

export interface MessageTemplateValues {
  inputs: Record<string, string>;
  // Keyed by step key (see `flowStepKeys`), then field key.
  steps: Record<string, Record<string, string>>;
}

// The scope trigger inputs are read from; no step is ever given this key.
export const TRIGGER_INPUT_SCOPE = "input";

// Each step's key as an Email template names it — `{{ <step_key>.<field> }}` —
// derived the way approval records name their steps (ADR-040 §5): the snake_cased
// step name, suffixed `_2`, `_3`… when names repeat. Repeats are settled by node
// id, the one order the canvas and a published version's snapshot (which keeps
// neither creation times nor a stable node order) both see the same.
export const flowStepKeys = (nodes: readonly { id: string; name: string }[]): Map<string, string> => {
  const ordered = [...nodes].sort((first, second) => first.id.localeCompare(second.id));
  const keys = deriveStepKeys(
    ordered.map((node) => node.name),
    [TRIGGER_INPUT_SCOPE],
  );
  return new Map(ordered.map((node, index) => [node.id, keys[index]!]));
};

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_-]+)\s*\}\}/g;

const lookupPlaceholder = (scope: string, key: string, values: MessageTemplateValues): string => {
  if (scope === TRIGGER_INPUT_SCOPE) return values.inputs[key] ?? "";
  return values.steps[scope]?.[key] ?? "";
};

// Fills an Email step's subject or body. An unknown placeholder renders blank
// rather than leaking the raw `{{ … }}` into a sent message.
export const renderMessageTemplate = (template: string, values: MessageTemplateValues): string =>
  template.replace(PLACEHOLDER, (_match, scope: string, key: string) =>
    lookupPlaceholder(scope, key, values),
  );

// The HTML part of an Email step's message. The whole rendered text is escaped —
// author template and AI output alike — so nothing in either can become markup;
// blank lines become paragraphs and single newlines line breaks.

