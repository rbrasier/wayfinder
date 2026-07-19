import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const requireAdmin = (isAdmin: boolean): void => {
  if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
};

export const mcpServerRouter = router({
  list: authenticatedProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.listMcpServers.execute({
        includeDisabled: input?.includeDisabled ?? true,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Active servers with their currently-exposed tools, for the flow editor's
  // allowed-tools picker.
  listWithTools: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listMcpServersWithTools.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  register: authenticatedProcedure
    .input(
      z.object({
        label: z.string().min(1),
        url: z.string().min(1),
        transport: z.enum(["sse", "streamable-http"]).optional(),
        communicatesExternally: z.boolean().optional(),
        credentialRef: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.registerMcpServer.execute({
        label: input.label,
        url: input.url,
        transport: input.transport,
        communicatesExternally: input.communicatesExternally,
        credentialRef: input.credentialRef ?? null,
        createdByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        communicatesExternally: z.boolean().optional(),
        credentialRef: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.updateMcpServer.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  disable: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.disableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  enable: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.enableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Permanent removal. Steps referencing a deleted server drop the stale tool
  // refs silently at resolve time (ResolveStepTools), so no cascade is needed.
  delete: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.deleteMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Connection test — lists the server's tools so the admin can confirm reach
  // and credentials before using it in a flow.
  test: authenticatedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.testMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
