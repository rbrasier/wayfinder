import {
  formatValueSetEntry,
  ok,
  type FieldValueSnapshot,
  type IValueSetProvider,
  type ResolveOutcome,
  type Result,
  type TemplateField,
  type ValueSetEntry,
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
  // What the narrowing ladder thinks the operator may have meant. Suggestions
  // never substitute themselves for the value — they exist so the block can be
  // answered with a choice instead of a search (ADR-051 §4).
  suggestions?: ValueSetEntry[];
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

  for (const batch of batchBySource(input)) {
    const outcome = await valueSetProvider.resolve(batch.sourceName, batch.values);
    const data = outcome.data ?? degradedOutcome(batch.values);
    const snapshot: FieldValueSnapshot = {
      name: batch.sourceName,
      version: data.version,
      fetchedAt: data.fetchedAt,
    };
    const narrowed = await narrowFailures(valueSetProvider, batch, data);

    for (const field of batch.fields) {
      const rawValues = splitValues(field, input.values[field.key] ?? "").filter(
        (value) => value.length > 0,
      );
      const entries = rawValues.map(
        (value) =>
          data.matched.find((match) => match.input === value)?.entry ??
          narrowed.corrections.get(value),
      );
      const failedIndex = entries.findIndex((entry) => entry === undefined);

      if (failedIndex === -1) {
        resolved[field.key] = resolveField(entries as ValueSetEntry[], rawValues, snapshot);
        continue;
      }

      const failedValue = rawValues[failedIndex]!;
      const reason: ExternalFieldFlagReason = data.stale
        ? "stale"
        : data.ambiguous.includes(failedValue)
          ? "ambiguous"
          : "unresolved";

      const suggestions = narrowed.suggestions.get(failedValue);
      flagged.push({
        fieldKey: field.key,
        label: field.label,
        value: failedValue,
        reason,
        sourceName: batch.sourceName,
        ...(suggestions && suggestions.length > 0 ? { suggestions } : {}),
      });

      // A stale set is not authoritative, so the operator's value stands and is
      // flagged for review rather than rejected.
      if (data.stale) {
        resolved[field.key] = {
          value: rawValues.join(MULTI_VALUE_SEPARATOR),
          sourceRef: snapshot,
        };
      }
    }
  }

  return ok({
    resolved,
    flagged,
    blocksCompletion: flagged.some((flag) => flag.reason !== "stale"),
  });
};

const resolveField = (
  entries: ValueSetEntry[],
  rawValues: string[],
  snapshot: FieldValueSnapshot,
): ResolvedExternalField => {
  const canonical = entries.map((entry) => entry.display).join(MULTI_VALUE_SEPARATOR);
  const original = rawValues.join(MULTI_VALUE_SEPARATOR);
  const keys = entries.map((entry) => entry.key).filter((key): key is string => !!key);
  // Casing was always normalised by the resolve itself (ADR-050 §6), so only a
  // difference the letters themselves make counts as a correction worth recording.
  const corrected = original.toLowerCase() !== canonical.toLowerCase();

  return {
    value: canonical,
    ...(keys.length === entries.length && keys.length > 0
      ? { valueKey: keys.join(MULTI_VALUE_SEPARATOR) }
      : {}),
    sourceRef: corrected ? { ...snapshot, correctedFrom: original } : snapshot,
  };
};

interface Narrowing {
  // Values the ladder placed beyond doubt, which are accepted without asking.
  corrections: Map<string, ValueSetEntry>;
  // Values it could only narrow, offered with the block for the operator to pick.
  suggestions: Map<string, ValueSetEntry[]>;
}

const NO_NARROWING: Narrowing = { corrections: new Map(), suggestions: new Map() };

// Runs only for values the authoritative resolve already rejected, and never for
// a stale set, whose values are not authoritative and whose suggestions would
// carry false confidence (ADR-050 §5). A narrowing failure yields nothing rather
// than becoming an error of its own.
const narrowFailures = async (
  valueSetProvider: IValueSetProvider,
  batch: SourceBatch,
  data: ResolveOutcome,
): Promise<Narrowing> => {
  if (data.stale) return NO_NARROWING;

  const failed = [...new Set([...data.unresolved, ...data.ambiguous])];
  if (failed.length === 0) return NO_NARROWING;

  const narrowed = await valueSetProvider.match({
    sourceName: batch.sourceName,
    values: failed,
    // One call serves the whole source, so a label is only honest when a single
    // field is asking. Two fields sharing a source would each need their own.
    ...(batch.fields.length === 1 ? { context: batch.fields[0]!.label } : {}),
  });
  if (narrowed.error) return NO_NARROWING;

  const corrections = new Map<string, ValueSetEntry>();
  const suggestions = new Map<string, ValueSetEntry[]>();

  narrowed.data.matches.forEach((match) => {
    if (match.outcome.kind === "resolved") {
      corrections.set(match.input, match.outcome.candidate.entry);
      return;
    }
    if (match.outcome.kind === "none") return;
    suggestions.set(
      match.input,
      match.outcome.candidates.map((candidate) => candidate.entry),
    );
  });

  return { corrections, suggestions };
};

// The operator-facing rendering of a block: what failed, and what to say instead.
export const describeExternalFieldFlag = (flag: ExternalFieldFlag): string => {
  const base = `"${flag.label}" (${flag.value})`;
  if (!flag.suggestions || flag.suggestions.length === 0) return base;

  return `${base} — did you mean ${flag.suggestions.map(formatValueSetEntry).join(", ")}?`;
};
