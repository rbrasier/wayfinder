import {
  BRANDING_LOGO_MAX_BYTES,
  brandingLogoKey,
  domainError,
  err,
  sniffLogoMimeType,
  type BrandingConfig,
  type IAuditLogger,
  type IObjectStorage,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";
import { readBrandingConfig, writeBrandingConfig } from "./branding-settings";

// Stores a new logo and points the branding row at it (ADR-060 §4). The type is
// taken from the file's bytes, so a renamed SVG is refused.
export class UploadBrandingLogo {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(
    content: Buffer,
    actorId: string,
    now: Date = new Date(),
  ): Promise<Result<BrandingConfig>> {
    if (content.length > BRANDING_LOGO_MAX_BYTES) {
      return err(domainError("VALIDATION_FAILED", "The logo must be 512 KB or smaller."));
    }
    const mimeType = sniffLogoMimeType(content);
    if (!mimeType) {
      return err(
        domainError("VALIDATION_FAILED", "Use a PNG, JPEG or WebP image. SVG isn't accepted."),
      );
    }

    const current = await readBrandingConfig(this.systemSettings);
    if (current.error) return current;

    // The upload time, not a counter: the logo URL is cached as immutable per
    // version, and a counter would hand out a used number again after the logo
    // is removed and a new one uploaded.
    const version = Math.max(now.getTime(), (current.data.logo?.version ?? 0) + 1);
    const key = brandingLogoKey(version);
    const stored = await this.objectStorage.put(key, content, mimeType);
    if (stored.error) return stored;

    const saved = await writeBrandingConfig(this.systemSettings, {
      ...current.data,
      logo: { key, mimeType, version },
    });
    if (saved.error) {
      await this.objectStorage.delete(key);
      return saved;
    }

    // Best effort: an orphaned old file costs a little storage, never correctness.
    if (current.data.logo) await this.objectStorage.delete(current.data.logo.key);

    await this.auditLogger.log({
      actorId,
      action: "branding.logo_updated",
      resourceType: "branding",
      resourceId: key,
      metadata: { mimeType, sizeBytes: content.length },
    });
    return saved;
  }
}
