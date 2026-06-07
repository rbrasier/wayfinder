import { describe, expect, it } from "vitest";
import {
  ok,
  type FeatureFlag,
  type IFeatureFlagRepository,
  type IFeatureFlagRoleRepository,
  type IUserRoleRepository,
  type NewFeatureFlag,
  type Result,
  type Role,
} from "@rbrasier/domain";
import { IsFeatureEnabledForUser, SetFeatureFlagRoles } from "./get-feature-flag";

class FakeFeatureFlagRepository implements IFeatureFlagRepository {
  flags = new Map<string, FeatureFlag>();

  seed(flag: FeatureFlag): void {
    this.flags.set(flag.key, flag);
  }
  async findByKey(key: string): Promise<Result<FeatureFlag | null>> {
    return ok(this.flags.get(key) ?? null);
  }
  async upsert(input: NewFeatureFlag): Promise<Result<FeatureFlag>> {
    const flag: FeatureFlag = {
      id: input.key,
      key: input.key,
      enabled: input.enabled ?? false,
      rolloutPct: input.rolloutPct ?? 100,
      description: input.description ?? null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.flags.set(flag.key, flag);
    return ok(flag);
  }
  async list(): Promise<Result<FeatureFlag[]>> {
    return ok([...this.flags.values()]);
  }
}

class FakeFeatureFlagRoleRepository implements IFeatureFlagRoleRepository {
  allowlists = new Map<string, string[]>();
  async listRoleIdsForFlag(flagKey: string): Promise<Result<string[]>> {
    return ok(this.allowlists.get(flagKey) ?? []);
  }
  async replaceRolesForFlag(flagKey: string, roleIds: string[]): Promise<Result<void>> {
    this.allowlists.set(flagKey, [...roleIds]);
    return ok(undefined);
  }
}

class FakeUserRoleRepository implements IUserRoleRepository {
  userRoleIds = new Map<string, string[]>();
  async listRolesForUser(userId: string): Promise<Result<Role[]>> {
    const ids = this.userRoleIds.get(userId) ?? [];
    return ok(
      ids.map((id) => ({
        id,
        key: id,
        name: id,
        description: null,
        isSystem: false,
        isImmutable: false,
        isDefault: false,
      })),
    );
  }
  async listUsersForRole(): Promise<Result<string[]>> {
    return ok([]);
  }
  async assign(): Promise<Result<void>> {
    return ok(undefined);
  }
  async remove(): Promise<Result<void>> {
    return ok(undefined);
  }
}

const flag = (key: string, enabled: boolean): FeatureFlag => ({
  id: key,
  key,
  enabled,
  rolloutPct: 100,
  description: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe("IsFeatureEnabledForUser", () => {
  it("returns false when the flag is off (and not a default-on flag)", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", false));
    const useCase = new IsFeatureEnabledForUser(
      flags,
      new FakeFeatureFlagRoleRepository(),
      new FakeUserRoleRepository(),
    );
    const result = await useCase.execute("user-1", "auto_node", false);
    expect(result.data).toBe(false);
  });

  it("honours DEFAULT_ENABLED_FLAGS when there is no flag row", async () => {
    const useCase = new IsFeatureEnabledForUser(
      new FakeFeatureFlagRepository(),
      new FakeFeatureFlagRoleRepository(),
      new FakeUserRoleRepository(),
    );
    const enabled = await useCase.execute("user-1", "scheduled_node", false);
    const disabled = await useCase.execute("user-1", "auto_node", false);
    expect(enabled.data).toBe(true);
    expect(disabled.data).toBe(false);
  });

  it("returns true when on with an empty allowlist", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", true));
    const useCase = new IsFeatureEnabledForUser(
      flags,
      new FakeFeatureFlagRoleRepository(),
      new FakeUserRoleRepository(),
    );
    const result = await useCase.execute("user-1", "auto_node", false);
    expect(result.data).toBe(true);
  });

  it("returns true for an admin even when their roles do not intersect the allowlist", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", true));
    const flagRoles = new FakeFeatureFlagRoleRepository();
    flagRoles.allowlists.set("auto_node", ["power"]);
    const useCase = new IsFeatureEnabledForUser(flags, flagRoles, new FakeUserRoleRepository());
    const result = await useCase.execute("admin-1", "auto_node", true);
    expect(result.data).toBe(true);
  });

  it("returns true iff the user's roles intersect the allowlist", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", true));
    const flagRoles = new FakeFeatureFlagRoleRepository();
    flagRoles.allowlists.set("auto_node", ["power"]);
    const userRoles = new FakeUserRoleRepository();
    userRoles.userRoleIds.set("power-user", ["power"]);

    const useCase = new IsFeatureEnabledForUser(flags, flagRoles, userRoles);
    const permitted = await useCase.execute("power-user", "auto_node", false);
    const denied = await useCase.execute("ordinary-user", "auto_node", false);
    expect(permitted.data).toBe(true);
    expect(denied.data).toBe(false);
  });
});

describe("SetFeatureFlagRoles", () => {
  it("upserts a flag row then replaces the allowlist", async () => {
    const flags = new FakeFeatureFlagRepository();
    const flagRoles = new FakeFeatureFlagRoleRepository();
    const useCase = new SetFeatureFlagRoles(flags, flagRoles);

    // scheduled_node is default-on without a row; scoping should persist a row.
    await useCase.execute("scheduled_node", ["power"]);

    expect(flags.flags.get("scheduled_node")?.enabled).toBe(true);
    expect((await flagRoles.listRoleIdsForFlag("scheduled_node")).data).toEqual(["power"]);
  });

  it("clears scoping when given an empty array", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", true));
    const flagRoles = new FakeFeatureFlagRoleRepository();
    flagRoles.allowlists.set("auto_node", ["power"]);
    const useCase = new SetFeatureFlagRoles(flags, flagRoles);

    await useCase.execute("auto_node", []);

    expect((await flagRoles.listRoleIdsForFlag("auto_node")).data).toEqual([]);
  });

  it("preserves the existing enabled state when scoping", async () => {
    const flags = new FakeFeatureFlagRepository();
    flags.seed(flag("auto_node", false));
    const flagRoles = new FakeFeatureFlagRoleRepository();
    const useCase = new SetFeatureFlagRoles(flags, flagRoles);

    await useCase.execute("auto_node", ["power"]);

    expect(flags.flags.get("auto_node")?.enabled).toBe(false);
  });
});
