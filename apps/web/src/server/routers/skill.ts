import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { canOpenAdminArea } from "@/lib/admin-areas";
import { authenticatedProcedure, router, technicalAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const skillRouter = router({
  // Active skills are readable by any authenticated user so the flow editor can
  // populate its picker; archived ones belong to the technical admin area.
  list: authenticatedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const includeArchived = input?.includeArchived ?? false;
      if (includeArchived && !canOpenAdminArea(ctx, "technical")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to do this." });
      }
      const result = await ctx.container.useCases.listSkills.execute({ includeArchived });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  get: authenticatedProcedure
    .input(z.object({ id: z.string().guid() }))
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

  create: technicalAdminProcedure
    .input(z.object({ raw: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.createSkill.execute({
        raw: input.raw,
        createdByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: technicalAdminProcedure
    .input(z.object({ id: z.string().guid(), raw: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateSkill.execute({
        id: input.id,
        raw: input.raw,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  archive: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.archiveSkill.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  restore: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.restoreSkill.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
