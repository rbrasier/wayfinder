import type { IOrganisationRepository, Organisation, Result } from "@rbrasier/domain";

export class ListOrganisations {
  constructor(private readonly organisations: IOrganisationRepository) {}

  async execute(): Promise<Result<Organisation[]>> {
    return this.organisations.list();
  }
}
