import { ok, type PermissionKey } from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { featureFlagRouter } from "./feature-flag";
import { settingsRouter } from "./settings";
import { skillRouter } from "./skill";

// The gates that depend on a procedure's input, which admin-area-gates.test.ts
// cannot see because it probes without one (ADR-066 §4–5).

const createCaller = createCallerFactory(
  router({ settings: settingsRouter, skill: skillRouter, featureFlag: featureFlagRouter }),
);

const makeContainer = () => {
  const systemSettings = {
    get: vi.fn().mockResolvedValue(ok("stored value")),
    set: vi.fn().mockResolvedValue(ok(undefined)),
  };
  const listSkills = { execute: vi.fn().mockResolvedValue(ok([])) };
  const isFeatureEnabled = { execute: vi.fn().mockResolvedValue(ok(true)) };
  const container = {
    services: { errorLogger: { log: async () => undefined } },
    repos: { systemSettings },
    useCases: { listSkills, isFeatureEnabled },
  } as unknown as Container;
  return { container, systemSettings, listSkills, isFeatureEnabled };
};

const callerWith = (container: Container, permissions: PermissionKey[], isAdmin = false) =>
  createCaller({
    container,
    userId: "user-1",
    authSessionId: null,
    isAdmin,
    permissions: new Set(permissions),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("settings.get / settings.set — raw key allowlist", () => {
  it("lets a Technical Admin read and write the global instructions", async () => {
    const { container, systemSettings } = makeContainer();
    const technicalAdmin = callerWith(container, ["admin:technical"]);

    await expect(technicalAdmin.settings.get({ key: "global_prompt" })).resolves.toBe("stored value");
    await technicalAdmin.settings.set({ key: "global_prompt", value: "Be concise." });

    expect(systemSettings.set).toHaveBeenCalledWith("global_prompt", "Be concise.");
  });

  it("refuses a Technical Admin any other raw setting, so auth config stays Global-only", async () => {
    const { container, systemSettings } = makeContainer();
    const technicalAdmin = callerWith(container, ["admin:technical"]);

    await expect(technicalAdmin.settings.get({ key: "organisation_name" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      technicalAdmin.settings.set({ key: "auth_config", value: "{}" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(systemSettings.set).not.toHaveBeenCalled();
  });

  it("lets a Global Admin reach any raw setting", async () => {
    const { container, systemSettings } = makeContainer();

    await callerWith(container, [], true).settings.set({ key: "organisation_name", value: "Acme" });

    expect(systemSettings.set).toHaveBeenCalledWith("organisation_name", "Acme");
  });
});

describe("skill.list — archived skills", () => {
  it("shows active skills to any signed-in user", async () => {
    const { container, listSkills } = makeContainer();

    await callerWith(container, []).skill.list();

    expect(listSkills.execute).toHaveBeenCalledWith({ includeArchived: false });
  });

  it("shows archived skills to a Technical Admin", async () => {
    const { container, listSkills } = makeContainer();

    await callerWith(container, ["admin:technical"]).skill.list({ includeArchived: true });

    expect(listSkills.execute).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("refuses archived skills to anyone without technical admin access", async () => {
    const { container } = makeContainer();

    await expect(
      callerWith(container, ["admin:users"]).skill.list({ includeArchived: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("featureFlag.isAdminSurfaceEnabled (ADR-066 §5)", () => {
  it("reports whether an admin surface's flag is switched on, ignoring its role scoping", async () => {
    const { container, isFeatureEnabled } = makeContainer();

    const enabled = await callerWith(container, ["admin:technical"]).featureFlag.isAdminSurfaceEnabled({
      key: "skills",
    });

    expect(enabled).toBe(true);
    expect(isFeatureEnabled.execute).toHaveBeenCalledWith("skills");
  });

  it("reports false when the flag is switched off", async () => {
    const { container, isFeatureEnabled } = makeContainer();
    isFeatureEnabled.execute.mockResolvedValue(ok(false));

    const enabled = await callerWith(container, ["admin:technical"]).featureFlag.isAdminSurfaceEnabled({
      key: "event_watch",
    });

    expect(enabled).toBe(false);
  });

  it("only answers for the admin surface flags, never a flow-authoring flag", async () => {
    const { container } = makeContainer();

    await expect(
      callerWith(container, ["admin:technical"]).featureFlag.isAdminSurfaceEnabled({
        key: "auto_node" as "skills",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
