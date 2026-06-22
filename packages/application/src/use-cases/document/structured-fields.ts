import {
  buildFieldConstraintsText,
  domainError,
  err,
  type FlowContextDoc,
  type ILanguageModel,
  type Result,
  type SessionStepOutput,
  type StepOutputField,
  type TemplateField,
} from "@rbrasier/domain";
import { documentDataSchema } from "@rbrasier/shared";

// Rough char-per-token ratio for English prose, used only to keep prompts under
// the model context window — it does not need to be exact, only conservative.
const CHARS_PER_TOKEN = 4;

// Hard cap on the combined context-document text injected into a single prompt.
// ~100k tokens, leaving generous headroom under a 200k window for the field
// constraints, transcript, and the model's structured output. Without this, a
// large reference set (e.g. a 177k-token security manual) overflows the window.
export const CONTEXT_DOCS_CHAR_BUDGET = 400_000;

// Refuse to call the model when the assembled prompt would still exceed this,
// failing with a clear message instead of letting the provider throw
// "prompt is too long".
const MAX_PROMPT_TOKENS = 180_000;

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export const buildContextDocsSection = (
  docs: FlowContextDoc[],
  maxChars: number = CONTEXT_DOCS_CHAR_BUDGET,
): string => {
  if (docs.length === 0) return "";
  let remaining = Math.max(0, maxChars);
  const lines = docs.map((doc) => {
    if (!(doc.extractionStatus === "complete" && doc.extractedText)) {
      return `- ${doc.filename}`;
    }
    if (remaining <= 0) {
      return `- ${doc.filename} [omitted: context budget exhausted]`;
    }
    const text = doc.extractedText.slice(0, remaining);
    const wasTruncated = text.length < doc.extractedText.length;
    remaining -= text.length;
    return `\n[${doc.filename}]\n${text}${wasTruncated ? "\n[Document truncated to fit the context budget.]" : ""}`;
  });
  return `\nFlow context documents:\n${lines.join("\n")}`;
};

export interface ExtractStructuredFieldsInput {
  fields: TemplateField[];
  transcript: string;
  contextDocs: FlowContextDoc[];
  instruction: string;
  purpose: string;
  // Enforcement key + dashboard attribution (ADR-026); passed straight to the
  // model call. Optional so existing callers are unaffected.
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
  // Higher-priority context than the transcript: structured values captured by
  // earlier steps, then insights accumulated across the conversation. Optional
  // so document generation keeps its existing prompt byte-for-byte.
  priorStepOutputs?: SessionStepOutput[];
  insights?: { key: string; value: string }[];
}

const buildStepOutputsSection = (outputs: SessionStepOutput[]): string => {
  const lines = outputs.flatMap((output) =>
    output.fields
      .filter((stepField) => stepField.value.trim().length > 0)
      .map((stepField) => `- ${stepField.label}: ${stepField.value}`),
  );
  if (lines.length === 0) return "";
  return `\nData captured by earlier steps (most reliable):\n${lines.join("\n")}`;
};

const buildInsightsSection = (insights: { key: string; value: string }[]): string => {
  const lines = insights
    .filter((insight) => insight.value.trim().length > 0)
    .map((insight) => `- ${insight.key}: ${insight.value}`);
  if (lines.length === 0) return "";
  return `\nInsights gathered so far:\n${lines.join("\n")}`;
};

// Narrative and section fields invert the default "extract what the user said"
// behaviour: narrative asks the model to compose prose, section asks it to make
// an include/omit decision. Only emitted when such fields exist.
const buildGenerationGuidance = (fields: TemplateField[]): string => {
  const lines: string[] = [];
  if (fields.some((field) => field.type === "narrative")) {
    lines.push(
      `\nSome fields are "narrative prose you compose" — write the finished prose yourself, grounded in the session context and any flow guidance. Do not echo the instruction back. Only leave one blank when its field is optional and the section is clearly not applicable.`,
    );
  }
  if (fields.some((field) => field.type === "section")) {
    lines.push(
      `\nSome fields decide whether to include a section — answer exactly "Yes" to include the section or "No" to omit it, based on whether the session warrants it.`,
    );
  }
  return lines.join("\n");
};

