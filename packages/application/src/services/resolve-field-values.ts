import type {
  FieldValueSource,
  FlowContextDoc,
  ILanguageModel,
  Result,
  SessionStepOutput,
  TemplateField,
} from "@rbrasier/domain";
import { extractStructuredFields } from "../use-cases/document/structured-fields";

export interface ResolveFieldValuesInput {
  fields: TemplateField[];
  // Keyed by TemplateField.key. A missing entry defaults to `ai`.
  valueSources: Record<string, FieldValueSource>;
  priorStepOutputs: SessionStepOutput[];
  insights: { key: string; value: string }[];
  transcript: string;
  contextDocs: FlowContextDoc[];
  instruction: string;
  purpose: string;
  userId?: string | null;
  flowId?: string | null;
  sessionId?: string | null;
}

export const lookupStepField = (
  outputs: SessionStepOutput[],
  nodeId: string,
  fieldKey: string,
): string => {
  const latest = outputs
    .filter((output) => output.nodeId === nodeId)
    .reduce<SessionStepOutput | null>(
      (acc, output) => (!acc || output.createdAt > acc.createdAt ? output : acc),
      null,
    );
  if (!latest) return "";
  return latest.fields.find((field) => field.key === fieldKey)?.value ?? "";
};

// Resolves every request field to a string. `literal` and `step_field` sources
// are resolved directly; only `ai` fields are sent to the model, with earlier
// step outputs and insights provided as higher-priority context than the
// transcript.
export const resolveFieldValues = async (
  languageModel: ILanguageModel,
  input: ResolveFieldValuesInput,
): Promise<Result<Record<string, string>>> => {
  const resolved: Record<string, string> = {};
  const aiFields: TemplateField[] = [];

  for (const field of input.fields) {
    const source = input.valueSources[field.key] ?? { kind: "ai" };
    if (source.kind === "none") {
      continue;
    }
    if (source.kind === "literal") {
      resolved[field.key] = source.value;
      continue;
    }
    if (source.kind === "step_field") {
      resolved[field.key] = lookupStepField(input.priorStepOutputs, source.nodeId, source.fieldKey);
      continue;
    }
    aiFields.push(field);
  }

  if (aiFields.length === 0) return { data: resolved };

  const extracted = await extractStructuredFields(languageModel, {
    fields: aiFields,
    transcript: input.transcript,
    contextDocs: input.contextDocs,
    instruction: input.instruction,
    purpose: input.purpose,
    userId: input.userId,
    flowId: input.flowId,
    sessionId: input.sessionId,
    priorStepOutputs: input.priorStepOutputs,
    insights: input.insights,
  });
  if (extracted.error) return extracted;

  for (const field of aiFields) {
    // This resolver serves scalar request fields (literal/step_field/ai). Group
    // arrays are out of scope here (deferred external-classification path) — a
    // non-string value coerces to blank rather than leaking an array.
    const value = extracted.data[field.key];
    resolved[field.key] = typeof value === "string" ? value : "";
  }

  return { data: resolved };
};
