import type { Role } from "./role";

export type PermissionKey =
  | "chat:create"
  | "workflow:create_own"
  | "workflow:publish_to_everyone"
  | "flow:advanced_config"
  | "knowledge:submit_feedback"
  | "knowledge:curate"
  | "group:manage_own";

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly label: string;
  readonly description: string;
}

// Developer-owned registry (ADR-021): admins toggle which roles hold each key,
// they never invent new keys. A permission with no enforcing code is meaningless.
export const PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: "chat:create",
    label: "Create chats",
    description: "Start new chat sessions.",
  },
  {
    key: "workflow:create_own",
    label: "Create own workflows",
    description: "Create workflows owned by oneself.",
  },
  {
    key: "workflow:publish_to_everyone",
    label: "Publish workflows to everyone",
    description: "Publish a flow with global visibility.",
  },
  {
    key: "flow:advanced_config",
    label: "Advanced flow configuration",
    description: "Use advanced-mode flow and step configuration.",
  },
  {
    key: "knowledge:submit_feedback",
    label: "Submit answer corrections",
    description: "Flag a wrong answer and submit corrected text.",
  },
  {
    key: "knowledge:curate",
    label: "Curate the knowledge base",
    description: "Edit, archive, tag, revert, and search knowledge content.",
  },
  {
    key: "group:manage_own",
    label: "Manage own groups",
    description:
      "Manage members and group-visible flows for groups the user delegate-admins. Scope is enforced per group; the key alone grants nothing global.",
  },
];

const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map(
  (permission) => permission.key,
);

/**
 * Resolves a user's effective permissions (ADR-021). Admins always hold the full
 * registry (wildcard); otherwise the result is the union of grants across every
 * supplied role (the implicit Everyone role plus any explicit assignments).
 */
export const computeEffectivePermissions = (
  assignedRoles: readonly Role[],
  grantsByRole: ReadonlyMap<string, readonly PermissionKey[]>,
  isAdmin: boolean,
): Set<PermissionKey> => {
  if (isAdmin) return new Set(ALL_PERMISSION_KEYS);

  const effective = new Set<PermissionKey>();
  for (const role of assignedRoles) {
    const grants = grantsByRole.get(role.id) ?? [];
    for (const grant of grants) {
      effective.add(grant);
    }
  }
  return effective;
};
