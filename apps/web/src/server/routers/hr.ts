import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const requireAdmin = (isAdmin: boolean): void => {
  if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
};

export const hrRouter = router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx.isAdmin);
    const result = await ctx.container.repos.hrDatasets.listDatasets();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  upload: authenticatedProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        format: z.enum(["csv", "xlsx"]),
        contentBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const content = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
      const result = await ctx.container.useCases.importHrDataset.execute({
        filename: input.filename,
        format: input.format,
        content,
        uploadedByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  setMapping: authenticatedProcedure
    .input(
      z.object({
        datasetId: z.string().uuid(),
        mapping: z.record(z.enum(["email", "name", "manager", "position", "band", "unit"])),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.setColumnMapping.execute({
        datasetId: input.datasetId,
        mapping: input.mapping,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
