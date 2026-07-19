import { domainError, err, type IOrganisationRepository, type Result } from "@rbrasier/domain";

export class DeleteOrganisation {
  constructor(private readonly organisations: IOrganisationRepository) {}

  async execute(id: string): Promise<Result<void>> {
    // Guard: an organisation with members must be emptied first, so deletion is a
    // deliberate act and never silently returns a crowd of users to unaffiliated.
    // `on delete set null` is the DB backstop if a member slips in concurrently.
    const countResult = await this.organisations.countMembers(id);
    if (countResult.error) return countResult;
    if (countResult.data > 0) {
      return err(
        domainError(
          "CONFLICT",
          "This organisation still has members. Reassign or clear them before deleting it.",
        ),
      );
    }
    return this.organisations.delete(id);
  }
}
