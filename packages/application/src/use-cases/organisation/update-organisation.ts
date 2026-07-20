import {
  domainError,
  err,
  type IOrganisationRepository,
  type Organisation,
  type Result,
} from "@rbrasier/domain";
import { normaliseEmailDomain } from "./create-organisation";

// Rename and/or edit the email domain. The slug stays stable so org-published
// flows and memberships follow the rename with no data migration (PRD story 4).
export class UpdateOrganisation {
  constructor(private readonly organisations: IOrganisationRepository) {}

  async execute(
    id: string,
    input: { name?: string; emailDomain?: string | null },
  ): Promise<Result<Organisation>> {
    const patch: { name?: string; emailDomain?: string | null } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        return err(domainError("VALIDATION_FAILED", "Organisation name is required."));
      }
      patch.name = name;
    }
    if (input.emailDomain !== undefined) {
      patch.emailDomain = normaliseEmailDomain(input.emailDomain);
    }
    return this.organisations.update(id, patch);
  }
}
