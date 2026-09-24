import {
  validateBrandColour,
  validateBrandDisplayName,
  type BrandingConfig,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";
import { readBrandingConfig, writeBrandingConfig } from "./branding-settings";

export interface SetBrandingInput {
  readonly displayName: string;
  // Null or blank goes back to the Wayfinder palette.
  readonly primaryColour: string | null;
}

// Saves the display name and colour, keeping whatever logo is uploaded. The
// colour must be readable as link text on the page (ADR-060 §3).
export class SetBranding {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: SetBrandingInput, actorId: string): Promise<Result<BrandingConfig>> {
    const displayName = validateBrandDisplayName(input.displayName);
    if (displayName.error) return displayName;

    const requestedColour = input.primaryColour?.trim() ?? "";
    const colour = requestedColour.length > 0 ? validateBrandColour(requestedColour) : null;
    if (colour?.error) return colour;

    const current = await readBrandingConfig(this.systemSettings);
    if (current.error) return current;

    const saved = await writeBrandingConfig(this.systemSettings, {
      ...current.data,
      displayName: displayName.data,
      primaryColour: colour?.data ?? null,
    });
    if (saved.error) return saved;

    await this.auditLogger.log({
      actorId,
      action: "branding.updated",
      resourceType: "branding",
      metadata: { displayName: saved.data.displayName, primaryColour: saved.data.primaryColour },
    });
    return saved;
  }
}
