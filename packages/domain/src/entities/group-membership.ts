// A member sees the group's flows; a delegated admin additionally manages the
// group's membership and publishes flows to it (ADR-036). Delegation is scoped
// to the group — it is never a global tier.
export type GroupRole = "member" | "delegated_admin";

export const GROUP_ROLES = {
  member: "member",
  delegatedAdmin: "delegated_admin",
} as const;

export interface GroupMembership {
  readonly id: string;
  readonly groupId: string;
  readonly userId: string;
  readonly roleInGroup: GroupRole;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGroupMembership {
  readonly groupId: string;
  readonly userId: string;
  readonly roleInGroup: GroupRole;
}
