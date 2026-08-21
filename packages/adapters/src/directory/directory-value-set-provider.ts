import { findRecordCollections, ok } from "@rbrasier/domain";
import type { IPeopleDirectory, Person, RecordCollection, Result } from "@rbrasier/domain";
import type { FetchRecordsInput, ValueSetKindAdapter } from "../lookups/value-set-kind-adapter";

// How many people a listing pulls when there is no type-ahead term. Well above
// the inline threshold, so a directory-backed source lands on the type-ahead
// path rather than pretending to be a small set.
export const DIRECTORY_LIST_LIMIT = 200;

export interface DirectorySourceConfig {
  // Seeds a listing — e.g. "finance" to scope the set to one part of the org.
  query?: string;
}

const toRecord = (person: Person): Record<string, string> => {
  const record: Record<string, string> = { source: person.source };
  if (person.displayName) record.displayName = person.displayName;
  record.email = person.email;
  if (person.jobTitle) record.jobTitle = person.jobTitle;
  if (person.department) record.department = person.department;
  if (person.directoryId) record.directoryId = person.directoryId;
  if (person.userId) record.userId = person.userId;
  return record;
};

// The `directory` kind over the existing people directories (accounts, Entra,
// HR). It contributes records only — which field becomes the display and which
// the key is the admin's choice at Test time (ADR-050 §2b).
//
// Directories are queried in the order given and de-duplicated by email, so the
// ranking rule is the same one approver resolution uses: accounts first, the
// external directories augmenting them (ADR-018). A directory that fails is
// skipped rather than fatal; all of them failing is the error. Unlike people
// search, no free-typed email is appended — a value set may only contain values
// the source actually holds.
export class DirectoryValueSetAdapter implements ValueSetKindAdapter {
  // Every people directory takes the search term itself.
  filtersAtSource(): boolean {
    return true;
  }

  private readonly directories: IPeopleDirectory[];

  constructor(...directories: IPeopleDirectory[]) {
    this.directories = directories;
  }

  async fetchRecords(input: FetchRecordsInput): Promise<Result<Array<Record<string, string>>>> {
    const config = input.config as unknown as DirectorySourceConfig;
    const limit = input.limit ?? DIRECTORY_LIST_LIMIT;
    const query = input.query ?? config.query ?? "";

    const people: Person[] = [];
    const seenEmails = new Set<string>();
    let lastError: Result<Array<Record<string, string>>> | null = null;

    for (const directory of this.directories) {
      const found = await directory.search({ query, limit });
      if (found.error) {
        lastError = found;
        continue;
      }
      found.data.forEach((person) => {
        const email = person.email.toLowerCase();
        if (seenEmails.has(email)) return;
        seenEmails.add(email);
        people.push(person);
      });
    }

    if (people.length === 0 && lastError) return lastError;

    return ok(people.slice(0, limit).map(toRecord));
  }

  // A directory has one shape, so there is nothing to choose between — the
  // records are the collection.
  async discoverCollections(input: FetchRecordsInput): Promise<Result<RecordCollection[]>> {
    const records = await this.fetchRecords(input);
    if (records.error) return records;
    return ok(findRecordCollections(records.data));
  }
}