// Shared gather-into-JSON helper used by document generation and auto nodes.
// Builds the <field_constraints> block and asks the model for a flat record
// keyed by TemplateField.key.
export const extractStructuredFields = async (
  languageModel: ILanguageModel,
  input: ExtractStructuredFieldsInput,
): Promise<Result<Record<string, string>>> => {
  const keys = input.fields.map((field) => field.key);
  const contextDocsSection = buildContextDocsSection(input.contextDocs);
  const generationGuidance = buildGenerationGuidance(input.fields);
  const stepOutputsSection = buildStepOutputsSection(input.priorStepOutputs ?? []);
  const insightsSection = buildInsightsSection(input.insights ?? []);

  const prompt = [
    `Return a JSON object with exactly these keys: ${JSON.stringify(keys)}.`,
    `Fill each value using the session context below.`,
    `\nEach field has a required format. Reformat the information the user provided into the required format whenever you reasonably can — for example, parse a written date into DD-MM-YYYY, or format an amount as currency. Only leave a value blank when its field is marked optional and the information is genuinely missing.`,
    `\n<field_constraints>\n${buildFieldConstraintsText(input.fields)}\n</field_constraints>`,
    generationGuidance,
    stepOutputsSection,
    insightsSection,
    contextDocsSection,
    `\nSession transcript:\n${input.transcript}`,
  ]
    .filter(Boolean)
    .join("\n");

  // The context-doc section is already budget-capped, but a very large template
  // (many field constraints) or transcript could still push a single batch over.
  // Fail with a clear message rather than letting the provider throw.
  if (estimateTokens(input.instruction) + estimateTokens(prompt) > MAX_PROMPT_TOKENS) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "The information for this step is too large to fit the model context, even after truncating reference documents. Reduce the flow's context documents or split the step.",
      ),
    );
  }

  const result = await languageModel.generateObject<Record<string, string>>({
    purpose: input.purpose,
    userId: input.userId,
    flowId: input.flowId,
    sessionId: input.sessionId,
    system: input.instruction,
    prompt,
    schema: documentDataSchema,
    temperature: 0.3,
  });
  if (result.error) return result;

  return { data: result.data.object };
};

const coerceValue = (field: TemplateField, raw: unknown): string => {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return "";
  }
  const value = String(raw).trim();
  if (value === "") return "";

  if (field.options && field.options.length > 0) {
    return coerceOptions(field, value);
  }

  switch (field.type) {
    case "number":
    case "currency":
      return Number.isNaN(Number(value.replace(/[$,\s]/g, ""))) ? "" : value;
    case "email":
      return /.+@.+\..+/.test(value) ? value : "";
    case "yesno":
    case "section":
      return coerceYesNo(value);
    default:
      return value;
  }
};

const coerceOptions = (field: TemplateField, value: string): string => {
  const candidates = field.multiple ? value.split(",").map((part) => part.trim()) : [value];
  const matched = candidates
    .map((candidate) => field.options?.find((option) => option.toLowerCase() === candidate.toLowerCase()))
    .filter((option): option is string => Boolean(option));
  if (matched.length === 0) return "";
  return field.multiple ? matched.join(", ") : matched[0]!;
};

const coerceYesNo = (value: string): string => {
  const lower = value.toLowerCase();
  if (["yes", "y", "true"].includes(lower)) return "Yes";
  if (["no", "n", "false"].includes(lower)) return "No";
  return "";
};

// Best-effort coercion of an external (n8n) response against declared response
// fields. Matched, valid values are kept; missing or invalid values are blanked.
// Never throws — coercion mismatch must never fail the node.
export const coerceStructuredFields = (
  responseFields: TemplateField[],
  data: Record<string, unknown>,
): StepOutputField[] =>
  responseFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    options: field.options,
    value: coerceValue(field, data[field.key]),
  }));
