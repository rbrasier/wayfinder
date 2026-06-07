import {
  SYSTEM_ROLE_KEYS,
  type IFeatureFlagRoleRepository,
  type IRoleRepository,
  type NewRole,
  type PermissionKey,
  type Role,
} from "@rbrasier/domain";

interface SystemRoleSeed {
  readonly definition: NewRole;
  readonly defaultPermissions: PermissionKey[];
}

const SYSTEM_ROLE_SEEDS: SystemRoleSeed[] = [
  {
    definition: {
      key: SYSTEM_ROLE_KEYS.everyone,
      name: "Everyone",
      description: "Applies to every authenticated user.",
      isSystem: true,
      isDefault: true,
    },
    defaultPermissions: ["chat:create", "workflow:create_own"],
  },
  {
    definition: {
      key: SYSTEM_ROLE_KEYS.admins,
      name: "Admins",
      description: "Full access; derived from is_admin and always holds every permission.",
      isSystem: true,
      isImmutable: true,
    },
    // Admins are a wildcard applied in code (ADR-021); no stored grants.
    defaultPermissions: [],
  },
  {
    definition: {
      key: SYSTEM_ROLE_KEYS.powerUsers,
      name: "Power Users",
      description: "Non-admins granted advanced capability.",
      isSystem: true,
    },
    defaultPermissions: ["flow:advanced_config", "workflow:publish_to_everyone"],
  },
];

// Flags scoped to Power Users on first migrate (ADR-022); admins still pass via wildcard.
const POWER_USER_SCOPED_FLAGS = ["auto_node", "scheduled_node"];

/**
 * Idempotent seed of the three system roles, their default permission grants, and
 * the Power-Users flag scoping. Insert-missing-only: default grants and flag
 * scoping are written only for roles created on this run, so a re-seed never
 * overwrites an admin's later edits.
 */
export const seedRoles = async (
  roles: IRoleRepository,
  featureFlagRoles: IFeatureFlagRoleRepository,
): Promise<void> => {
  let powerUsersCreated: Role | null = null;

  for (const seed of SYSTEM_ROLE_SEEDS) {
    const existing = await roles.findByKey(seed.definition.key);
    if (existing.error || existing.data) continue;

    const created = await roles.create(seed.definition);
    if (created.error) continue;

    if (seed.defaultPermissions.length > 0) {
      await roles.replacePermissions(created.data.id, seed.defaultPermissions);
    }
    if (seed.definition.key === SYSTEM_ROLE_KEYS.powerUsers) {
      powerUsersCreated = created.data;
    }
  }

  if (!powerUsersCreated) return;

  for (const flagKey of POWER_USER_SCOPED_FLAGS) {
    await featureFlagRoles.replaceRolesForFlag(flagKey, [powerUsersCreated.id]);
  }
};
