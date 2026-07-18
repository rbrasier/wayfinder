import { describe, expect, it } from "vitest";
import {
  canManageGroup,
  groupIdsForMemberships,
  isDelegatedAdminOf,
  membershipViews,
  type GroupAuthorizationContext,
} from "./group-authorization";

const context = (
  memberships: GroupAuthorizationContext["memberships"],
  isGlobalAdmin = false,
): GroupAuthorizationContext => ({ memberships, isGlobalAdmin });

describe("isDelegatedAdminOf", () => {
  it("returns true when the viewer delegate-admins the group", () => {
    const ctx = context([{ groupId: "hr", roleInGroup: "delegated_admin" }]);
    expect(isDelegatedAdminOf(ctx, "hr")).toBe(true);
  });

  it("returns false when the viewer is only a plain member of the group", () => {
    const ctx = context([{ groupId: "hr", roleInGroup: "member" }]);
    expect(isDelegatedAdminOf(ctx, "hr")).toBe(false);
  });

  it("returns false when the viewer delegate-admins a different group", () => {
    const ctx = context([{ groupId: "finance", roleInGroup: "delegated_admin" }]);
    expect(isDelegatedAdminOf(ctx, "hr")).toBe(false);
  });

  it("ignores the global-admin flag — it is a pure delegated-admin check", () => {
    const ctx = context([], true);
    expect(isDelegatedAdminOf(ctx, "hr")).toBe(false);
  });
});

describe("canManageGroup", () => {
  it("lets a global admin manage any group without membership", () => {
    const ctx = context([], true);
    expect(canManageGroup(ctx, "hr")).toBe(true);
  });

  it("lets a delegated admin manage their own group", () => {
    const ctx = context([{ groupId: "hr", roleInGroup: "delegated_admin" }]);
    expect(canManageGroup(ctx, "hr")).toBe(true);
  });

  it("rejects a delegated admin of HR touching Finance", () => {
    const ctx = context([{ groupId: "hr", roleInGroup: "delegated_admin" }]);
    expect(canManageGroup(ctx, "finance")).toBe(false);
  });

  it("rejects a plain member managing their own group", () => {
    const ctx = context([{ groupId: "hr", roleInGroup: "member" }]);
    expect(canManageGroup(ctx, "hr")).toBe(false);
  });

  it("rejects a user with no memberships and no admin", () => {
    expect(canManageGroup(context([]), "hr")).toBe(false);
  });
});

describe("groupIdsForMemberships", () => {
  it("returns every group id the viewer belongs to regardless of role", () => {
    const ctx = membershipViews([
      { groupId: "hr", roleInGroup: "member" },
      { groupId: "finance", roleInGroup: "delegated_admin" },
    ]);
    expect(groupIdsForMemberships(ctx)).toEqual(["hr", "finance"]);
  });

  it("returns an empty list for a viewer with no memberships", () => {
    expect(groupIdsForMemberships([])).toEqual([]);
  });
});
