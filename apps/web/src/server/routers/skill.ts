import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const requireAdmin = (isAdmin: boolean): void => {
  if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
};

export const skillRouter = router({
  // Active skills are readable by any authenticated user so the flow editor can
  // populate its picker; archived ones are admin-only.
  list: authenticatedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const includeArchived = input?.includeArchived ?? false;
      if (includeArchived) requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.listSkills.execute({ includeArchived });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getSkill.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Validates an uploaded SKILL.md without storing it — used by the inline-skill
  // editor and to preview a library upload before committing.
  parse: authenticatedProcedure
    .input(z.object({ raw: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = ctx.container.services.skillParser.parse(input.raw);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  create: authenticatedProcedure
    .input(z.object({ raw: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.createSkill.execute({
        raw: input.raw,
        createdByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: authenticatedProcedure
    .input(z.object({ id: z.string().uuid(), raw: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.updateSkill.execute({
        id: input.id,
        raw: input.raw,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  archive: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.archiveSkill.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  restore: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.restoreSkill.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
