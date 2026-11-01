// One source record a tool result pointed at (ADR-062 §6). Carried on the
// assistant turn that cited it and on the step-output fields captured from it.
// `url` is only ever an http(s) URL — anything else is dropped at extraction.
export interface ToolRecordCitation {
  readonly serverId: string;
  readonly serverLabel: string;
  readonly toolName: string;
  readonly locator: string;
  readonly title: string | null;
  readonly url: string | null;
  readonly recordedAt: string | null;
}

// A citation as the model sees it in <tool_results>: `S1`, `S2`, … in the order
// the records were gathered.
export interface NumberedCitation {
  readonly marker: string;
  readonly citation: ToolRecordCitation;
}

// A citation the reply actually used, with the marker it used for it.
export interface CitedSource extends ToolRecordCitation {
  readonly marker: string;
}

const citationKey = (citation: ToolRecordCitation): string =>
  `${citation.serverId}\u0000${citation.toolName}\u0000${citation.locator}`;

// A record gathered by two calls gets one marker, so the model cannot cite the
// same source under two numbers.
export const numberCitations = (citations: readonly ToolRecordCitation[]): NumberedCitation[] => {
  const seen = new Set<string>();
  const numbered: NumberedCitation[] = [];
  for (const citation of citations) {
    const key = citationKey(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    numbered.push({ marker: `S${numbered.length + 1}`, citation });
  }
  return numbered;
};

const MARKER_PATTERN = /\[(S\d+)\]/g;

// The citations a reply used, in the order it first used them. A marker that
// names no gathered record is ignored rather than surfaced as a broken source.
export const resolveCitedSources = (
  text: string,
  numbered: readonly NumberedCitation[],
): CitedSource[] => {
  const byMarker = new Map(numbered.map((entry) => [entry.marker, entry.citation]));
  const cited: CitedSource[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MARKER_PATTERN)) {
    const marker = match[1]!;
    const citation = byMarker.get(marker);
    if (!citation || seen.has(marker)) continue;
    seen.add(marker);
    cited.push({ ...citation, marker });
  }
  return cited;
};

// The records a captured value actually came from (ADR-062 §6): a field cites a
// record only when its value names that record — its locator, link or title.
// A blank value, or one built from none of them, cites nothing, so a field
// never claims a source it does not draw on.
export const citationsForValue = (
  value: string,
  citations: readonly ToolRecordCitation[],
): ToolRecordCitation[] => {
  if (value.trim().length === 0) return [];
  const lowerValue = value.toLowerCase();
  return citations.filter((citation) =>
    [citation.locator, citation.url, citation.title].some((marker) => mentions(lowerValue, marker)),
  );
};

const ALPHANUMERIC = /[a-z0-9]/;

// Bounded so locator `act-1` is not found inside `act-12`.
const mentions = (lowerValue: string, marker: string | null): boolean => {
  const needle = marker?.trim().toLowerCase();
  if (!needle) return false;
  for (let index = lowerValue.indexOf(needle); index !== -1; index = lowerValue.indexOf(needle, index + 1)) {
    const before = lowerValue[index - 1] ?? "";
    const after = lowerValue[index + needle.length] ?? "";
    if (!ALPHANUMERIC.test(before) && !ALPHANUMERIC.test(after)) return true;
  }
  return false;
};
