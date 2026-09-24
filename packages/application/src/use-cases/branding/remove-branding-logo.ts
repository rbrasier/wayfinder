import {
  ok,
  type BrandingConfig,
  type IAuditLogger,
  type IObjectStorage,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";
import { readBrandingConfig, writeBrandingConfig } from "./branding-settings";

// Returns the install to the "W" tile. The row is cleared first, so a failed
// file delete leaves an unused object rather than a logo pointing at nothing.
export class RemoveBrandingLogo {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(actorId: string): Promise<Result<BrandingConfig>> {
    const current = await readBrandingConfig(this.systemSettings);
    if (current.error) return current;
    const previousLogo = current.data.logo;
    if (!previousLogo) return ok(current.data);

    const saved = await writeBrandingConfig(this.systemSettings, { ...current.data, logo: null });
    if (saved.error) return saved;

    await this.objectStorage.delete(previousLogo.key);
    await this.auditLogger.log({
      actorId,
      action: "branding.logo_removed",
      resourceType: "branding",
      resourceId: previousLogo.key,
    });
    return saved;
  }
}
