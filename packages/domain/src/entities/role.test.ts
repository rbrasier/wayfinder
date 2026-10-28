import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_KEYS, grantsAdminAccess, isAdminRoleKey } from "./role";

describe("isAdminRoleKey (ADR-066 §3)", () => {
  it("treats Global, Technical and User Admin as admin roles", () => {
    expect(isAdminRoleKey(SYSTEM_ROLE_KEYS.admins)).toBe(true);
    expect(isAdminRoleKey(SYSTEM_ROLE_KEYS.technicalAdmins)).toBe(true);
    expect(isAdminRoleKey(SYSTEM_ROLE_KEYS.userAdmins)).toBe(true);
  });

  it("does not treat Everyone, Power Users or a custom role as admin roles", () => {
    expect(isAdminRoleKey(SYSTEM_ROLE_KEYS.everyone)).toBe(false);
    expect(isAdminRoleKey(SYSTEM_ROLE_KEYS.powerUsers)).toBe(false);
    expect(isAdminRoleKey("reviewers")).toBe(false);
  });

  it("uses stable keys for the two delegated admin roles", () => {
    expect(SYSTEM_ROLE_KEYS.technicalAdmins).toBe("technical_admins");
    expect(SYSTEM_ROLE_KEYS.userAdmins).toBe("user_admins");
  });
});

describe("grantsAdminAccess (ADR-066 §3)", () => {
  it("treats a built-in admin role as granting admin access whatever it stores", () => {
    expect(grantsAdminAccess(SYSTEM_ROLE_KEYS.admins, [])).toBe(true);
    expect(grantsAdminAccess(SYSTEM_ROLE_KEYS.userAdmins, [])).toBe(true);
  });

  it("treats a custom role holding any admin area key as granting admin access", () => {
    expect(grantsAdminAccess("oversight", ["admin:oversight"])).toBe(true);
    expect(grantsAdminAccess("ops", ["chat:create", "admin:technical"])).toBe(true);
    expect(grantsAdminAccess("helpdesk", ["admin:users"])).toBe(true);
  });

  it("does not treat a custom role without an admin area key as granting admin access", () => {
    expect(grantsAdminAccess("reviewers", ["knowledge:curate", "flow:advanced_config"])).toBe(false);
    expect(grantsAdminAccess(SYSTEM_ROLE_KEYS.powerUsers, [])).toBe(false);
  });
});
