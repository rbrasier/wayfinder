import {
  DEFAULT_ORGANISATION_RESOLUTION,
  domainError,
  emailDomainOf,
  err,
  ok,
  parseOrganisationResolution,
  parseOrganisationsEnabled,
  resolveOrganisation,
  ORGANISATION_RESOLUTION_SETTING_KEY,
  ORGANISATIONS_ENABLED_SETTING_KEY,
  type IOrganisationRepository,
  type ISystemSettingsRepository,
  type IUserRepository,
  type Result,
} from "@rbrasier/domain";

// What the caller (a first-login gate) should do next.
export type OrganisationSignInOutcome =
  // The user has an organisation, or one was just auto-assigned. Nothing to show.
  | { status: "resolved" }
  // The user must be prompted to create or join (self_nomination, or an
  // email-domain miss with onUnmatched=nominate).
  | { status: "nominate" }
  // Nothing to do: admin strategy, unaffiliated, or an sso_claim that can only be
  // resolved with the live IdP claim at OAuth time (not available post-hoc).
  | { status: "none" };

// Runs the membership-resolution strategy against a user on sign-in (ADR-038 §4).
// Automatic strategies that can be resolved from the stored user (email_domain)
// assign here; strategies that need a prompt return `nominate` for the UI gate.
export class ResolveOrganisationOnSignIn {
  constructor(
    private readonly users: IUserRepository,
    private readonly organisations: IOrganisationRepository,
    private readonly systemSettings: ISystemSettingsRepository,
  ) {}

  async execute(userId: string): Promise<Result<OrganisationSignInOutcome>> {
    const userResult = await this.users.findById(userId);
    if (userResult.error) return userResult;
    const user = userResult.data;
    if (!user) return err(domainError("NOT_FOUND", "User not found."));
    if (user.organisationId) return ok({ status: "resolved" });

    // With organisations disabled the whole feature is dormant — never prompt a
    // user to nominate, regardless of the configured strategy (ADR-038).
    const enabledResult = await this.systemSettings.get(ORGANISATIONS_ENABLED_SETTING_KEY);
    if (enabledResult.error) return enabledResult;
    if (!parseOrganisationsEnabled(enabledResult.data?.value)) return ok({ status: "none" });

    const configResult = await this.systemSettings.get(ORGANISATION_RESOLUTION_SETTING_KEY);
    if (configResult.error) return configResult;
    const config = configResult.data?.value
      ? parseOrganisationResolution(configResult.data.value)
      : DEFAULT_ORGANISATION_RESOLUTION;

    const decision = resolveOrganisation(config, {
      email: { domain: emailDomainOf(user.email), verified: user.emailVerified },
    });

    if (decision.kind === "assignExisting") {
      const organisation = await this.organisations.findById(decision.organisationId);
      if (organisation.error) return organisation;
      if (!organisation.data) return ok({ status: "none" });
      const updated = await this.users.update(userId, { organisationId: decision.organisationId });
      if (updated.error) return updated;
      return ok({ status: "resolved" });
    }
    if (decision.kind === "nominate") return ok({ status: "nominate" });
    // "noop" | "unaffiliated" | "resolveByClaim" | "createNominated" — nothing the
    // gate can act on from the stored user alone.
    return ok({ status: "none" });
  }
}
