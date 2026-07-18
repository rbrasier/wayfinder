import type { NewOrganisation, Organisation, OrganisationUpdate } from "../entities/organisation";
import type { Result } from "../result";

export interface IOrganisationRepository {
  list(): Promise<Result<Organisation[]>>;
  findById(id: string): Promise<Result<Organisation | null>>;
  findBySlug(slug: string): Promise<Result<Organisation | null>>;
  create(organisation: NewOrganisation): Promise<Result<Organisation>>;
  update(id: string, patch: OrganisationUpdate): Promise<Result<Organisation>>;
  delete(id: string): Promise<Result<void>>;
  // How many users are assigned to an organisation. Backs the delete guard: a
  // non-empty organisation must not be deleted out from under its members.
  countMembers(organisationId: string): Promise<Result<number>>;
}
