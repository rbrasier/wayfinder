import { z } from "zod";
import { MAX_MCP_CALL_TIMEOUT_MS, MAX_MCP_TOOL_PAGES, MIN_MCP_CALL_TIMEOUT_MS } from "@wayfinder/domain";
import { authenticatedProcedure, router, technicalAdminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const classificationSchema = z.enum(["internal", "public-read", "external-write"]);
const timeoutSchema = z.number().int().min(MIN_MCP_CALL_TIMEOUT_MS).max(MAX_MCP_CALL_TIMEOUT_MS);
// Write-only: accepted on register/update, never returned by any procedure.
const secretInputs = {
  bearerToken: z.string().nullable().optional(),
  customHeaders: z.record(z.string(), z.string()).nullable().optional(),
  // OAuth 2.0 client credentials (issue #361). An absent client secret keeps the
  // saved one; null stops the server using OAuth.
  oauth: z
    .object({
      tokenUrl: z.string().max(2048),
      clientId: z.string().max(512),
      clientSecret: z.string().max(4096).optional(),
      scope: z.string().max(1024).nullable().optional(),
      audience: z.string().max(2048).nullable().optional(),
      clientAuthMethod: z.enum(["client_secret_basic", "client_secret_post"]).optional(),
    })
    .nullable()
    .optional(),
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
    // Flow authors see which servers exist, not how they sign in.
    return result.data.map(({ server, tools }) => ({ server: { ...server, oauth: null }, tools }));
  }),

  register: technicalAdminProcedure
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
      const result = await ctx.container.useCases.registerMcpServer.execute({
        ...input,
        createdByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  update: technicalAdminProcedure
    .input(
      z.object({
        id: z.string().guid(),
        label: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        dataClassification: classificationSchema.optional(),
        verbatimOnly: z.boolean().optional(),
        callTimeoutMs: timeoutSchema.optional(),
        ...secretInputs,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateMcpServer.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  disable: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.disableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  enable: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.enableMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Permanent removal. Steps referencing a deleted server drop the stale tool
  // refs silently at resolve time (ResolveStepTools), so no cascade is needed.
  delete: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.deleteMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Connection test — lists the server's tools so the admin can confirm reach
  // and credentials before using it in a flow.
  test: technicalAdminProcedure
    .input(z.object({ id: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.testMcpServer.execute(input.id);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // The cached tools with their per-tool settings (ADR-062 §5).
  listTools: technicalAdminProcedure
    .input(z.object({ serverId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listMcpTools.execute(input.serverId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  refreshTools: technicalAdminProcedure
    .input(z.object({ serverId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.refreshMcpTools.execute(input.serverId);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  updateToolSettings: technicalAdminProcedure
    .input(
      z.object({
        serverId: z.string().guid(),
        toolName: z.string().min(1),
        settings: toolSettingsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.updateMcpToolSettings.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
