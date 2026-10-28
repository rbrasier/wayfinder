import type { Role } from "./role";

export type PermissionKey =
  | "chat:create"
  | "workflow:create_own"
  | "workflow:publish_to_everyone"
  | "flow:advanced_config"
  | "knowledge:submit_feedback"
  | "knowledge:curate"
  | "group:manage_own"
  | "extraction:author"
  | "extraction:run"
  | "flow:webhook_trigger"
  | "admin:technical"
  | "admin:users"
  | "admin:oversight";

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
  {
    key: "extraction:author",
    label: "Author extraction flows",
    description:
      "Create, edit, and publish extraction flows (Synthesise Information) and configure their schema, input, and output.",
  },
  {
    key: "extraction:run",
    label: "Run extraction flows",
    description:
      "Upload documents to an extraction flow, run and preview extraction, and review results.",
  },
  {
    key: "flow:webhook_trigger",
    label: "Start flows via webhook",
    description:
      "Turn on a secure web address that lets other systems start a flow the user owns (ADR-064 §3).",
  },
  {
    key: "admin:technical",
    label: "Technical administration",
    description:
      "Use the technical admin screens: Configuration (AI, integrations, storage, notifications, branding), Flags, Errors, Schedules, Skills, MCP Servers and Event Watch.",
  },
  {
    key: "admin:users",
    label: "User administration",
    description:
      "Manage users, groups and organisations, and assign non-admin roles. Cannot grant admin roles or change admin accounts.",
  },
  {
    key: "admin:oversight",
    label: "Admin oversight",
    description:
      "See the dashboards, usage and audit log, and open and edit every user's chats and flows from All Chats and All Flows.",
  },
];

// The keys that open part of the admin section (ADR-066). Holding any one of
// them lets a non-admin into /admin; each still gates only its own area.
export const ADMIN_AREA_PERMISSIONS: readonly PermissionKey[] = [
  "admin:technical",
  "admin:users",
  "admin:oversight",
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
