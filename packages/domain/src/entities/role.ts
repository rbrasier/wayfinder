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
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS];
