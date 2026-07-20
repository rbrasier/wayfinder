import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_CONFIG_SETTING_KEY,
  ONBOARDING_STATE_SETTING_KEY,
  ok,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import {
  CompleteOnboarding,
  GetDeploymentConfig,
  GetOnboardingState,
  SetDeploymentConfig,
} from "./onboarding-settings";

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

const fixedClock = { now: () => new Date("2026-07-20T12:00:00.000Z") };

describe("GetOnboardingState", () => {
  it("defaults a fresh install to not completed", async () => {
    const result = await new GetOnboardingState(new FakeSettings()).execute();
    expect(result.data).toEqual({ completed: false, completedAt: null });
  });

  it("reads a stored completed state", async () => {
    const settings = new FakeSettings({
      [ONBOARDING_STATE_SETTING_KEY]: JSON.stringify({
        completed: true,
        completedAt: "2026-07-20T12:00:00.000Z",
      }),
    });
    const result = await new GetOnboardingState(settings).execute();
    expect(result.data?.completed).toBe(true);
  });
});

describe("CompleteOnboarding", () => {
  it("marks setup completed and stamps the completion time from the clock", async () => {
    const settings = new FakeSettings();
    const result = await new CompleteOnboarding(settings, fixedClock).execute();

    expect(result.data).toEqual({
      completed: true,
      completedAt: "2026-07-20T12:00:00.000Z",
    });
    const stored = await settings.get(ONBOARDING_STATE_SETTING_KEY);
    expect(JSON.parse(stored.data!.value).completed).toBe(true);
  });
});

describe("GetDeploymentConfig / SetDeploymentConfig", () => {
  it("defaults to single organisation", async () => {
    const result = await new GetDeploymentConfig(new FakeSettings()).execute();
    expect(result.data).toEqual({ multiOrganisation: false });
  });

  it("persists and reads back the multi-organisation choice", async () => {
    const settings = new FakeSettings();
    await new SetDeploymentConfig(settings).execute({ multiOrganisation: true });

    const result = await new GetDeploymentConfig(settings).execute();
    expect(result.data).toEqual({ multiOrganisation: true });
  });

  it("normalises an unknown-shaped input to a safe value", async () => {
    const settings = new FakeSettings();
    // Extra fields are dropped by the tolerant parser round-trip.
    await new SetDeploymentConfig(settings).execute({
      multiOrganisation: true,
      rogue: "value",
    } as never);

    const stored = await settings.get(DEPLOYMENT_CONFIG_SETTING_KEY);
    expect(JSON.parse(stored.data!.value)).toEqual({ multiOrganisation: true });
  });
});
