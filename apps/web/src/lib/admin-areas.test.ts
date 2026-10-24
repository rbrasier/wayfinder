import type { PermissionKey } from "@wayfinder/domain";
import { describe, expect, it } from "vitest";
import {
  canAccessSettingKey,
  canOpenAdminArea,
  firstAdminHref,
  hasAnyAdminArea,
  type AdminViewer,
} from "./admin-areas";

const viewer = (permissions: PermissionKey[], isAdmin = false): AdminViewer => ({
  isAdmin,
  permissions: new Set(permissions),
});

const globalAdmin = viewer([], true);
const technicalAdmin = viewer(["admin:technical", "knowledge:curate"]);
const userAdmin = viewer(["admin:users"]);
const oversight = viewer(["admin:oversight"]);
const ordinaryUser = viewer(["chat:create", "workflow:create_own"]);

describe("canOpenAdminArea", () => {
  it("opens every area, including the Global-only one, for a Global Admin", () => {
    expect(canOpenAdminArea(globalAdmin, "technical")).toBe(true);
    expect(canOpenAdminArea(globalAdmin, "users")).toBe(true);
    expect(canOpenAdminArea(globalAdmin, "oversight")).toBe(true);
    expect(canOpenAdminArea(globalAdmin, "global")).toBe(true);
  });

  it("opens only the technical area for a Technical Admin", () => {
    expect(canOpenAdminArea(technicalAdmin, "technical")).toBe(true);
    expect(canOpenAdminArea(technicalAdmin, "users")).toBe(false);
    expect(canOpenAdminArea(technicalAdmin, "oversight")).toBe(false);
    expect(canOpenAdminArea(technicalAdmin, "global")).toBe(false);
  });

  it("opens only the users area for a User Admin", () => {
    expect(canOpenAdminArea(userAdmin, "users")).toBe(true);
    expect(canOpenAdminArea(userAdmin, "technical")).toBe(false);
    expect(canOpenAdminArea(userAdmin, "global")).toBe(false);
  });

  it("never opens the Global-only area to a delegated admin holding every area key", () => {
    const everyArea = viewer(["admin:technical", "admin:users", "admin:oversight"]);

    expect(canOpenAdminArea(everyArea, "global")).toBe(false);
  });
});

describe("hasAnyAdminArea", () => {
  it("is true for a Global Admin and for any holder of an admin area key", () => {
    expect(hasAnyAdminArea(globalAdmin)).toBe(true);
    expect(hasAnyAdminArea(technicalAdmin)).toBe(true);
    expect(hasAnyAdminArea(userAdmin)).toBe(true);
    expect(hasAnyAdminArea(oversight)).toBe(true);
  });

  it("is false for a user with no admin area key", () => {
    expect(hasAnyAdminArea(ordinaryUser)).toBe(false);
  });
});

describe("firstAdminHref", () => {
  it("sends a Global Admin and an oversight holder to All Flows, as today", () => {
    expect(firstAdminHref(globalAdmin)).toBe("/admin/flows");
    expect(firstAdminHref(oversight)).toBe("/admin/flows");
  });

  it("sends a Technical Admin to Configuration and a User Admin to Users", () => {
    expect(firstAdminHref(technicalAdmin)).toBe("/admin/settings");
    expect(firstAdminHref(userAdmin)).toBe("/admin/users");
  });

  it("returns null for a user with no admin area", () => {
    expect(firstAdminHref(ordinaryUser)).toBeNull();
  });
});

describe("canAccessSettingKey", () => {
  it("lets a Global Admin read and write any raw setting", () => {
    expect(canAccessSettingKey(globalAdmin, "organisation_name")).toBe(true);
    expect(canAccessSettingKey(globalAdmin, "auth_config")).toBe(true);
  });

  it("lets a Technical Admin reach only the allowlisted global instructions key", () => {
    expect(canAccessSettingKey(technicalAdmin, "global_prompt")).toBe(true);
    expect(canAccessSettingKey(technicalAdmin, "organisation_name")).toBe(false);
    expect(canAccessSettingKey(technicalAdmin, "auth_config")).toBe(false);
  });

  it("gives a User Admin no raw settings", () => {
    expect(canAccessSettingKey(userAdmin, "global_prompt")).toBe(false);
  });
});
