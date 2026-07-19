import {
  DEFAULT_ORGANISATION_RESOLUTION,
  domainError,
  err,
  ok,
  parseOrganisationResolution,
  resolveOrganisation,
  ORGANISATION_RESOLUTION_SETTING_KEY,
  type IOrganisationRepository,
  type ISystemSettingsRepository,
  type IUserRepository,
  type Organisation,
  type OrganisationResolution,
  type Result,
} from "@rbrasier/domain";
import { CreateOrganisation } from "./create-organisation";

// Which self-nomination rules apply when a user submits a nomination. A user is
// prompted to nominate under two configs (ADR-038 §4): `self_nomination`
// directly, or `email_domain` whose `onUnmatched` falls through to nomination.
// The latter is unbounded create-or-join. Any other strategy means nomination is
// not enabled.
const effectiveSelfNomination = (config: OrganisationResolution): OrganisationResolution => {
  if (config.strategy === "self_nomination" && config.selfNomination) return config;
  if (config.strategy === "email_domain" && config.emailDomain?.onUnmatched === "nominate") {
    return { strategy: "self_nomination", selfNomination: { mode: "create_or_join" } };
  }
  return { strategy: "admin" };
};

export interface NominationInput {
  userId: string;
  joinOrganisationId?: string;
  createName?: string;
}

// Executes a user's first-sign-in nomination (ADR-038 §4, self_nomination). The
// pure `resolveOrganisation` decides whether the nomination is a join, a create,
// or a rejection against the configured allowlist/mode; this use-case performs
// the IO the decision calls for and writes the user's organisation.
export class SubmitOrganisationNomination {
  constructor(
    private readonly users: IUserRepository,
    private readonly organisations: IOrganisationRepository,
    private readonly systemSettings: ISystemSettingsRepository,
  ) {}

  async execute(input: NominationInput): Promise<Result<Organisation | null>> {
    const configResult = await this.systemSettings.get(ORGANISATION_RESOLUTION_SETTING_KEY);
    if (configResult.error) return configResult;
    const config = configResult.data?.value
      ? parseOrganisationResolution(configResult.data.value)
      : DEFAULT_ORGANISATION_RESOLUTION;

    const decision = resolveOrganisation(effectiveSelfNomination(config), {
      nomination: { joinOrganisationId: input.joinOrganisationId, createName: input.createName },
    });

    if (decision.kind === "noop") {
      return err(domainError("VALIDATION_FAILED", "Self-nomination is not enabled."));
    }
    if (decision.kind === "rejected") {
      return err(domainError("VALIDATION_FAILED", decision.reason));
    }
    if (decision.kind === "assignExisting") {
      return this.assign(input.userId, decision.organisationId);
    }
    if (decision.kind === "createNominated") {
      const created = await new CreateOrganisation(this.organisations).execute({
        name: decision.name,
      });
      if (created.error) return created;
      return this.assign(input.userId, created.data.id);
    }
    // "nominate"/"noop"/"unaffiliated" — nothing to persist from a nomination
    // that carried no join/create choice.
    return ok(null);
  }

  private async assign(userId: string, organisationId: string): Promise<Result<Organisation | null>> {
    const organisation = await this.organisations.findById(organisationId);
    if (organisation.error) return organisation;
    if (!organisation.data) return err(domainError("NOT_FOUND", "Organisation not found."));
    const updated = await this.users.update(userId, { organisationId });
    if (updated.error) return updated;
    return ok(organisation.data);
  }
}
