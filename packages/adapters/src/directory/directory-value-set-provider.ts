import { ok } from "@rbrasier/domain";
import type { IPeopleDirectory, Person, Result } from "@rbrasier/domain";
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

// The `directory` kind over the existing federated people directory (Entra + HR
// + accounts). It contributes records only — which field becomes the display and
// which the key is the admin's choice at Test time (ADR-050 §2b).
export class DirectoryValueSetAdapter implements ValueSetKindAdapter {
  readonly filtersAtSource = true;

  constructor(private readonly people: IPeopleDirectory) {}

  async fetchRecords(input: FetchRecordsInput): Promise<Result<Array<Record<string, string>>>> {
    const config = input.config as unknown as DirectorySourceConfig;
    const found = await this.people.search({
      query: input.query ?? config.query ?? "",
      limit: input.limit ?? DIRECTORY_LIST_LIMIT,
    });
    if (found.error) return found;

    return ok(found.data.map(toRecord));
  }
}
