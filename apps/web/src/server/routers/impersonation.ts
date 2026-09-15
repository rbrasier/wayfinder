import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createImpersonationTicket,
  extendImpersonation,
  impersonationMinutesRemaining,
  type User,
} from "@wayfinder/domain";
import { signImpersonationTicket, verifyImpersonationTicket } from "@wayfinder/adapters";
import {
  clearImpersonationCookie,
  readImpersonationCookie,
  writeImpersonationCookie,
} from "@/lib/impersonation-cookie-store";
import { adminProcedure, authenticatedProcedure, publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// The picker is a keystroke-driven list, so it is bounded like the approver
// type-ahead it borrows its search from.
const TARGET_LIST_LIMIT = 50;

const toTarget = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

export const impersonationRouter = router({
  listTargets: adminProcedure
    .input(z.object({ search: z.string().trim().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      const search = input.search ?? "";
      // The user repository already does case-insensitive matching over name and
      // email for the approver type-ahead; reusing it keeps one definition of
      // what "matches a person" means.
      const result = search.length > 0
        ? await ctx.container.repos.users.search({ query: search, limit: TARGET_LIST_LIMIT })
        : await ctx.container.useCases.listUsers.execute({ limit: TARGET_LIST_LIMIT });
      if (result.error) throw toTrpcError(result.error);

      return result.data.filter((user) => user.id !== ctx.userId).map(toTarget);
    }),

  start: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (await readImpersonationCookie()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You are already viewing as another user.",
        });
      }

      const targetResult = await ctx.container.repos.users.findById(input.userId);
      if (targetResult.error) throw toTrpcError(targetResult.error);
      if (!targetResult.data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That user no longer exists." });
      }

      const ticket = createImpersonationTicket({
        targetUserId: input.userId,
        impersonatorId: ctx.userId,
      });
      if (ticket.error) throw toTrpcError(ticket.error);

      await writeImpersonationCookie(
        signImpersonationTicket(ticket.data, ctx.container.env.BETTER_AUTH_SECRET),
        ticket.data.expiresAt,
      );

      // actor_id is the admin: starting a simulation is the admin's own action,
      // not the target's. The explicit impersonatorId stops the ambient merge
      // stamping `impersonated: true` on a row whose actor already is the
      // impersonator (ADR-060 §5).
      await ctx.container.services.auditLogger.log({
        actorId: ctx.userId,
        action: "impersonation.started",
        resourceType: "user",
        resourceId: input.userId,
        metadata: { impersonatorId: ctx.userId, targetUserId: input.userId },
      });

      return { targetUserId: input.userId, expiresAt: ticket.data.expiresAt };
    }),

  stop: authenticatedProcedure.mutation(async ({ ctx }) => {
    const cookieValue = await readImpersonationCookie();
    await clearImpersonationCookie();

    // A double-click, a stale tab, or a ticket that expired between render and
    // click all land here with nothing to stop. Clearing and returning ok beats
    // an error toast for something harmless — and writes no null-actor row.
    if (!cookieValue || !ctx.impersonatorId) return { stopped: false };

    const ticket = verifyImpersonationTicket(cookieValue, ctx.container.env.BETTER_AUTH_SECRET);

    await ctx.container.services.auditLogger.log({
      actorId: ctx.impersonatorId,
      action: "impersonation.stopped",
      resourceType: "user",
      resourceId: ctx.userId,
      metadata: {
        impersonatorId: ctx.impersonatorId,
        targetUserId: ctx.userId,
        ...(ticket ? { durationMs: Date.now() - ticket.startedAt.getTime() } : {}),
      },
    });

    return { stopped: true };
  }),

  extend: authenticatedProcedure.mutation(async ({ ctx }) => {
    const cookieValue = await readImpersonationCookie();
    if (!cookieValue || !ctx.impersonatorId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "You are not viewing as another user.",
      });
    }

    const secret = ctx.container.env.BETTER_AUTH_SECRET;
    const ticket = verifyImpersonationTicket(cookieValue, secret);
    if (!ticket) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This session has ended." });
    }

    const extended = extendImpersonation(ticket);
    if (extended.error) throw toTrpcError(extended.error);

    await writeImpersonationCookie(
      signImpersonationTicket(extended.data, secret),
      extended.data.expiresAt,
    );

    await ctx.container.services.auditLogger.log({
      actorId: ctx.impersonatorId,
      action: "impersonation.extended",
      resourceType: "user",
      resourceId: ctx.userId,
      metadata: {
        impersonatorId: ctx.impersonatorId,
        targetUserId: ctx.userId,
        expiresAt: extended.data.expiresAt.toISOString(),
      },
    });

    return { expiresAt: extended.data.expiresAt };
  }),

  // Public, and null for anyone not simulating. The banner mounts in the root
  // layout, which also renders /login and /register — an authenticatedProcedure
  // would throw UNAUTHORIZED there. Mirrors the site banner's public query.
  current: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.impersonatorId || !ctx.userId) return null;

    const cookieValue = await readImpersonationCookie();
    if (!cookieValue) return null;

    const ticket = verifyImpersonationTicket(cookieValue, ctx.container.env.BETTER_AUTH_SECRET);
    if (!ticket) return null;

    const targetResult = await ctx.container.repos.users.findById(ctx.userId);
    const target = targetResult.error ? null : targetResult.data;

    // Deliberately never returns the impersonator's identity — the banner tells
    // the admin who they are viewing as, not who they are.
    return {
      targetName: target?.name ?? null,
      targetEmail: target?.email ?? null,
      minutesRemaining: impersonationMinutesRemaining(ticket),
    };
  }),
});
