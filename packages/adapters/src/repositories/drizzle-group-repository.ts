import {
  domainError,
  err,
  ok,
  type Group,
  type GroupMembership,
  type GroupRole,
  type GroupUpdate,
  type IGroupRepository,
  type NewGroup,
  type NewGroupMembership,
  type Result,
} from "@rbrasier/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { admin_group_members, admin_groups } from "../db/schema/admin";

const toGroup = (row: typeof admin_groups.$inferSelect): Group => ({
  id: row.id,
  name: row.name,
  description: row.description,
  organisationId: row.organisation_id ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMembership = (row: typeof admin_group_members.$inferSelect): GroupMembership => ({
  id: row.id,
  groupId: row.group_id,
  userId: row.user_id,
  roleInGroup: row.role_in_group as GroupRole,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleGroupRepository implements IGroupRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Result<Group[]>> {
    try {
      const rows = await this.db.select().from(admin_groups).orderBy(admin_groups.name);
      return ok(rows.map(toGroup));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list groups.", cause));
    }
  }

  async findById(id: string): Promise<Result<Group | null>> {
    try {
      const [row] = await this.db.select().from(admin_groups).where(eq(admin_groups.id, id)).limit(1);
      return ok(row ? toGroup(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find group.", cause));
    }
  }

  async create(group: NewGroup): Promise<Result<Group>> {
    try {
      const [row] = await this.db
        .insert(admin_groups)
        .values({
          name: group.name,
          description: group.description ?? null,
          organisation_id: group.organisationId ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Group insert returned no row."));
      return ok(toGroup(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create group.", cause));
    }
  }

  async update(id: string, patch: GroupUpdate): Promise<Result<Group>> {
    try {
      const values: {
        name?: string;
        description?: string | null;
        organisation_id?: string | null;
        updated_at: Date;
      } = {
        updated_at: new Date(),
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.organisationId !== undefined) values.organisation_id = patch.organisationId;
      const [row] = await this.db
        .update(admin_groups)
        .set(values)
        .where(eq(admin_groups.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Group not found."));
      return ok(toGroup(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update group.", cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(admin_groups).where(eq(admin_groups.id, id));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete group.", cause));
    }
  }

  async listMembers(groupId: string): Promise<Result<GroupMembership[]>> {
    try {
      const rows = await this.db
        .select()
        .from(admin_group_members)
        .where(eq(admin_group_members.group_id, groupId));
      return ok(rows.map(toMembership));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list group members.", cause));
    }
  }

  async listMembershipsForUser(userId: string): Promise<Result<GroupMembership[]>> {
    try {
      const rows = await this.db
        .select()
        .from(admin_group_members)
        .where(eq(admin_group_members.user_id, userId));
      return ok(rows.map(toMembership));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list memberships for user.", cause));
    }
  }

  async addMember(membership: NewGroupMembership): Promise<Result<GroupMembership>> {
    try {
      const [row] = await this.db
        .insert(admin_group_members)
        .values({
          group_id: membership.groupId,
          user_id: membership.userId,
          role_in_group: membership.roleInGroup,
        })
        .onConflictDoUpdate({
          target: [admin_group_members.group_id, admin_group_members.user_id],
          set: { role_in_group: membership.roleInGroup, updated_at: new Date() },
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Member insert returned no row."));
      return ok(toMembership(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to add group member.", cause));
    }
  }

  async setMemberRole(
    groupId: string,
    userId: string,
    roleInGroup: GroupRole,
  ): Promise<Result<GroupMembership>> {
    try {
      const [row] = await this.db
        .update(admin_group_members)
        .set({ role_in_group: roleInGroup, updated_at: new Date() })
        .where(
          and(eq(admin_group_members.group_id, groupId), eq(admin_group_members.user_id, userId)),
        )
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Group membership not found."));
      return ok(toMembership(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to set member role.", cause));
    }
  }

  async removeMember(groupId: string, userId: string): Promise<Result<void>> {
    try {
      await this.db
        .delete(admin_group_members)
        .where(
          and(eq(admin_group_members.group_id, groupId), eq(admin_group_members.user_id, userId)),
        );
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to remove group member.", cause));
    }
  }
}
