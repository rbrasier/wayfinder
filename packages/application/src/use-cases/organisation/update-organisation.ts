import {
  domainError,
  err,
  type IOrganisationRepository,
  type Organisation,
  type Result,
} from "@rbrasier/domain";

// Rename only. The slug stays stable so org-published flows and memberships
// follow the rename with no data migration (PRD story 4).
export class UpdateOrganisation {
  constructor(private readonly organisations: IOrganisationRepository) {}

  async execute(id: string, input: { name: string }): Promise<Result<Organisation>> {
    const name = input.name.trim();
    if (name.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Organisation name is required."));
    }
    return this.organisations.update(id, { name });
  }
}
