import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/rate-limit";
import { publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// First-run bootstrap (ADR-041 §0). Both procedures are public because they run
// before any admin — and therefore any session — exists. The create path is
// defended in layers inside the use-case (setup token, seed-email binding,
// transactional singleton guard, audit); this router adds IP rate-limiting.
export const bootstrapRouter = router({
  // Drives whether the public /setup screen is shown and the no-admin redirect.
  adminExists: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.adminExists.execute();
    if (result.error) throw toTrpcError(result.error);
    return { adminExists: result.data };
  }),

  createAdmin: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, "Password must be at least 8 characters."),
        name: z.string().optional(),
        token: z.string().min(1, "A setup token is required."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIpFromHeaders(ctx.headers);
      const decision = await ctx.container.services.authRateLimiter.consume(`bootstrap:${ip}`);
      if (decision.error) throw toTrpcError(decision.error);
      if (!decision.data.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many setup attempts. Please wait a moment and try again.",
        });
      }

      const result = await ctx.container.useCases.createFirstAdmin.execute({
        email: input.email,
        password: input.password,
        name: input.name,
        token: input.token,
      });
      if (result.error) throw toTrpcError(result.error);
      return { userId: result.data.userId };
    }),
});
