import { ok } from "@rbrasier/domain";
import type { ILookupSourceRepository, Result } from "@rbrasier/domain";
import type { FetchRecordsInput, ValueSetKindAdapter } from "./value-set-kind-adapter";

// A managed source has no external schema to discover, so its two fields are
// fixed and a new source is created pointing at them.
export const MANAGED_DISPLAY_FIELD = "display";
export const MANAGED_KEY_FIELD = "key";

// The `managed` kind: rows an admin enters by hand. They live in
// kb_lookup_source_entries — the same table that caches the other kinds, except
// here the rows are the source of truth rather than a copy of one (ADR-050 §2).
export class ManagedValueSetAdapter implements ValueSetKindAdapter {
  readonly filtersAtSource = true;

  constructor(private readonly sources: ILookupSourceRepository) {}

  async fetchRecords(input: FetchRecordsInput): Promise<Result<Array<Record<string, string>>>> {
    // A draft has no rows yet: a managed source starts empty and is filled after
    // it is saved, so Test on an unsaved draft has nothing to show.
    if (!input.sourceId) return ok([]);

    const cached = await this.sources.readCachedEntries(input.sourceId);
    if (cached.error) return cached;
    if (!cached.data) return ok([]);

    const term = input.query?.trim().toLowerCase() ?? "";
    const matching = cached.data.entries.filter((entry) => {
      if (term.length === 0) return true;
      return (
        entry.display.toLowerCase().includes(term) ||
        (entry.key ?? "").toLowerCase().includes(term)
      );
    });

    return ok(
      matching.slice(0, input.limit ?? matching.length).map((entry) => ({
        [MANAGED_DISPLAY_FIELD]: entry.display,
        ...(entry.key ? { [MANAGED_KEY_FIELD]: entry.key } : {}),
      })),
    );
  }
}
