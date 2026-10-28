import { describe, expect, it } from "vitest";
import {
  type IAuditLogger,
  type IPasswordResetter,
  type IRoleRepository,
  type IUserRepository,
  type IUserRoleRepository,
  type NewAuditLog,
  type NewRole,
  type NewUser,
  type PermissionKey,
  type PasswordResetOutcome,
  type Result,
  type Role,
  type User,
  type UserUpdate,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";
import { CreateUser } from "./create-user";
import { DeleteUser } from "./delete-user";
import { ResetUserPassword } from "./reset-user-password";
import { UpdateUser } from "./update-user";

// ADR-066 §3: a User Admin manages ordinary accounts, but nothing that would let
// them take over, or hand out, admin access. A Global Admin is unrestricted.

const globalAdminCaller = { isAdmin: true, userId: "global-admin" };
const userAdminCaller = { isAdmin: false, userId: "user-admin" };

const role = (key: string): Role => ({
  id: `role-${key}`,
  key,
  name: key,
  description: null,
  isSystem: true,
  isImmutable: false,
  isDefault: false,
});

// Only listPermissions matters to the guard: it decides whether a role the
// target holds grants admin access, built-in or not.
class InMemoryRoles implements IRoleRepository {
  readonly permissionsByRoleId = new Map<string, PermissionKey[]>();

  grantPermissions(roleKey: string, permissions: PermissionKey[]): void {
    this.permissionsByRoleId.set(role(roleKey).id, permissions);
  }

  async list(): Promise<Result<Role[]>> {
    return ok([]);
  }
  async findByKey(): Promise<Result<Role | null>> {
    return ok(null);
  }
  async findById(): Promise<Result<Role | null>> {
    return ok(null);
  }
  async create(input: NewRole): Promise<Result<Role>> {
    return ok(role(input.key));
  }
  async update(id: string): Promise<Result<Role>> {
    return ok(role(id));
  }
  async delete(): Promise<Result<void>> {
    return ok(undefined);
  }
  async listPermissions(roleId: string): Promise<Result<PermissionKey[]>> {
    return ok(this.permissionsByRoleId.get(roleId) ?? []);
  }
  async replacePermissions(): Promise<Result<void>> {
    return ok(undefined);
  }
}

class InMemoryUsers implements IUserRepository {
  readonly byId = new Map<string, User>();

  seed(id: string, isAdmin = false): User {
    const now = new Date();
    const user: User = {
      id,
      email: `${id}@example.com`,
      name: id,
      role: null,
      team: null,
      isAdmin,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, user);
    return user;
  }

  async create(input: NewUser): Promise<Result<User>> {
    const created = this.seed(input.email, input.isAdmin ?? false);
    return ok(created);
  }
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.byId.get(id) ?? null);
  }
  async findByEmail(email: string): Promise<Result<User | null>> {
    return ok([...this.byId.values()].find((user) => user.email === email) ?? null);
  }
  async search(): Promise<Result<User[]>> {
    return ok([]);
  }
  async list(): Promise<Result<User[]>> {
    return ok([...this.byId.values()]);
  }
  async update(id: string, patch: UserUpdate): Promise<Result<User>> {
    const user = this.byId.get(id);
    if (!user) return err(domainError("NOT_FOUND", "missing"));
    const next: User = { ...user, ...patch };
    this.byId.set(id, next);
    return ok(next);
  }
  async delete(id: string): Promise<Result<true>> {
    this.byId.delete(id);
    return ok(true as const);
  }
}

class InMemoryUserRoles implements IUserRoleRepository {
  readonly rolesByUser = new Map<string, Role[]>();

  grant(userId: string, roleKey: string): void {
    this.rolesByUser.set(userId, [...(this.rolesByUser.get(userId) ?? []), role(roleKey)]);
  }

