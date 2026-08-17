import {
  ok,
  type FieldValueSnapshot,
  type IValueSetProvider,
  type ResolveOutcome,
  type Result,
  type TemplateField,
} from "@rbrasier/domain";

export interface ValidateExternalFieldsInput {
  fields: TemplateField[];
  // Keyed by TemplateField.key, as produced by resolveFieldValues.
  values: Record<string, string>;
}

export type ExternalFieldFlagReason = "unresolved" | "ambiguous" | "stale";

export interface ExternalFieldFlag {
  fieldKey: string;
  label: string;
  value: string;
  reason: ExternalFieldFlagReason;
  sourceName: string;
}

export interface ResolvedExternalField {
  value: string;
  valueKey?: string;
  sourceRef: FieldValueSnapshot;
}

export interface ValidateExternalFieldsResult {
  resolved: Record<string, ResolvedExternalField>;
  flagged: ExternalFieldFlag[];
  blocksCompletion: boolean;
}

const MULTI_VALUE_SEPARATOR = ", ";

const splitValues = (field: TemplateField, value: string): string[] => {
  if (!field.multiple) return [value.trim()];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

// A provider that cannot answer at all is treated exactly like a stale set: the
// value is accepted and flagged, never blocked. Blocking on an unreachable
// source would let an outage halt every workflow that touches it (ADR-050 §5).
const degradedOutcome = (values: string[]): ResolveOutcome => ({
  matched: [],
  unresolved: values,
  ambiguous: [],
  stale: true,
  version: "unavailable",
  fetchedAt: new Date(0),
});

interface SourceBatch {
  sourceName: string;
  fields: TemplateField[];
  values: string[];
}

const batchBySource = (input: ValidateExternalFieldsInput): SourceBatch[] => {
  const batches = new Map<string, SourceBatch>();

  input.fields.forEach((field) => {
    if (!field.optionsSource) return;
    const raw = input.values[field.key] ?? "";
    const values = splitValues(field, raw).filter((value) => value.length > 0);
    if (values.length === 0) return;

    const batch = batches.get(field.optionsSource) ?? {
      sourceName: field.optionsSource,
      fields: [],
      values: [],
    };
    batch.fields.push(field);
    values.forEach((value) => {
      if (batch.values.includes(value)) return;
      batch.values.push(value);
    });
    batches.set(field.optionsSource, batch);
  });

  return [...batches.values()];
};

// Re-checks every external-sourced field against its live source when a step
// completes — the authoritative checkpoint, because an AI-filled or free-typed
// value never passed through the picker (ADR-050 §6). One call per source, not
// per field. Never throws: a provider that cannot answer degrades rather than
// halting the step.
export const validateExternalFields = async (
  valueSetProvider: IValueSetProvider,
  input: ValidateExternalFieldsInput,
): Promise<Result<ValidateExternalFieldsResult>> => {
  const resolved: Record<string, ResolvedExternalField> = {};
  const flagged: ExternalFieldFlag[] = [];
  let blocksCompletion = false;

  for (const batch of batchBySource(input)) {
    const outcome = await valueSetProvider.resolve(batch.sourceName, batch.values);
    const data = outcome.data ?? degradedOutcome(batch.values);
    const snapshot: FieldValueSnapshot = {
      name: batch.sourceName,
      version: data.version,
      fetchedAt: data.fetchedAt,
    };

    for (const field of batch.fields) {
      const rawValues = splitValues(field, input.values[field.key] ?? "").filter(
        (value) => value.length > 0,
      );
      const entries = rawValues.map((value) =>
        data.matched.find((match) => match.input === value),
      );
      const failedIndex = entries.findIndex((entry) => entry === undefined);

      if (failedIndex === -1) {
        const matchedEntries = entries.map((entry) => entry!.entry);
        const keys = matchedEntries.map((entry) => entry.key).filter((key): key is string => !!key);
        resolved[field.key] = {
          value: matchedEntries.map((entry) => entry.display).join(MULTI_VALUE_SEPARATOR),
          ...(keys.length === matchedEntries.length && keys.length > 0
            ? { valueKey: keys.join(MULTI_VALUE_SEPARATOR) }
            : {}),
          sourceRef: snapshot,
        };
        continue;
      }

      const failedValue = rawValues[failedIndex]!;
      const reason: ExternalFieldFlagReason = data.stale
        ? "stale"
        : data.ambiguous.includes(failedValue)
          ? "ambiguous"
          : "unresolved";

      flagged.push({
        fieldKey: field.key,
        label: field.label,
        value: failedValue,
        reason,
        sourceName: batch.sourceName,
      });

      // A stale set is not authoritative, so the operator's value stands and is
      // flagged for review rather than rejected.
      if (data.stale) {
        resolved[field.key] = {
          value: rawValues.join(MULTI_VALUE_SEPARATOR),
          sourceRef: snapshot,
        };
        continue;
      }
      blocksCompletion = true;
    }
  }

  return ok({ resolved, flagged, blocksCompletion });
};
