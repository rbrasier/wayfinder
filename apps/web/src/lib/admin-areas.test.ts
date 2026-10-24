import type { PermissionKey } from "@wayfinder/domain";
import { describe, expect, it } from "vitest";
import {
  adminAreaForPath,
  canAccessSettingKey,
  canOpenAdminPath,
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

describe("adminAreaForPath", () => {
  it("maps each admin screen to the area that owns it", () => {
    expect(adminAreaForPath("/admin/settings")).toBe("technical");
    expect(adminAreaForPath("/admin/flags")).toBe("technical");
    expect(adminAreaForPath("/admin/errors")).toBe("technical");
    expect(adminAreaForPath("/admin/schedules")).toBe("technical");
    expect(adminAreaForPath("/admin/skills")).toBe("technical");
    expect(adminAreaForPath("/admin/mcp-servers")).toBe("technical");
    expect(adminAreaForPath("/admin/event-watches/new")).toBe("technical");
    expect(adminAreaForPath("/admin/users")).toBe("users");
    expect(adminAreaForPath("/admin/groups")).toBe("users");
    expect(adminAreaForPath("/admin/organisations")).toBe("users");
    expect(adminAreaForPath("/admin/dashboards/overview")).toBe("oversight");
    expect(adminAreaForPath("/admin/sessions")).toBe("oversight");
    expect(adminAreaForPath("/admin/flows/abc")).toBe("oversight");
    expect(adminAreaForPath("/admin/synthesise")).toBe("oversight");
    expect(adminAreaForPath("/admin/usage")).toBe("oversight");
    expect(adminAreaForPath("/admin/audit")).toBe("oversight");
    expect(adminAreaForPath("/admin/roles")).toBe("global");
  });

  it("treats an unknown admin screen as Global-only, so a new page fails closed", () => {
    expect(adminAreaForPath("/admin/something-new")).toBe("global");
  });

  it("does not confuse a screen with another that shares its prefix", () => {
    expect(adminAreaForPath("/admin/usersettings")).toBe("global");
  });
});

describe("canOpenAdminPath", () => {
  it("lets a Technical Admin open Configuration but not Users or Roles", () => {
    expect(canOpenAdminPath(technicalAdmin, "/admin/settings")).toBe(true);
    expect(canOpenAdminPath(technicalAdmin, "/admin/users")).toBe(false);
    expect(canOpenAdminPath(technicalAdmin, "/admin/roles")).toBe(false);
  });
});
