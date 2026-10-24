import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_KEYS, isAdminRoleKey } from "./role";

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
