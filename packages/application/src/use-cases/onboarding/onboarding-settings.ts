import {
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_ONBOARDING_STATE,
  DEPLOYMENT_CONFIG_SETTING_KEY,
  ONBOARDING_STATE_SETTING_KEY,
  ok,
  parseDeploymentConfig,
  parseOnboardingState,
  type DeploymentConfig,
  type IClock,
  type ISystemSettingsRepository,
  type OnboardingState,
  type Result,
} from "@rbrasier/domain";

// Read the first-run onboarding gate (ADR-041 §1). A missing/malformed row reads
// as an unconfigured install, so the wizard opens.
export class GetOnboardingState {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(): Promise<Result<OnboardingState>> {
    const result = await this.systemSettings.get(ONBOARDING_STATE_SETTING_KEY);
    if (result.error) return result;
    if (!result.data) return ok(DEFAULT_ONBOARDING_STATE);
    return ok(parseOnboardingState(result.data.value));
  }
}

// Mark setup complete. Called by both Finish and Skip (ADR-041 §1); the wizard
// never auto-reappears afterwards.
export class CompleteOnboarding {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly clock: IClock,
  ) {}

  async execute(): Promise<Result<OnboardingState>> {
    const state: OnboardingState = {
      completed: true,
      completedAt: this.clock.now().toISOString(),
    };
    const result = await this.systemSettings.set(
      ONBOARDING_STATE_SETTING_KEY,
      JSON.stringify(state),
    );
    if (result.error) return result;
    return ok(state);
  }
}

export class GetDeploymentConfig {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(): Promise<Result<DeploymentConfig>> {
    const result = await this.systemSettings.get(DEPLOYMENT_CONFIG_SETTING_KEY);
    if (result.error) return result;
    if (!result.data) return ok(DEFAULT_DEPLOYMENT_CONFIG);
    return ok(parseDeploymentConfig(result.data.value));
  }
}

export class SetDeploymentConfig {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(config: DeploymentConfig): Promise<Result<DeploymentConfig>> {
    // Round-trip through the tolerant parser so only the known shape is persisted.
    const normalised = parseDeploymentConfig(JSON.stringify(config));
    const result = await this.systemSettings.set(
      DEPLOYMENT_CONFIG_SETTING_KEY,
      JSON.stringify(normalised),
    );
    if (result.error) return result;
    return ok(normalised);
  }
}
