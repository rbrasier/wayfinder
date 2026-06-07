import { describe, expect, it } from "vitest";
import {
  ok,
  type IRoleRepository,
  type IUserRoleRepository,
  type NewRole,
  type PermissionKey,
  type Result,
  type Role,
} from "@rbrasier/domain";
import { ListRoles } from "./list-roles";
import { UpdateRolePermissions } from "./update-role-permissions";
import { AssignUserRole } from "./assign-user-role";
import { RemoveUserRole } from "./remove-user-role";
import { GetEffectivePermissions } from "./get-effective-permissions";
import { ListUsersForRole } from "./list-users-for-role";

class FakeRoleRepository implements IRoleRepository {
  roles = new Map<string, Role>();
  permissions = new Map<string, PermissionKey[]>();
  private nextId = 1;

  seed(role: Role, permissions: PermissionKey[] = []): Role {
    this.roles.set(role.id, role);
    this.permissions.set(role.id, permissions);
    return role;
  }

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

class FakeUserRoleRepository implements IUserRoleRepository {
  assignments = new Set<string>();

  private key(userId: string, roleId: string): string {
    return `${userId}:${roleId}`;
  }
  constructor(private readonly roleSource: FakeRoleRepository) {}

  async listRolesForUser(userId: string): Promise<Result<Role[]>> {
    const roles: Role[] = [];
    for (const entry of this.assignments) {
      const [assignedUser, roleId] = entry.split(":");
      if (assignedUser !== userId) continue;
      const role = this.roleSource.roles.get(roleId);
      if (role) roles.push(role);
    }
    return ok(roles);
  }
  async listUsersForRole(roleId: string): Promise<Result<string[]>> {
    const users: string[] = [];
    for (const entry of this.assignments) {
      const [assignedUser, assignedRole] = entry.split(":");
      if (assignedRole === roleId) users.push(assignedUser);
    }
    return ok(users);
  }
  async assign(userId: string, roleId: string): Promise<Result<void>> {
    this.assignments.add(this.key(userId, roleId));
    return ok(undefined);
  }
  async remove(userId: string, roleId: string): Promise<Result<void>> {
    this.assignments.delete(this.key(userId, roleId));
    return ok(undefined);
  }
}

const everyone: Role = {
  id: "everyone",
  key: "everyone",
  name: "Everyone",
  description: null,
  isSystem: true,
  isImmutable: false,
  isDefault: true,
};
const admins: Role = {
  id: "admins",
  key: "admins",
  name: "Admins",
  description: null,
  isSystem: true,
  isImmutable: true,
  isDefault: false,
};
const powerUsers: Role = {
  id: "power",
  key: "power_users",
  name: "Power Users",
  description: null,
  isSystem: true,
  isImmutable: false,
  isDefault: false,
};

const seededRepos = () => {
  const roles = new FakeRoleRepository();
  roles.seed(everyone, ["chat:create", "workflow:create_own"]);
  roles.seed(admins, []);
  roles.seed(powerUsers, ["flow:advanced_config", "workflow:publish_to_everyone"]);
  const userRoles = new FakeUserRoleRepository(roles);
  return { roles, userRoles };
};

describe("ListRoles", () => {
  it("lists each role with its granted permissions and shows Admins as all-on", async () => {
    const { roles } = seededRepos();
    const result = await new ListRoles(roles).execute();

    const byKey = new Map(result.data!.map((entry) => [entry.role.key, entry.permissions]));
    expect(byKey.get("everyone")!.sort()).toEqual(["chat:create", "workflow:create_own"].sort());
    expect(byKey.get("power_users")!.sort()).toEqual(
      ["flow:advanced_config", "workflow:publish_to_everyone"].sort(),
    );
    expect(byKey.get("admins")!.sort()).toEqual(
      ["chat:create", "flow:advanced_config", "workflow:create_own", "workflow:publish_to_everyone"].sort(),
    );
  });
});

describe("UpdateRolePermissions", () => {
  it("replaces the permissions of an editable role", async () => {
    const { roles } = seededRepos();
    const result = await new UpdateRolePermissions(roles).execute("everyone", ["chat:create"]);
    expect(result.error).toBeUndefined();
    const grants = await roles.listPermissions("everyone");
    expect(grants.data).toEqual(["chat:create"]);
  });

  it("rejects editing the immutable Admins role with FORBIDDEN", async () => {
    const { roles } = seededRepos();
    const result = await new UpdateRolePermissions(roles).execute("admins", []);
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for an unknown role", async () => {
    const { roles } = seededRepos();
    const result = await new UpdateRolePermissions(roles).execute("missing", []);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("AssignUserRole / RemoveUserRole", () => {
  it("assigns a user to Power Users and removes them", async () => {
    const { roles, userRoles } = seededRepos();
    const assign = await new AssignUserRole(roles, userRoles).execute("user-1", "power");
    expect(assign.error).toBeUndefined();
    expect((await userRoles.listUsersForRole("power")).data).toEqual(["user-1"]);

    const remove = await new RemoveUserRole(roles, userRoles).execute("user-1", "power");
    expect(remove.error).toBeUndefined();
    expect((await userRoles.listUsersForRole("power")).data).toEqual([]);
  });

  it("rejects assigning the default Everyone role", async () => {
    const { roles, userRoles } = seededRepos();
    const result = await new AssignUserRole(roles, userRoles).execute("user-1", "everyone");
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("rejects assigning the immutable Admins role", async () => {
    const { roles, userRoles } = seededRepos();
    const result = await new AssignUserRole(roles, userRoles).execute("user-1", "admins");
    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("GetEffectivePermissions", () => {
  it("returns the full registry for admins regardless of assignments", async () => {
    const { roles, userRoles } = seededRepos();
    const result = await new GetEffectivePermissions(roles, userRoles).execute("admin-1", true);
    expect(result.data!.has("workflow:publish_to_everyone")).toBe(true);
    expect(result.data!.has("flow:advanced_config")).toBe(true);
  });

  it("composes the default Everyone grants with explicit role assignments", async () => {
    const { roles, userRoles } = seededRepos();
    await userRoles.assign("user-1", "power");
    const result = await new GetEffectivePermissions(roles, userRoles).execute("user-1", false);
    expect([...result.data!].sort()).toEqual(
      ["chat:create", "flow:advanced_config", "workflow:create_own", "workflow:publish_to_everyone"].sort(),
    );
  });

  it("returns only the Everyone grants for an ordinary user with no assignments", async () => {
    const { roles, userRoles } = seededRepos();
    const result = await new GetEffectivePermissions(roles, userRoles).execute("user-2", false);
    expect([...result.data!].sort()).toEqual(["chat:create", "workflow:create_own"].sort());
  });
});

describe("ListUsersForRole", () => {
  it("lists the members of a non-default role", async () => {
    const { roles, userRoles } = seededRepos();
    await userRoles.assign("user-1", "power");
    const result = await new ListUsersForRole(roles, userRoles).execute("power");
    expect(result.data).toEqual(["user-1"]);
  });

  it("rejects listing members of the default Everyone role", async () => {
    const { roles, userRoles } = seededRepos();
    const result = await new ListUsersForRole(roles, userRoles).execute("everyone");
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
