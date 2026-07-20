import type { Result } from "../result";

export interface CreateAdminAccountInput {
  email: string;
  password: string;
  name: string;
}

// Bootstraps the very first administrator (ADR-041 §0). Implemented in the
// adapters layer over the auth provider, because creating a credential account
// (password hashing) and the transactional singleton guard are infrastructure
// concerns. The application layer orchestrates policy (token, seed-email
// binding, audit) around this port.
export interface IAdminAccountCreator {
  // Whether any administrator already exists. Drives the public `adminExists`
  // read, the no-admin redirect, and the application-layer fast-fail.
  adminExists(): Promise<Result<boolean>>;

  // Creates the credential account and marks the user admin atomically, under a
  // guard (advisory lock / partial unique index) so two concurrent calls cannot
  // both create an admin. Returns a CONFLICT error when an admin already exists
  // — including when it lost the race — so the endpoint refuses rather than
  // producing a second admin.
  createFirstAdmin(input: CreateAdminAccountInput): Promise<Result<{ userId: string }>>;
}
