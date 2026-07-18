import {
  domainError,
  err,
  ok,
  type IOrganisationRepository,
  type IUserRepository,
  type Result,
} from "@rbrasier/domain";

// Sets (or clears) a user's organisation — the `admin` resolution strategy, and
// the sink every automatic strategy ultimately writes through.
export class AssignUserOrganisation {
  constructor(
    private readonly users: IUserRepository,
    private readonly organisations: IOrganisationRepository,
  ) {}

  async execute(input: { userId: string; organisationId: string | null }): Promise<Result<void>> {
    if (input.organisationId !== null) {
      const organisation = await this.organisations.findById(input.organisationId);
      if (organisation.error) return organisation;
      if (!organisation.data) {
        return err(domainError("NOT_FOUND", "Organisation not found."));
      }
    }
    const updated = await this.users.update(input.userId, { organisationId: input.organisationId });
    if (updated.error) return updated;
    return ok(undefined);
  }
}
