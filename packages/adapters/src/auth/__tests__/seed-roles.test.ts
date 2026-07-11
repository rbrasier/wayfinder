import { describe, expect, it } from "vitest";
import {
  ok,
  SYSTEM_ROLE_KEYS,
  type IFeatureFlagRoleRepository,
  type IRoleRepository,
  type NewRole,
  type PermissionKey,
  type Result,
  type Role,
} from "@rbrasier/domain";
import { seedRoles } from "../seed-roles";

class FakeRoleRepository implements IRoleRepository {
  private roles = new Map<string, Role>();
  private permissions = new Map<string, PermissionKey[]>();
  private nextId = 1;

  async list(): Promise<Result<Role[]>> {
    return ok([...this.roles.values()]);
  }

  async findByKey(key: string): Promise<Result<Role | null>> {
    return ok([...this.roles.values()].find((role) => role.key === key) ?? null);
  }

  async findById(id: string): Promise<Result<Role | null>> {
    return ok(this.roles.get(id) ?? null);
  }

  async create(role: NewRole): Promise<Result<Role>> {
    const created: Role = {
      id: `role-${this.nextId++}`,
      key: role.key,
      name: role.name,
      description: role.description ?? null,
      isSystem: role.isSystem ?? false,
      isImmutable: role.isImmutable ?? false,
      isDefault: role.isDefault ?? false,
    };
    this.roles.set(created.id, created);
    return ok(created);
  }

  async listPermissions(roleId: string): Promise<Result<PermissionKey[]>> {
    return ok(this.permissions.get(roleId) ?? []);
  }

  async replacePermissions(roleId: string, keys: PermissionKey[]): Promise<Result<void>> {
    this.permissions.set(roleId, [...keys]);
    return ok(undefined);
  }
}

class FakeFeatureFlagRoleRepository implements IFeatureFlagRoleRepository {
  private allowlists = new Map<string, string[]>();

  async listRoleIdsForFlag(flagKey: string): Promise<Result<string[]>> {
    return ok(this.allowlists.get(flagKey) ?? []);
  }

  async replaceRolesForFlag(flagKey: string, roleIds: string[]): Promise<Result<void>> {
    this.allowlists.set(flagKey, [...roleIds]);
    return ok(undefined);
  }
}

describe("seedRoles", () => {
  it("creates the three system roles with their default grants and flag scoping on first run", async () => {
    const roles = new FakeRoleRepository();
    const flagRoles = new FakeFeatureFlagRoleRepository();

    await seedRoles(roles, flagRoles);

    const everyone = await roles.findByKey(SYSTEM_ROLE_KEYS.everyone);
    const admins = await roles.findByKey(SYSTEM_ROLE_KEYS.admins);
    const powerUsers = await roles.findByKey(SYSTEM_ROLE_KEYS.powerUsers);

    expect(everyone.data?.isDefault).toBe(true);
    expect(admins.data?.isImmutable).toBe(true);
    expect(powerUsers.data?.isSystem).toBe(true);

    const everyoneGrants = await roles.listPermissions(everyone.data!.id);
    expect([...everyoneGrants.data!].sort()).toEqual(
      ["chat:create", "workflow:create_own"].sort(),
    );

    const powerGrants = await roles.listPermissions(powerUsers.data!.id);
    expect([...powerGrants.data!].sort()).toEqual(
      ["flow:advanced_config", "workflow:publish_to_everyone"].sort(),
    );

    const adminGrants = await roles.listPermissions(admins.data!.id);
    expect(adminGrants.data).toEqual([]);

    const autoNodeRoles = await flagRoles.listRoleIdsForFlag("auto_node");
    const scheduledNodeRoles = await flagRoles.listRoleIdsForFlag("scheduled_node");
    const mcpRoles = await flagRoles.listRoleIdsForFlag("mcp");
    const skillsRoles = await flagRoles.listRoleIdsForFlag("skills");
    expect(autoNodeRoles.data).toEqual([powerUsers.data!.id]);
    expect(scheduledNodeRoles.data).toEqual([powerUsers.data!.id]);
    expect(mcpRoles.data).toEqual([powerUsers.data!.id]);
    expect(skillsRoles.data).toEqual([powerUsers.data!.id]);
  });

  it("is a no-op on the second run — no duplicate roles", async () => {
    const roles = new FakeRoleRepository();
    const flagRoles = new FakeFeatureFlagRoleRepository();

    await seedRoles(roles, flagRoles);
    await seedRoles(roles, flagRoles);

    const all = await roles.list();
    expect(all.data!.length).toBe(3);
  });

  it("does not overwrite an admin's later permission edit when re-seeding", async () => {
    const roles = new FakeRoleRepository();
    const flagRoles = new FakeFeatureFlagRoleRepository();

    await seedRoles(roles, flagRoles);

    const everyone = await roles.findByKey(SYSTEM_ROLE_KEYS.everyone);
    await roles.replacePermissions(everyone.data!.id, ["chat:create"]);

    await seedRoles(roles, flagRoles);

    const grants = await roles.listPermissions(everyone.data!.id);
    expect(grants.data).toEqual(["chat:create"]);
  });

  it("does not overwrite an admin's later flag scoping edit when re-seeding", async () => {
    const roles = new FakeRoleRepository();
    const flagRoles = new FakeFeatureFlagRoleRepository();

    await seedRoles(roles, flagRoles);
    await flagRoles.replaceRolesForFlag("auto_node", []);

    await seedRoles(roles, flagRoles);

    const autoNodeRoles = await flagRoles.listRoleIdsForFlag("auto_node");
    expect(autoNodeRoles.data).toEqual([]);
  });
});
