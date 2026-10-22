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

// Problems an author must fix before an AI task can run, in the order the editor
// shows them. Empty means runnable.
export const validateAiTaskNodeConfig = (config: AiTaskNodeConfig): string[] => {
  const problems: string[] = [];
  if (isBlank(config.instruction)) problems.push("Add an instruction for the AI task.");
  if ((config.structuredFields ?? []).length === 0) problems.push("Add at least one output field.");
  const threshold = aiTaskConfidenceThresholdOf(config);
  if (threshold < 0 || threshold > 100) {
    problems.push("The confidence threshold must be between 0 and 100.");
  }
  if (!reviewerIsComplete(config)) problems.push("Choose who reviews low-confidence results.");
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

export const validateEmailNodeConfig = (
  config: EmailNodeConfig,
  allowedDomains: readonly string[],
): string[] => {
  const problems: string[] = [];
  if ((config.recipients ?? []).length === 0) problems.push("Add at least one recipient.");
  if (isBlank(config.subjectTemplate)) problems.push("Add a subject.");
  if (isBlank(config.bodyTemplate)) problems.push("Add a message body.");
  for (const recipient of config.recipients ?? []) {
    if (recipient.kind !== "address") continue;
    if (!isEmailAddressAllowed(recipient.email, allowedDomains)) {
      problems.push(`${recipient.email} is not on an allowed email domain.`);
    }
  }
  return problems;
};

export interface MessageTemplateValues {
  inputs: Record<string, string>;
  // Keyed by node id, then field key.
  steps: Record<string, Record<string, string>>;
}

const PLACEHOLDER = /\{\{\s*(input|step)\.([^\s}]+)\s*\}\}/g;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const lookupPlaceholder = (scope: string, path: string, values: MessageTemplateValues): string => {
  if (scope === "input") return values.inputs[path] ?? "";
  // A node id is a uuid, so the field key is everything after its last dot.
  const separator = path.lastIndexOf(".");
  if (separator <= 0) return "";
  const nodeId = path.slice(0, separator);
  const fieldKey = path.slice(separator + 1);
  return values.steps[nodeId]?.[fieldKey] ?? "";
};

// Fills an Email step's subject or body. An unknown placeholder renders blank
// rather than leaking the raw `{{ … }}` into a sent message.
export const renderMessageTemplate = (
  template: string,
  values: MessageTemplateValues,
  options: { escapeHtml?: boolean } = {},
): string =>
  template.replace(PLACEHOLDER, (_match, scope: string, path: string) => {
    const value = lookupPlaceholder(scope, path, values);
    return options.escapeHtml ? escapeHtml(value) : value;
  });
