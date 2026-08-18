import type { LookupSourceConfig, Result, ValueSetEntry } from "@rbrasier/domain";

export interface FetchRecordsInput {
  config: LookupSourceConfig;
  credentialRef?: string;
  // The registered source's id, present for every call except a Test against an
  // unsaved draft. Only the `managed` kind needs it — its records are rows.
  sourceId?: string;
  // Set for type-ahead. A kind that cannot filter at the source ignores it and
  // lets the caller filter the full set.
  query?: string;
  limit?: number;
}

// One source kind, reduced to the single thing they all differ on: producing raw
// records. Field selection, caching, matching and staleness are shared above
// this line, so adding a kind never touches domain or application (ADR-050 §2).
export interface ValueSetKindAdapter {
  fetchRecords(input: FetchRecordsInput): Promise<Result<Array<Record<string, string>>>>;
  // True when fetchRecords already applied `query`, so the caller must not
  // filter again (and cannot treat the result as the full set).
  readonly filtersAtSource: boolean;
}

export const recordsToEntries = (
  records: Array<Record<string, string>>,
  displayField: string,
  keyField?: string,
): ValueSetEntry[] =>
  records
    .map((record) => {
      const display = (record[displayField] ?? "").trim();
      const key = keyField ? (record[keyField] ?? "").trim() : "";
      return { display, ...(key ? { key } : {}) };
    })
    .filter((entry) => entry.display.length > 0);
