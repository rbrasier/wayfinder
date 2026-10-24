import { ADMIN_AREA_PERMISSIONS, type PermissionKey } from "@wayfinder/domain";

// The delegable parts of the admin section (ADR-066 §1). "global" names what
// only a Global Admin may open; no permission key unlocks it.
export type AdminArea = "technical" | "users" | "oversight";

export interface AdminViewer {
  readonly isAdmin: boolean;
  readonly permissions: ReadonlySet<PermissionKey>;
}

export const ADMIN_AREA_PERMISSION: Readonly<Record<AdminArea, PermissionKey>> = {
  technical: "admin:technical",
  users: "admin:users",
  oversight: "admin:oversight",
};

// Where each area lands. Oversight comes first so a Global Admin keeps landing
// on All Flows, as before the split.
const AREA_HOMES: readonly { readonly area: AdminArea; readonly href: string }[] = [
  { area: "oversight", href: "/admin/flows" },
  { area: "technical", href: "/admin/settings" },
  { area: "users", href: "/admin/users" },
];

// Raw `settings.get` / `settings.set` reach any system-settings row, including
// auth config, so a Technical Admin is held to the keys the technical cards use.
const TECHNICAL_SETTING_KEYS: ReadonlySet<string> = new Set(["global_prompt"]);

export const canOpenAdminArea = (viewer: AdminViewer, area: AdminArea | "global"): boolean => {
  if (viewer.isAdmin) return true;
  if (area === "global") return false;
  return viewer.permissions.has(ADMIN_AREA_PERMISSION[area]);
};

export const hasAnyAdminArea = (viewer: AdminViewer): boolean =>
  viewer.isAdmin || ADMIN_AREA_PERMISSIONS.some((key) => viewer.permissions.has(key));

export const firstAdminHref = (viewer: AdminViewer): string | null =>
  AREA_HOMES.find(({ area }) => canOpenAdminArea(viewer, area))?.href ?? null;

export const canAccessSettingKey = (viewer: AdminViewer, key: string): boolean => {
  if (viewer.isAdmin) return true;
  return canOpenAdminArea(viewer, "technical") && TECHNICAL_SETTING_KEYS.has(key);
};
