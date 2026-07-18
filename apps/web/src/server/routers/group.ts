import {
  canManageGroup,
  groupIdsForMemberships,
  GROUP_ROLES,
  type GroupRole,
  type PermissionKey,
} from "@rbrasier/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Container } from "@/lib/container";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const GROUP_MANAGE_PERMISSION: PermissionKey = "group:manage_own";

interface GroupCaller {
  container: Container;
  userId: string;
  isAdmin: boolean;
  permissions: Set<PermissionKey>;
}

// A non-admin needs the group:manage_own capability at all before per-group
// scoping is even considered — turning that permission off disables delegated-
// admin self-service globally (ADR-036 §4).
const hasGroupManageCapability = (caller: GroupCaller): boolean =>
  caller.isAdmin || caller.permissions.has(GROUP_MANAGE_PERMISSION);

const groupRoleSchema = z.enum([GROUP_ROLES.member, GROUP_ROLES.delegatedAdmin]);

// The single authorization gate for every group-scoped action (ADR-036 §3):
// resolve the caller's live memberships, then assert they may manage this group —
// a global admin may manage any, a delegated admin only their own. One place, so
// the cross-group negative paths are enforced and tested in one spot.
const assertCanManageGroup = async (caller: GroupCaller, groupId: string): Promise<void> => {
  if (!hasGroupManageCapability(caller)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot manage groups." });
  }
  const context = await caller.container.useCases.resolveGroupAuthorization.execute(
    caller.userId,
    caller.isAdmin,
  );
  if (context.error) throw toTrpcError(context.error);
  if (!canManageGroup(context.data, groupId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not manage this group." });
  }
};

export const groupRouter = router({
  // Groups the caller may administer: all for a global admin, only the delegated
  // ones otherwise. A plain user (or one without the manage capability) gets an
  // empty list.
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const caller: GroupCaller = ctx;
    if (!hasGroupManageCapability(caller)) return [];
    const context = await ctx.container.useCases.resolveGroupAuthorization.execute(
      ctx.userId,
      ctx.isAdmin,
    );
    if (context.error) throw toTrpcError(context.error);
    const result = await ctx.container.useCases.listManageableGroups.execute(context.data);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // Groups the caller may publish a flow to: any group when they hold
  // publish-to-everyone (admins included), otherwise only groups they belong to
  // (ADR-036 §12). Backs the flow visibility "Groups" picker.
  publishTargets: authenticatedProcedure.query(async ({ ctx }) => {
    const all = await ctx.container.useCases.listGroups.execute();
    if (all.error) throw toTrpcError(all.error);
    const canPublishToEveryone =
      ctx.isAdmin || ctx.permissions.has("workflow:publish_to_everyone");
    if (canPublishToEveryone) return all.data;
    const context = await ctx.container.useCases.resolveGroupAuthorization.execute(
      ctx.userId,
      ctx.isAdmin,
    );
    if (context.error) throw toTrpcError(context.error);
    const memberGroupIds = new Set(groupIdsForMemberships(context.data.memberships));
    return all.data.filter((group) => memberGroupIds.has(group.id));
  }),

  listMembers: authenticatedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCanManageGroup(ctx, input.groupId);
      const result = await ctx.container.useCases.listGroupMembers.execute(input.groupId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Creating groups and assigning their first delegated admin is a global-admin
  // action (PRD user story 1); delegated admins never mint new groups.
  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createGroup.execute({
        name: input.name,
        description: input.description ?? null,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageGroup(ctx, input.groupId);
      const result = await ctx.container.useCases.updateGroup.execute(input.groupId, {
        name: input.name,
        description: input.description,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  delete: adminProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteGroup.execute(input.groupId);
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  addMember: authenticatedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        userId: z.string().uuid(),
        roleInGroup: groupRoleSchema.default(GROUP_ROLES.member),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageGroup(ctx, input.groupId);
      assertRoleAssignable(ctx.isAdmin, input.roleInGroup);
      const result = await ctx.container.useCases.addGroupMember.execute({
        groupId: input.groupId,
        userId: input.userId,
        roleInGroup: input.roleInGroup,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Promote/demote within a group. Granting delegated-admin is global-admin only;
  // a delegated admin may not mint peers (PRD user story 1).
  setMemberRole: authenticatedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        userId: z.string().uuid(),
        roleInGroup: groupRoleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanManageGroup(ctx, input.groupId);
      assertRoleAssignable(ctx.isAdmin, input.roleInGroup);
      const result = await ctx.container.useCases.setGroupMemberRole.execute(
        input.groupId,
        input.userId,
        input.roleInGroup,
      );
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  removeMember: authenticatedProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageGroup(ctx, input.groupId);
      const result = await ctx.container.useCases.removeGroupMember.execute(
        input.groupId,
        input.userId,
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),
});

// Delegated admins manage plain members only; assigning delegated-admin stays a
// global-admin action so a delegated admin can never elevate someone (including
// laterally into another admin of their group) without a global admin.
function assertRoleAssignable(isAdmin: boolean, roleInGroup: GroupRole): void {
  if (roleInGroup === GROUP_ROLES.delegatedAdmin && !isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a global admin can assign a delegated admin.",
    });
  }
}
