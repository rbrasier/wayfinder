import { domainError } from "../errors/index";
import { err, ok, type Result } from "../result";

// A named, typed value a flow expects when something other than a person starts
// it (ADR-064 §1). Declared on the flow and frozen into each published version,
// so a running session reads the inputs of the version it is pinned to.
export type TriggerInputType = "text" | "number" | "date" | "boolean" | "json";

export interface TriggerInput {
  key: string;
  label: string;
  type: TriggerInputType;
  required: boolean;
}

export type FlowTriggerKind = "webhook";

// A flow's inbound start address (ADR-064 §3). The token itself is never held
// here: only its hash is stored, and the entity exposes just the last four
// characters so the UI can say which token is live.
export interface FlowTrigger {
  id: string;
  flowId: string;
  kind: FlowTriggerKind;
  enabled: boolean;
  tokenLastFour: string | null;
  hasHmacSecret: boolean;
  runAsUserId: string | null;
  createdBy: string | null;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Problems an author must fix before a flow's declared inputs can be saved.
const MAX_TRIGGER_INPUTS = 50;
const MAX_TRIGGER_LABEL_LENGTH = 120;

export const validateTriggerInputs = (inputs: TriggerInput[]): string[] => {
  const problems: string[] = [];
  if (inputs.length > MAX_TRIGGER_INPUTS) problems.push("A flow can declare at most 50 inputs.");
  const seen = new Set<string>();
  for (const input of inputs) {
    if (!KEY_PATTERN.test(input.key)) {
      problems.push(
        `${input.key} must start with a letter and use only lower-case letters, digits and underscores.`,
      );
    }
    if (seen.has(input.key)) problems.push(`${input.key} is used more than once.`);
    seen.add(input.key);
    if (input.label.trim().length === 0) problems.push(`Give ${input.key} a label.`);
    if (input.label.length > MAX_TRIGGER_LABEL_LENGTH) {
      problems.push(`Keep ${input.key}'s label to 120 characters or fewer.`);
    }
  }
  return problems;
};

type Coerced = { value: unknown } | { problem: string };

const coerce = (input: TriggerInput, raw: unknown): Coerced => {
  if (input.type === "json") return { value: raw };
  if (input.type === "number") {
    const value = typeof raw === "number" ? raw : Number(String(raw).trim());
    return Number.isFinite(value) && String(raw).trim() !== "" ? { value } : { problem: `${input.key} must be a number.` };
  }
  if (input.type === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    const text = String(raw).trim().toLowerCase();
    if (text === "true") return { value: true };
    if (text === "false") return { value: false };
    return { problem: `${input.key} must be true or false.` };
  }
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  if (input.type === "date" && !(DATE_PATTERN.test(text) && !Number.isNaN(Date.parse(text)))) {
    return { problem: `${input.key} must be a date (YYYY-MM-DD).` };
  }
  return { value: text };
};

const isMissing = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === "string" && raw.trim().length === 0);

// Checks what a watch or webhook supplies against the flow's declared inputs
// (ADR-064 §1). Undeclared keys are dropped rather than rejected, so a caller
// sending extra fields still works and nothing unvetted reaches a step.
export const validateTriggerPayload = (
  inputs: TriggerInput[],
  payload: unknown,
): Result<Record<string, unknown>> => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return err(domainError("VALIDATION_FAILED", "Inputs must be a JSON object."));
  }
  const source = payload as Record<string, unknown>;
  const accepted: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const input of inputs) {
    const raw = source[input.key];
    if (isMissing(raw)) {
      if (input.required) problems.push(`${input.key} is required.`);
      continue;
    }
    const coerced = coerce(input, raw);
    if ("problem" in coerced) {
      problems.push(coerced.problem);
      continue;
    }
    accepted[input.key] = coerced.value;
  }

  if (problems.length > 0) return err(domainError("VALIDATION_FAILED", problems.join(" ")));
  return ok(accepted);
};
