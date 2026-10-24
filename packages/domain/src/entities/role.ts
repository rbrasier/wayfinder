export interface Role {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isImmutable: boolean;
  readonly isDefault: boolean;
}

export interface NewRole {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly isSystem?: boolean;
  readonly isImmutable?: boolean;
  readonly isDefault?: boolean;
}

export const SYSTEM_ROLE_KEYS = {
  everyone: "everyone",
  admins: "admins",
  powerUsers: "power_users",
  technicalAdmins: "technical_admins",
  userAdmins: "user_admins",
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS];

const ADMIN_ROLE_KEYS: ReadonlySet<string> = new Set([
  SYSTEM_ROLE_KEYS.admins,
  SYSTEM_ROLE_KEYS.technicalAdmins,
  SYSTEM_ROLE_KEYS.userAdmins,
]);

// Roles only a Global Admin may hand out (ADR-066 §3): granting one is a step up
// in admin access, so a User Admin assigning it would be self-escalation.
export const isAdminRoleKey = (key: string): boolean => ADMIN_ROLE_KEYS.has(key);
