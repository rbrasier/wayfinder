import {
  formatValueSetEntry,
  ok,
  type FieldValueSnapshot,
  type IValueSetProvider,
  type ResolveOutcome,
  type Result,
  type TemplateField,
  type ValueSetEntry,
  type ValueSetMatch,
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
  let blocksCompletion = false;

  for (const batch of batchBySource(input)) {
    const outcome = await valueSetProvider.resolve(batch.sourceName, batch.values);
    const data = outcome.data ?? degradedOutcome(batch.values);
    const batchFlags: ExternalFieldFlag[] = [];
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

      const flag: ExternalFieldFlag = {
        fieldKey: field.key,
        label: field.label,
        value: failedValue,
        reason,
        sourceName: batch.sourceName,
      };
      flagged.push(flag);
      batchFlags.push(flag);

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

    await attachSuggestions(valueSetProvider, batch.sourceName, batchFlags);
  }

  return ok({ resolved, flagged, blocksCompletion });
};

// Best-effort, and deliberately after the fact: narrowing runs only for values
// that have already failed the authoritative resolve, so it can never widen what
// counts as valid. A narrowing failure leaves the block in place without
// suggestions rather than turning into an error of its own.
const attachSuggestions = async (
  valueSetProvider: IValueSetProvider,
  sourceName: string,
  flags: ExternalFieldFlag[],
): Promise<void> => {
  const blocked = flags.filter((flag) => flag.reason !== "stale");
  if (blocked.length === 0) return;

  const narrowed = await valueSetProvider.match({
    sourceName,
    values: [...new Set(blocked.map((flag) => flag.value))],
  });
  if (narrowed.error) return;

  blocked.forEach((flag) => {
    const match = narrowed.data.matches.find((candidate) => candidate.input === flag.value);
    const entries = suggestedEntries(match);
    if (entries.length === 0) return;
    flag.suggestions = entries;
  });
};

const suggestedEntries = (match: ValueSetMatch | undefined): ValueSetEntry[] => {
  if (!match) return [];
  // A value the ladder can resolve on its own still failed the exact resolve —
  // a spelling variant, say — so it is offered as the one thing to confirm.
  if (match.outcome.kind === "resolved") return [match.outcome.candidate.entry];
  if (match.outcome.kind === "none") return [];
  return match.outcome.candidates.map((candidate) => candidate.entry);
};

// The operator-facing rendering of a block: what failed, and what to say instead.
export const describeExternalFieldFlag = (flag: ExternalFieldFlag): string => {
  const base = `"${flag.label}" (${flag.value})`;
  if (!flag.suggestions || flag.suggestions.length === 0) return base;

  return `${base} — did you mean ${flag.suggestions.map(formatValueSetEntry).join(", ")}?`;
};
