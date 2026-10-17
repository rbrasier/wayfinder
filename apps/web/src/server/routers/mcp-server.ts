import { z } from "zod";
import { MAX_MCP_CALL_TIMEOUT_MS, MAX_MCP_TOOL_PAGES, MIN_MCP_CALL_TIMEOUT_MS } from "@wayfinder/domain";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const requireAdmin = (isAdmin: boolean): void => {
  if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
};

const classificationSchema = z.enum(["internal", "public-read", "external-write"]);
const timeoutSchema = z.number().int().min(MIN_MCP_CALL_TIMEOUT_MS).max(MAX_MCP_CALL_TIMEOUT_MS);
// Write-only: accepted on register/update, never returned by any procedure.
const secretInputs = {
  bearerToken: z.string().nullable().optional(),
  customHeaders: z.record(z.string(), z.string()).nullable().optional(),
};

const pathSchema = z.string().min(1);
const toolSettingsSchema = z.object({
  pagination: z
    .object({
      cursorArgument: z.string().min(1),
      nextCursorPath: pathSchema,
      itemsPath: pathSchema,
      maxPages: z.number().int().min(1).max(MAX_MCP_TOOL_PAGES),
    })
    .nullable(),
  status: z
    .object({
      statusPath: pathSchema,
      meanings: z.record(z.string(), z.enum(["ok", "no-data", "source-unavailable", "upstream-gap"])),
      caveatsPath: pathSchema.nullable(),
    })
    .nullable(),
  citation: z
    .object({
      recordsPath: pathSchema,
      locatorField: pathSchema,
      titleField: pathSchema.nullable(),
      urlField: pathSchema.nullable(),
      timestampField: pathSchema.nullable(),
    })
    .nullable(),
});

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
        dataClassification: classificationSchema.optional(),
        verbatimOnly: z.boolean().optional(),
        callTimeoutMs: timeoutSchema.optional(),
        ...secretInputs,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.registerMcpServer.execute({
        ...input,
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
        dataClassification: classificationSchema.optional(),
        verbatimOnly: z.boolean().optional(),
        callTimeoutMs: timeoutSchema.optional(),
        ...secretInputs,
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

  // The cached tools with their per-tool settings (ADR-062 §5).
  listTools: authenticatedProcedure
    .input(z.object({ serverId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.listMcpTools.execute(input.serverId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  refreshTools: authenticatedProcedure
    .input(z.object({ serverId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.refreshMcpTools.execute(input.serverId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  updateToolSettings: authenticatedProcedure
    .input(
      z.object({
        serverId: z.string().uuid(),
        toolName: z.string().min(1),
        settings: toolSettingsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.isAdmin);
      const result = await ctx.container.useCases.updateMcpToolSettings.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
