import {
  DEFAULT_ORGANISATION_RESOLUTION,
  ORGANISATION_RESOLUTION_SETTING_KEY,
  ok,
  parseOrganisationResolution,
  type ISystemSettingsRepository,
  type OrganisationResolution,
  type Result,
} from "@rbrasier/domain";

// Read the membership-resolution strategy (ADR-038 §4). A missing/malformed row
// defaults to the admin strategy — an administrator keeps control until they opt
// into automatic assignment.
export class GetOrganisationResolution {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(): Promise<Result<OrganisationResolution>> {
    const result = await this.systemSettings.get(ORGANISATION_RESOLUTION_SETTING_KEY);
    if (result.error) return result;
    if (!result.data) return ok(DEFAULT_ORGANISATION_RESOLUTION);
    return ok(parseOrganisationResolution(result.data.value));
  }
}

export class SetOrganisationResolution {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(config: OrganisationResolution): Promise<Result<OrganisationResolution>> {
    // Round-trip through the tolerant parser so only well-formed, known shapes
    // are ever persisted, regardless of what the caller supplied.
    const normalised = parseOrganisationResolution(JSON.stringify(config));
    const result = await this.systemSettings.set(
      ORGANISATION_RESOLUTION_SETTING_KEY,
      JSON.stringify(normalised),
    );
    if (result.error) return result;
    return ok(normalised);
  }
}
