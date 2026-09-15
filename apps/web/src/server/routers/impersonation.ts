import { z } from "zod";
import { impersonationMinutesRemaining, type User } from "@wayfinder/domain";
import { verifyImpersonationTicket } from "@wayfinder/adapters";
import { adminProcedure, publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// Reads only. Starting, stopping and extending a simulation set a cookie, which
// cannot ride a streamed tRPC response — they are REST routes under
// `/api/impersonation/*`; see `lib/impersonation-actions.ts` for why.

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

  // Public, and null for anyone not simulating. The banner mounts in the root
  // layout, which also renders /login and /register — an authenticatedProcedure
  // would throw UNAUTHORIZED there. Mirrors the site banner's public query.
  current: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.impersonatorId || !ctx.userId || !ctx.impersonationCookie) return null;

    const ticket = verifyImpersonationTicket(
      ctx.impersonationCookie,
      ctx.container.env.BETTER_AUTH_SECRET,
    );
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
