import { describe, expect, it } from "vitest";
import {
  SETUP_TOKEN_SETTING_KEY,
  ok,
  type CreateAdminAccountInput,
  type IAdminAccountCreator,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import { EnsureSetupToken } from "./setup-token";

class FakeSettings implements ISystemSettingsRepository {
  store = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.store.set(key, value);
  }
  async get(key: string): Promise<Result<SystemSetting | null>> {
    const value = this.store.get(key);
    if (value === undefined) return ok(null);
    return ok({ key, value, createdAt: new Date(0), updatedAt: new Date(0) });
  }
  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    this.store.set(key, value);
    return ok({ key, value, createdAt: new Date(0), updatedAt: new Date(0) });
  }
  async delete(key: string): Promise<Result<void>> {
    this.store.delete(key);
    return ok(undefined);
  }
}

class FakeAdminCreator implements IAdminAccountCreator {
  constructor(private readonly hasAdmin: boolean) {}
  async adminExists(): Promise<Result<boolean>> {
    return ok(this.hasAdmin);
  }
  async createFirstAdmin(_input: CreateAdminAccountInput): Promise<Result<{ userId: string }>> {
    return ok({ userId: "u1" });
  }
}

describe("EnsureSetupToken", () => {
  it("returns null and persists nothing once an admin exists", async () => {
    const settings = new FakeSettings();
    const useCase = new EnsureSetupToken(new FakeAdminCreator(true), settings, {
      envSetupToken: null,
      generateToken: () => "generated",
    });

    const result = await useCase.execute();

    expect(result.data).toBeNull();
    expect(settings.store.has(SETUP_TOKEN_SETTING_KEY)).toBe(false);
  });

  it("prefers the env override and does not persist it", async () => {
    const settings = new FakeSettings();
    const useCase = new EnsureSetupToken(new FakeAdminCreator(false), settings, {
      envSetupToken: "from-env",
      generateToken: () => "generated",
    });

    const result = await useCase.execute();

    expect(result.data).toBe("from-env");
    expect(settings.store.has(SETUP_TOKEN_SETTING_KEY)).toBe(false);
  });

  it("generates and persists a token on first boot with no admin", async () => {
    const settings = new FakeSettings();
    const useCase = new EnsureSetupToken(new FakeAdminCreator(false), settings, {
      envSetupToken: null,
      generateToken: () => "generated",
    });

    const result = await useCase.execute();

    expect(result.data).toBe("generated");
    expect(settings.store.get(SETUP_TOKEN_SETTING_KEY)).toBe("generated");
  });

  it("reuses an existing persisted token across restarts", async () => {
    const settings = new FakeSettings({ [SETUP_TOKEN_SETTING_KEY]: "persisted" });
    const useCase = new EnsureSetupToken(new FakeAdminCreator(false), settings, {
      envSetupToken: null,
      generateToken: () => "generated",
    });

    const result = await useCase.execute();

    expect(result.data).toBe("persisted");
  });
});
