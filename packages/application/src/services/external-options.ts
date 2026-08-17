import {
  formatValueSetEntry,
  INLINE_OPTIONS_THRESHOLD,
  previewValueSetEntries,
  type IValueSetProvider,
  type TemplateField,
  type ValueSetEntry,
} from "@rbrasier/domain";

export interface ExternalOptionsPreview {
  text: string;
  shown: ValueSetEntry[];
  remaining: number;
  totalCount: number;
}

// Populates `options` for external fields whose set is small enough to inline
// into the extraction prompt. A large set is deliberately left out — the model
// proposes from context and the step-end resolve is authoritative (ADR-050 §4).
// A provider that cannot answer leaves the field untouched rather than failing
// the extraction: an unreachable source must not stop a step from running.
export const inlineExternalOptions = async (
  valueSetProvider: IValueSetProvider | undefined,
  fields: TemplateField[],
): Promise<TemplateField[]> => {
  if (!valueSetProvider) return fields;

  const sourceNames = [
    ...new Set(
      fields
        .map((field) => field.optionsSource)
        .filter((sourceName): sourceName is string => !!sourceName),
    ),
  ];
  if (sourceNames.length === 0) return fields;

  const inlinedBySource = new Map<string, string[]>();
  for (const sourceName of sourceNames) {
    const listing = await valueSetProvider.list(sourceName);
    if (listing.error) continue;
    if (listing.data.entries.length > INLINE_OPTIONS_THRESHOLD) continue;
    inlinedBySource.set(sourceName, listing.data.entries.map(formatValueSetEntry));
  }

  return fields.map((field) => {
    if (!field.optionsSource) return field;
    const options = inlinedBySource.get(field.optionsSource);
    if (!options || options.length === 0) return field;
    return { ...field, options };
  });
};

// What the assistant shows when it asks the question conversationally. Capped at
// three whatever the set size, so a fully-inlined 30-value set does not get
// dumped into the chat turn — the model keeps the full set, the operator asks
// for it (ADR-050 §4).
export const buildExternalOptionsPreview = (entries: ValueSetEntry[]): ExternalOptionsPreview => {
  const preview = previewValueSetEntries(entries);
  const shownText = preview.shown.map(formatValueSetEntry).join(", ");
  const text =
    preview.remaining > 0
      ? `${shownText} — ask to see all ${preview.totalCount} options`
      : shownText;

  return { text, shown: preview.shown, remaining: preview.remaining, totalCount: preview.totalCount };
};
