import type { Person } from "../entities/person";
import type { Result } from "../result";

export interface PeopleSearchInput {
  query: string;
  limit: number;
}

// Federated people search across Entra, the uploaded HR dataset, and free-typed
// email. Implementations may back a single source; the federation adapter merges
// and de-duplicates by email.
export interface IPeopleDirectory {
  search(input: PeopleSearchInput): Promise<Result<Person[]>>;
}
