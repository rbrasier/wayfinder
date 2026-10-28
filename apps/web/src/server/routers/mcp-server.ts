import { z } from "zod";
import { authenticatedProcedure, router, technicalAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// The bearer token itself — stored encrypted, never sent back (ADR-032).
const credentialInput = z.string().max(4096, "The token is too long.").nullable().optional();

export const mcpServerRouter = router({
  list: technicalAdminProcedure
    .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
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

  register: technicalAdminProcedure
    .input(
      z.object({
        label: z.string().min(1),
        url: z.string().min(1),
        transport: z.enum(["sse", "streamable-http"]).optional(),
        communicatesExternally: z.boolean().optional(),
        credential: credentialInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.registerMcpServer.execute({
        label: input.label,
        url: input.url,
        transport: input.transport,
        communicatesExternally: input.communicatesExternally,
        credential: input.credential,
        createdByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: technicalAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        communicatesExternally: z.boolean().optional(),
        // Absent keeps the stored token, null removes it, a string replaces it.
        credential: credentialInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateMcpServer.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  disable: technicalAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.disableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  enable: technicalAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.enableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Permanent removal. Steps referencing a deleted server drop the stale tool
  // refs silently at resolve time (ResolveStepTools), so no cascade is needed.
  delete: technicalAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Connection test — lists the server's tools so the admin can confirm reach
  // and credentials before using it in a flow.
  test: technicalAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.testMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
