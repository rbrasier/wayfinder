// A person surfaced by the federated people directory. `source` records which
// backing system produced the record so the UI can label it and the federation
// layer can de-duplicate by email across sources.

export type PersonSource = "entra" | "hr" | "email";

export interface Person {
  readonly source: PersonSource;
  // The backing directory's own identifier (Entra object id, HR row id), or null
  // for a free-typed email with no matching record.
  readonly directoryId: string | null;
  // The matched `core_users` id when the person already has an account, else null.
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly email: string;
  readonly jobTitle: string | null;
  readonly department: string | null;
}
