import {
  AdminExists,
  AssignUserOrganisation,
  CompleteOnboarding,
  CreateFirstAdmin,
  CreateOrganisation,
  DeleteOrganisation,
  GetDeploymentConfig,
  GetOnboardingState,
  GetOrganisationResolution,
  ListOrganisations,
  ResolveOrganisationOnSignIn,
  SetDeploymentConfig,
  SetOrganisationResolution,
  SubmitOrganisationNomination,
  UpdateOrganisation,
} from "@wayfinder/application";
import { BetterAuthAdminAccountCreator, type Auth, type Database } from "@wayfinder/adapters";
import type {
  IAuditLogger,
  IClock,
  IOrganisationRepository,
  ISystemSettingsRepository,
  IUserRepository,
} from "@wayfinder/domain";

export interface OnboardingDeps {
  db: Database;
  getAuth: () => Promise<Auth>;
  systemSettings: ISystemSettingsRepository;
  auditLogger: IAuditLogger;
  clock: IClock;
  users: IUserRepository;
  organisations: IOrganisationRepository;
  envSetupToken: string | null;
  seedEmail: string | null;
}

// The first-run onboarding + organisation/deployment cluster (ADR-041, ADR-038),
// factored out of the main container to keep container.ts under the source-size
// ceiling. The startup setup-link emitter deliberately does not come through
// here — see lib/setup-link.ts.
export const buildOnboarding = (deps: OnboardingDeps) => {
  const adminAccountCreator = new BetterAuthAdminAccountCreator(deps.db, deps.getAuth);

  return {
    useCases: {
      adminExists: new AdminExists(adminAccountCreator),
      createFirstAdmin: new CreateFirstAdmin(
        adminAccountCreator,
        deps.systemSettings,
        deps.auditLogger,
        { envSetupToken: deps.envSetupToken, seedEmail: deps.seedEmail },
      ),
      getOnboardingState: new GetOnboardingState(deps.systemSettings),
      completeOnboarding: new CompleteOnboarding(deps.systemSettings, deps.clock),
      getDeploymentConfig: new GetDeploymentConfig(deps.systemSettings),
      setDeploymentConfig: new SetDeploymentConfig(deps.systemSettings),
      listOrganisations: new ListOrganisations(deps.organisations),
      createOrganisation: new CreateOrganisation(deps.organisations),
      updateOrganisation: new UpdateOrganisation(deps.organisations),
      deleteOrganisation: new DeleteOrganisation(deps.organisations),
      assignUserOrganisation: new AssignUserOrganisation(deps.users, deps.organisations),
      getOrganisationResolution: new GetOrganisationResolution(deps.systemSettings),
      setOrganisationResolution: new SetOrganisationResolution(deps.systemSettings),
      submitOrganisationNomination: new SubmitOrganisationNomination(
        deps.users,
        deps.organisations,
        deps.systemSettings,
      ),
      resolveOrganisationOnSignIn: new ResolveOrganisationOnSignIn(
        deps.users,
        deps.organisations,
        deps.systemSettings,
      ),
    },
  };
};
