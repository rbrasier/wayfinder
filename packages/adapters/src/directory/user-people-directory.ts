import {
  ok,
  type IPeopleDirectory,
  type IUserRepository,
  type PeopleSearchInput,
  type Person,
  type Result,
  type User,
} from "@wayfinder/domain";

export const userToPerson = (user: User): Person => ({
  source: "user",
  directoryId: null,
  userId: user.id,
  displayName: user.name,
  email: user.email,
  jobTitle: user.role,
  department: user.team,
});

// People search over existing Wayfinder accounts. It sits alongside Entra and
// the HR upload rather than replacing either (ADR-018 federates over a list),
// and it is the source that matters most for approvals: everyone it returns can
// actually sign in and decide, which a typed email or an un-provisioned HR row
// cannot until an account exists (step-approvals PRD §12).
//
// De-duplication is the federation layer's job — `mergePeople` keys on
// lowercased email and prefers the account-backed record, so the same person in
// Entra and here collapses to one entry.
export class UserPeopleDirectory implements IPeopleDirectory {
  constructor(private readonly users: IUserRepository) {}

  async search(input: PeopleSearchInput): Promise<Result<Person[]>> {
    const result = await this.users.search({ query: input.query, limit: input.limit });
    if (result.error) return result;
    return ok(result.data.map(userToPerson));
  }
}