  async listRolesForUser(userId: string): Promise<Result<Role[]>> {
    return ok(this.rolesByUser.get(userId) ?? []);
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

class CountingResetter implements IPasswordResetter {
  calls = 0;
  async resetPassword(): Promise<Result<PasswordResetOutcome>> {
    this.calls += 1;
    return ok({ userId: "reset-target", sessionsRevoked: 0 });
  }
}

class SilentAuditLogger implements IAuditLogger {
  async log(_payload: NewAuditLog): Promise<Result<true>> {
    return ok(true);
  }
}

const setup = () => {
  const users = new InMemoryUsers();
  const userRoles = new InMemoryUserRoles();
  const roles = new InMemoryRoles();
  users.seed("ordinary");
  users.seed("global-admin", true);
  users.seed("technical-admin");
  userRoles.grant("technical-admin", "technical_admins");
  users.seed("power-user");
  userRoles.grant("power-user", "power_users");
  // A Global-Admin-made custom role carrying an admin area key is as much an
  // admin role as the built-in ones.
  users.seed("oversight-holder");
  userRoles.grant("oversight-holder", "oversight");
  roles.grantPermissions("oversight", ["admin:oversight"]);
  return { users, userRoles, roles };
};

describe("CreateUser — delegated caller", () => {
  it("lets a User Admin create an ordinary user", async () => {
    const { users } = setup();

    const result = await new CreateUser(users).execute({ email: "new@example.com" }, userAdminCaller);

    expect(result.error).toBeUndefined();
  });

  it("refuses a User Admin creating a Global Admin", async () => {
    const { users } = setup();

    const result = await new CreateUser(users).execute(
      { email: "new@example.com", isAdmin: true },
      userAdminCaller,
    );

    expect(result.error?.code).toBe("FORBIDDEN");
    expect((await users.findByEmail("new@example.com")).data).toBeNull();
  });

  it("lets a Global Admin create a Global Admin", async () => {
    const { users } = setup();

    const result = await new CreateUser(users).execute(
      { email: "new@example.com", isAdmin: true },
      globalAdminCaller,
    );

    expect(result.data?.isAdmin).toBe(true);
  });
});

describe("UpdateUser — delegated caller", () => {
  it("lets a User Admin edit an ordinary user and a Power User", async () => {
    const { users, userRoles, roles } = setup();
    const updateUser = new UpdateUser(users, userRoles, roles);

    const ordinary = await updateUser.execute("ordinary", { name: "Renamed" }, userAdminCaller);
    const powerUser = await updateUser.execute("power-user", { name: "Renamed" }, userAdminCaller);

    expect(ordinary.data?.name).toBe("Renamed");
    expect(powerUser.data?.name).toBe("Renamed");
  });

  it("accepts an unchanged isAdmin: false from the edit form", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "ordinary",
      { name: "Renamed", isAdmin: false },
      userAdminCaller,
    );

    expect(result.error).toBeUndefined();
  });

  it("refuses a User Admin promoting someone to Global Admin", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "ordinary",
      { isAdmin: true },
      userAdminCaller,
    );

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(users.byId.get("ordinary")?.isAdmin).toBe(false);
  });

  it("refuses a User Admin editing a Global Admin or an admin-role holder", async () => {
    const { users, userRoles, roles } = setup();
    const updateUser = new UpdateUser(users, userRoles, roles);

    const globalAdmin = await updateUser.execute("global-admin", { email: "x@example.com" }, userAdminCaller);
    const technicalAdmin = await updateUser.execute("technical-admin", { name: "x" }, userAdminCaller);

    expect(globalAdmin.error?.code).toBe("FORBIDDEN");
    expect(technicalAdmin.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a User Admin editing the holder of a custom role that grants admin access", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "oversight-holder",
      { email: "x@example.com" },
      userAdminCaller,
    );

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("lets a Technical Admin edit their own profile", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "technical-admin",
      { name: "Renamed" },
      { isAdmin: false, userId: "technical-admin" },
    );

    expect(result.data?.name).toBe("Renamed");
  });

  it("still refuses someone making themselves a Global Admin", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "technical-admin",
      { isAdmin: true },
      { isAdmin: false, userId: "technical-admin" },
    );

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("lets a Global Admin edit another Global Admin", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new UpdateUser(users, userRoles, roles).execute(
      "global-admin",
      { name: "Renamed" },
      globalAdminCaller,
    );

    expect(result.data?.name).toBe("Renamed");
  });
});

