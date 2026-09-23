import { describe, expect, it } from "vitest";
import {
  BRANDING_CONFIG_SETTING_KEY,
  BRANDING_LOGO_MAX_BYTES,
  parseBrandingConfig,
  type BrandingConfig,
} from "@rbrasier/domain";
import {
  InMemoryAuditLog,
  InMemoryObjectStorage,
  InMemorySystemSettings,
  PNG_BYTES,
  SVG_BYTES,
} from "../__fixtures__/presentation-doubles";
import { RemoveBrandingLogo } from "./remove-branding-logo";
import { SetBranding } from "./set-branding";
import { UploadBrandingLogo } from "./upload-branding-logo";

const ADMIN_ID = "admin-1";

const storedBranding = (settings: InMemorySystemSettings): BrandingConfig =>
  parseBrandingConfig(settings.values.get(BRANDING_CONFIG_SETTING_KEY) ?? "{}");

const seedBranding = (settings: InMemorySystemSettings, config: BrandingConfig): void => {
  settings.values.set(BRANDING_CONFIG_SETTING_KEY, JSON.stringify(config));
};

describe("SetBranding", () => {
  it("saves a readable colour and a display name", async () => {
    const settings = new InMemorySystemSettings();
    const audit = new InMemoryAuditLog();

    const result = await new SetBranding(settings, audit).execute(
      { displayName: "  Acme Procurement ", primaryColour: "#0F766E" },
      ADMIN_ID,
    );

    expect(result.error).toBeUndefined();
    expect(storedBranding(settings)).toEqual({
      displayName: "Acme Procurement",
      primaryColour: "#0f766e",
      logo: null,
    });
    expect(audit.rows.map((row) => row.action)).toEqual(["branding.updated"]);
    expect(audit.rows[0]?.actorId).toBe(ADMIN_ID);
  });

  it("rejects a colour too light to read and writes nothing", async () => {
    const settings = new InMemorySystemSettings();
    const audit = new InMemoryAuditLog();

    const result = await new SetBranding(settings, audit).execute(
      { displayName: "Acme", primaryColour: "#ffd24a" },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("needs 4.5:1");
    expect(settings.values.has(BRANDING_CONFIG_SETTING_KEY)).toBe(false);
    expect(audit.rows).toEqual([]);
  });

  it("rejects a display name over the limit", async () => {
    const settings = new InMemorySystemSettings();

    const result = await new SetBranding(settings, new InMemoryAuditLog()).execute(
      { displayName: "x".repeat(41), primaryColour: null },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("clears the colour back to the Wayfinder default", async () => {
    const settings = new InMemorySystemSettings();
    seedBranding(settings, { displayName: "Acme", primaryColour: "#0f766e", logo: null });

    await new SetBranding(settings, new InMemoryAuditLog()).execute(
      { displayName: "Acme", primaryColour: null },
      ADMIN_ID,
    );

    expect(storedBranding(settings).primaryColour).toBeNull();
  });

  it("keeps the uploaded logo when the name and colour change", async () => {
    const settings = new InMemorySystemSettings();
    const logo = { key: "branding/logo-100", mimeType: "image/png" as const, version: 100 };
    seedBranding(settings, { displayName: "", primaryColour: null, logo });

    await new SetBranding(settings, new InMemoryAuditLog()).execute(
      { displayName: "Acme", primaryColour: "#0f766e" },
      ADMIN_ID,
    );

    expect(storedBranding(settings).logo).toEqual(logo);
  });

  it("does not overwrite the row when it cannot be read", async () => {
    const settings = new InMemorySystemSettings();
    settings.failReads = true;

    const result = await new SetBranding(settings, new InMemoryAuditLog()).execute(
      { displayName: "Acme", primaryColour: null },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(settings.values.has(BRANDING_CONFIG_SETTING_KEY)).toBe(false);
  });
});

describe("UploadBrandingLogo", () => {
  const now = new Date("2026-09-23T10:00:00Z");

  it("stores a PNG under the branding prefix and points the config at it", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    const audit = new InMemoryAuditLog();

    const result = await new UploadBrandingLogo(settings, storage, audit).execute(
      PNG_BYTES,
      ADMIN_ID,
      now,
    );

    const expectedKey = `branding/logo-${now.getTime()}`;
    expect(result.data?.logo).toEqual({
      key: expectedKey,
      mimeType: "image/png",
      version: now.getTime(),
    });
    expect(storage.objects.get(expectedKey)?.mimeType).toBe("image/png");
    expect(storedBranding(settings).logo?.key).toBe(expectedKey);
    expect(audit.rows.map((row) => row.action)).toEqual(["branding.logo_updated"]);
  });

  it("takes the type from the bytes, so an SVG is refused whatever it is called", async () => {
    const storage = new InMemoryObjectStorage();

    const result = await new UploadBrandingLogo(
      new InMemorySystemSettings(),
      storage,
      new InMemoryAuditLog(),
    ).execute(SVG_BYTES, ADMIN_ID, now);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("PNG, JPEG or WebP");
    expect(storage.objects.size).toBe(0);
  });

  it("refuses a file over the size limit", async () => {
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(BRANDING_LOGO_MAX_BYTES)]);

    const result = await new UploadBrandingLogo(
      new InMemorySystemSettings(),
      new InMemoryObjectStorage(),
      new InMemoryAuditLog(),
    ).execute(oversized, ADMIN_ID, now);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("512 KB");
  });

  it("deletes the previous logo once the new one is in place", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    const upload = new UploadBrandingLogo(settings, storage, new InMemoryAuditLog());
    await upload.execute(PNG_BYTES, ADMIN_ID, new Date("2026-09-23T09:00:00Z"));

    await upload.execute(PNG_BYTES, ADMIN_ID, now);

    expect([...storage.objects.keys()]).toEqual([`branding/logo-${now.getTime()}`]);
  });

  it("never reuses a version, so a cached old logo can't reappear after remove and re-upload", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    const audit = new InMemoryAuditLog();
    const upload = new UploadBrandingLogo(settings, storage, audit);
    const first = await upload.execute(PNG_BYTES, ADMIN_ID, new Date("2026-09-23T09:00:00Z"));
    await new RemoveBrandingLogo(settings, storage, audit).execute(ADMIN_ID);

    const second = await upload.execute(PNG_BYTES, ADMIN_ID, now);

    expect(second.data?.logo?.version).not.toBe(first.data?.logo?.version);
  });

  it("removes the new object again when the config cannot be saved", async () => {
    const settings = new InMemorySystemSettings();
    settings.failWrites = true;
    const storage = new InMemoryObjectStorage();

    const result = await new UploadBrandingLogo(settings, storage, new InMemoryAuditLog()).execute(
      PNG_BYTES,
      ADMIN_ID,
      now,
    );

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(storage.objects.size).toBe(0);
  });

  it("reports a storage failure without touching the config", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    storage.failPuts = true;

    const result = await new UploadBrandingLogo(settings, storage, new InMemoryAuditLog()).execute(
      PNG_BYTES,
      ADMIN_ID,
      now,
    );

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(settings.values.has(BRANDING_CONFIG_SETTING_KEY)).toBe(false);
  });
});

