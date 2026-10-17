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