describe("DeleteUser — delegated caller", () => {
  it("lets a User Admin delete an ordinary user", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new DeleteUser(users, userRoles, roles).execute("ordinary", userAdminCaller);

    expect(result.data).toBe(true);
  });

  it("refuses a User Admin deleting a Global Admin or an admin-role holder", async () => {
    const { users, userRoles, roles } = setup();
    const deleteUser = new DeleteUser(users, userRoles, roles);

    const globalAdmin = await deleteUser.execute("global-admin", userAdminCaller);
    const technicalAdmin = await deleteUser.execute("technical-admin", userAdminCaller);

    expect(globalAdmin.error?.code).toBe("FORBIDDEN");
    expect(technicalAdmin.error?.code).toBe("FORBIDDEN");
    expect(users.byId.has("global-admin")).toBe(true);
  });
});

describe("DeleteUser — custom admin role holder", () => {
  it("refuses a User Admin deleting the holder of a custom role that grants admin access", async () => {
    const { users, userRoles, roles } = setup();

    const result = await new DeleteUser(users, userRoles, roles).execute("oversight-holder", userAdminCaller);

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(users.byId.has("oversight-holder")).toBe(true);
  });
});

describe("ResetUserPassword — delegated caller", () => {
  const command = (userId: string, caller: { isAdmin: boolean; userId: string }) => ({
    actorId: "actor",
    userId,
    password: "a-long-enough-password",
    caller,
  });

  it("lets a User Admin reset an ordinary user's password", async () => {
    const { users, userRoles, roles } = setup();
    const resetter = new CountingResetter();

    const result = await new ResetUserPassword(users, userRoles, roles, resetter, new SilentAuditLogger()).execute(
      command("ordinary", userAdminCaller),
    );

    expect(result.error).toBeUndefined();
    expect(resetter.calls).toBe(1);
  });

  it("refuses a User Admin resetting a Global Admin's password, so the account cannot be taken over", async () => {
    const { users, userRoles, roles } = setup();
    const resetter = new CountingResetter();

    const result = await new ResetUserPassword(users, userRoles, roles, resetter, new SilentAuditLogger()).execute(
      command("global-admin", userAdminCaller),
    );

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(resetter.calls).toBe(0);
  });

  it("refuses a User Admin resetting an admin-role holder's password", async () => {
    const { users, userRoles, roles } = setup();
    const resetter = new CountingResetter();

    const result = await new ResetUserPassword(users, userRoles, roles, resetter, new SilentAuditLogger()).execute(
      command("technical-admin", userAdminCaller),
    );

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(resetter.calls).toBe(0);
  });

  it("refuses a User Admin resetting the password of a custom admin role holder", async () => {
    const { users, userRoles, roles } = setup();
    const resetter = new CountingResetter();

    const result = await new ResetUserPassword(users, userRoles, roles, resetter, new SilentAuditLogger()).execute(
      command("oversight-holder", userAdminCaller),
    );

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(resetter.calls).toBe(0);
  });

  it("lets a Global Admin reset another Global Admin's password", async () => {
    const { users, userRoles, roles } = setup();
    const resetter = new CountingResetter();

    const result = await new ResetUserPassword(users, userRoles, roles, resetter, new SilentAuditLogger()).execute(
      command("global-admin", globalAdminCaller),
    );

    expect(result.error).toBeUndefined();
    expect(resetter.calls).toBe(1);
  });
});
