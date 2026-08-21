import {
  domainError,
  entriesMatchVersion,
  err,
  ok,
  type ILookupSourceRepository,
  type LookupSource,
  type Result,
  type ValueSetEntry,
} from "@rbrasier/domain";

export interface ManagedEntriesOptions {
  now?: () => Date;
  newVersion?: () => string;
}

// A managed source's rows are its system of record, not a cache of one, so they
// are the only kind an admin may edit directly (ADR-050 §2).
const requireManaged = async (
  sources: ILookupSourceRepository,
  sourceId: string,
): Promise<Result<LookupSource>> => {
  const found = await sources.findById(sourceId);
  if (found.error) return found;
  if (!found.data) {
    return err(domainError("NOT_FOUND", `Lookup source "${sourceId}" does not exist.`));
  }
  if (found.data.kind !== "managed") {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${found.data.label}" takes its values from its ${found.data.kind} source, so they cannot be edited here.`,
      ),
    );
  }
  return ok(found.data);
};

export class ListManagedEntries {
  constructor(private readonly sources: ILookupSourceRepository) {}

  async execute(sourceId: string): Promise<Result<ValueSetEntry[]>> {
    const source = await requireManaged(this.sources, sourceId);
    if (source.error) return source;

    const cached = await this.sources.readCachedEntries(sourceId);
    if (cached.error) return cached;

    return ok(cached.data?.entries ?? []);
  }
}

export class ReplaceManagedEntries {
  constructor(
    private readonly sources: ILookupSourceRepository,
    private readonly options: ManagedEntriesOptions = {},
  ) {}

  async execute(sourceId: string, entries: ValueSetEntry[]): Promise<Result<ValueSetEntry[]>> {
    const source = await requireManaged(this.sources, sourceId);
    if (source.error) return source;

    const cleaned = entries
      .map((entry) => {
        const key = entry.key?.trim();
        return { display: entry.display.trim(), ...(key ? { key } : {}) };
      })
      // A row with nothing to show could never be picked, so it is dropped
      // rather than stored as an invisible option.
      .filter((entry) => entry.display.length > 0);

    const duplicate = findDuplicate(cleaned);
    if (duplicate) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `"${duplicate}" is listed twice with the same code. Give the rows different codes, or remove one.`,
        ),
      );
    }

    const existing = await this.sources.readCachedEntries(sourceId);
    if (existing.error) return existing;

    // An unchanged save keeps the version, so snapshots already written against
    // it stay meaningful (ADR-050 §5) — the same rule a refresh follows.
    const version =
      existing.data && entriesMatchVersion(existing.data.entries, cleaned)
        ? existing.data.version
        : this.newVersion();

    const written = await this.sources.replaceCachedEntries(sourceId, {
      entries: cleaned,
      version,
      fetchedAt: this.now(),
    });
    if (written.error) return written;

    return ok(cleaned);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private newVersion(): string {
    return this.options.newVersion?.() ?? new Date().toISOString();
  }
}

// Two rows are the same value only when both parts match — same label under two
// codes is legitimate (two "Operations"), and the picker tells them apart.
const findDuplicate = (entries: ValueSetEntry[]): string | null => {
  // Reports the first row's spelling, which is the one the admin will recognise
  // in the list, rather than the later row that happened to trip the check.
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const parts = [entry.display.toLowerCase(), (entry.key ?? "").toLowerCase()];
    const fingerprint = parts.join("\u0000");
    const first = seen.get(fingerprint);
    if (first) return first;
    seen.set(fingerprint, entry.display);
  }
  return null;
};
