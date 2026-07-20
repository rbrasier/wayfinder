import { describe, expect, it } from "vitest";
import {
  SETUP_TOKEN_SETTING_KEY,
  domainError,
  err,
  ok,
  type CreateAdminAccountInput,
  type IAdminAccountCreator,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type NewAuditLog,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import { AdminExists, CreateFirstAdmin } from "./create-admin";

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
  created: CreateAdminAccountInput[] = [];
  hasAdmin = false;
  // Simulates losing the transactional singleton race even after the fast-fail
  // passed: the adapter refuses with CONFLICT.
  raceLost = false;

  async adminExists(): Promise<Result<boolean>> {
    return ok(this.hasAdmin);
  }
  async createFirstAdmin(input: CreateAdminAccountInput): Promise<Result<{ userId: string }>> {
    if (this.raceLost) return err(domainError("CONFLICT", "An administrator already exists."));
    this.created.push(input);
    this.hasAdmin = true;
    return ok({ userId: "admin-1" });
  }
}

class FakeAuditLogger implements IAuditLogger {
  events: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.events.push(payload);
    return ok(true);
  }
}

const baseConfig = { envSetupToken: null as string | null, seedEmail: null as string | null };

const makeUseCase = (
  overrides: {
    settings?: FakeSettings;
    creator?: FakeAdminCreator;
    audit?: FakeAuditLogger;
    config?: Partial<typeof baseConfig>;
  } = {},
) => {
  const settings = overrides.settings ?? new FakeSettings({ [SETUP_TOKEN_SETTING_KEY]: "good-token" });
  const creator = overrides.creator ?? new FakeAdminCreator();
  const audit = overrides.audit ?? new FakeAuditLogger();
  const useCase = new CreateFirstAdmin(creator, settings, audit, {
    ...baseConfig,
    ...overrides.config,
  });
  return { useCase, settings, creator, audit };
};

describe("AdminExists", () => {
  it("reflects whether an admin exists", async () => {
    const creator = new FakeAdminCreator();
    creator.hasAdmin = true;
    const result = await new AdminExists(creator).execute();
    expect(result.data).toBe(true);
  });
});

describe("CreateFirstAdmin", () => {
  it("creates the admin on an empty install with a valid token", async () => {
    const { useCase, creator } = makeUseCase();

    const result = await useCase.execute({
      email: "admin@example.com",
      password: "password123",
      token: "good-token",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.userId).toBe("admin-1");
    expect(creator.created).toHaveLength(1);
  });

  it("voids the setup token on success", async () => {
    const { useCase, settings } = makeUseCase();

    await useCase.execute({ email: "a@b.com", password: "password123", token: "good-token" });

    expect(settings.store.has(SETUP_TOKEN_SETTING_KEY)).toBe(false);
  });

  it("writes an audit event on success", async () => {
    const { useCase, audit } = makeUseCase();

    await useCase.execute({ email: "a@b.com", password: "password123", token: "good-token" });

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toContain("admin");
  });

  it("rejects a wrong token and does not create anything", async () => {
    const { useCase, creator } = makeUseCase();

    const result = await useCase.execute({
      email: "a@b.com",
      password: "password123",
      token: "wrong",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(creator.created).toHaveLength(0);
  });

  it("rejects when no setup token exists (bootstrap window closed)", async () => {
    const { useCase } = makeUseCase({ settings: new FakeSettings() });

    const result = await useCase.execute({
      email: "a@b.com",
      password: "password123",
      token: "anything",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses when an admin already exists (fast-fail before creation)", async () => {
    const creator = new FakeAdminCreator();
    creator.hasAdmin = true;
    const { useCase } = makeUseCase({ creator });

    const result = await useCase.execute({
      email: "a@b.com",
      password: "password123",
      token: "good-token",
    });

    expect(result.error?.code).toBe("CONFLICT");
    expect(creator.created).toHaveLength(0);
  });

  it("propagates the adapter's CONFLICT when it loses the singleton race", async () => {
    const creator = new FakeAdminCreator();
    creator.raceLost = true;
    const { useCase } = makeUseCase({ creator });

    const result = await useCase.execute({
      email: "a@b.com",
      password: "password123",
      token: "good-token",
    });

    expect(result.error?.code).toBe("CONFLICT");
  });

  it("honours seed-email binding: rejects a non-matching email", async () => {
    const { useCase, creator } = makeUseCase({ config: { seedEmail: "boss@corp.com" } });

    const result = await useCase.execute({
      email: "attacker@evil.com",
      password: "password123",
      token: "good-token",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(creator.created).toHaveLength(0);
  });

  it("honours seed-email binding: accepts the bound email case-insensitively", async () => {
    const { useCase } = makeUseCase({ config: { seedEmail: "Boss@Corp.com" } });

    const result = await useCase.execute({
      email: "boss@corp.com",
      password: "password123",
      token: "good-token",
    });

    expect(result.error).toBeUndefined();
  });

  it("accepts the env setup token when no DB row is present", async () => {
    const { useCase } = makeUseCase({
      settings: new FakeSettings(),
      config: { envSetupToken: "env-token" },
    });

    const result = await useCase.execute({
      email: "a@b.com",
      password: "password123",
      token: "env-token",
    });

    expect(result.error).toBeUndefined();
  });
});
