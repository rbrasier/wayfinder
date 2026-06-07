import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  computeEffectivePermissions,
  type PermissionKey,
} from "./permission";
import type { Role } from "./role";

const everyone: Role = {
  id: "role-everyone",
  key: "everyone",
  name: "Everyone",
  description: null,
  isSystem: true,
  isImmutable: false,
  isDefault: true,
};

const powerUsers: Role = {
  id: "role-power",
  key: "power_users",
  name: "Power Users",
  description: null,
  isSystem: true,
  isImmutable: false,
  isDefault: false,
};

describe("computeEffectivePermissions", () => {
  it("unions grants across the Everyone role and one assigned role", () => {
    const grantsByRole = new Map<string, PermissionKey[]>([
      ["role-everyone", ["chat:create", "workflow:create_own"]],
      ["role-power", ["flow:advanced_config", "workflow:publish_to_everyone"]],
    ]);

    const permissions = computeEffectivePermissions([everyone, powerUsers], grantsByRole, false);

    expect([...permissions].sort()).toEqual(
      [
        "chat:create",
        "flow:advanced_config",
        "workflow:create_own",
        "workflow:publish_to_everyone",
      ].sort(),
    );
  });

  it("collapses duplicate grants across roles", () => {
    const grantsByRole = new Map<string, PermissionKey[]>([
      ["role-everyone", ["chat:create"]],
      ["role-power", ["chat:create"]],
    ]);

    const permissions = computeEffectivePermissions([everyone, powerUsers], grantsByRole, false);

    expect([...permissions]).toEqual(["chat:create"]);
  });

  it("grants every registered permission to admins regardless of stored grants", () => {
    const permissions = computeEffectivePermissions([], new Map(), true);

    expect(permissions.size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(permissions.has(permission.key)).toBe(true);
    }
  });

  it("returns an empty set when the user has no roles and is not an admin", () => {
    const permissions = computeEffectivePermissions([], new Map(), false);

    expect(permissions.size).toBe(0);
  });

  it("ignores grants for roles that are not in the assigned list", () => {
    const grantsByRole = new Map<string, PermissionKey[]>([
      ["role-everyone", ["chat:create"]],
      ["role-power", ["workflow:publish_to_everyone"]],
    ]);

    const permissions = computeEffectivePermissions([everyone], grantsByRole, false);

    expect([...permissions]).toEqual(["chat:create"]);
  });
});

describe("PERMISSIONS registry", () => {
  it("includes the four initial permission keys with labels and descriptions", () => {
    const keys = PERMISSIONS.map((permission) => permission.key);

    expect(keys).toContain("chat:create");
    expect(keys).toContain("workflow:create_own");
    expect(keys).toContain("workflow:publish_to_everyone");
    expect(keys).toContain("flow:advanced_config");

    for (const permission of PERMISSIONS) {
      expect(permission.label.length).toBeGreaterThan(0);
      expect(permission.description.length).toBeGreaterThan(0);
    }
  });
});