describe("RemoveBrandingLogo", () => {
  it("clears the logo and deletes the stored file", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    const audit = new InMemoryAuditLog();
    await new UploadBrandingLogo(settings, storage, audit).execute(PNG_BYTES, ADMIN_ID);

    const result = await new RemoveBrandingLogo(settings, storage, audit).execute(ADMIN_ID);

    expect(result.data?.logo).toBeNull();
    expect(storedBranding(settings).logo).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(audit.rows.map((row) => row.action)).toEqual([
      "branding.logo_updated",
      "branding.logo_removed",
    ]);
  });

  it("keeps the name and colour", async () => {
    const settings = new InMemorySystemSettings();
    const logo = { key: "branding/logo-100", mimeType: "image/png" as const, version: 100 };
    seedBranding(settings, { displayName: "Acme", primaryColour: "#0f766e", logo });

    await new RemoveBrandingLogo(settings, new InMemoryObjectStorage(), new InMemoryAuditLog()).execute(
      ADMIN_ID,
    );

    expect(storedBranding(settings)).toEqual({
      displayName: "Acme",
      primaryColour: "#0f766e",
      logo: null,
    });
  });

  it("is a no-op when there is no logo", async () => {
    const settings = new InMemorySystemSettings();
    const audit = new InMemoryAuditLog();

    const result = await new RemoveBrandingLogo(settings, new InMemoryObjectStorage(), audit).execute(
      ADMIN_ID,
    );

    expect(result.data?.logo).toBeNull();
    expect(audit.rows).toEqual([]);
  });

  it("still clears the config when the old file cannot be deleted", async () => {
    const settings = new InMemorySystemSettings();
    const storage = new InMemoryObjectStorage();
    await new UploadBrandingLogo(settings, storage, new InMemoryAuditLog()).execute(
      PNG_BYTES,
      ADMIN_ID,
    );
    storage.failDeletes = true;

    const result = await new RemoveBrandingLogo(settings, storage, new InMemoryAuditLog()).execute(
      ADMIN_ID,
    );

    expect(result.error).toBeUndefined();
    expect(storedBranding(settings).logo).toBeNull();
  });
});
