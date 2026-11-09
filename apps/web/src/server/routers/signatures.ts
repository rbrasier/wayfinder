import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";
import { authenticatedProcedure, canOversee, router, type TrpcContext } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const ACCESS_CODE = { 403: "FORBIDDEN", 404: "NOT_FOUND", 500: "INTERNAL_SERVER_ERROR" } as const;

// Signatures belong to a session's governed record, so anyone who can read the
// session — approvers included — can see and re-check them (PRD §6).
const authoriseRead = async (ctx: TrpcContext & { userId: string }, sessionId: string): Promise<void> => {
  const outcome = await authorizeSessionAccess(ctx.container, sessionId, ctx.userId, canOversee(ctx), {
    requireSend: false,
    allowApprover: true,
  });
  if (outcome.authorized) return;
  throw new TRPCError({ code: ACCESS_CODE[outcome.status], message: accessError(outcome.status) });
};

const sessionInput = z.object({ sessionId: z.string().guid() });

export const signaturesRouter = router({
  listForSession: authenticatedProcedure.input(sessionInput).query(async ({ ctx, input }) => {
    await authoriseRead(ctx, input.sessionId);
    const result = await ctx.container.useCases.listSessionSignatures.execute(input.sessionId);
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  revalidate: authenticatedProcedure.input(sessionInput).mutation(async ({ ctx, input }) => {
    await authoriseRead(ctx, input.sessionId);
    const result = await ctx.container.useCases.revalidateSessionSignatures.execute({
      sessionId: input.sessionId,
      actorId: ctx.userId,
    });
    if (result.error) throw toTrpcError(result.error);
    return { ok: true };
  }),

  exportMetadata: authenticatedProcedure.input(sessionInput).mutation(async ({ ctx, input }) => {
    await authoriseRead(ctx, input.sessionId);
    const result = await ctx.container.useCases.exportSignatureMetadata.execute(input.sessionId);
    if (result.error) throw toTrpcError(result.error);
    await ctx.container.services.auditLogger.log({
      actorId: ctx.userId,
      action: "signature.metadata_exported",
      resourceType: "session",
      resourceId: input.sessionId,
      metadata: { rows: result.data.records.length },
    });
    return { csv: result.data.csv.toString("utf8"), records: result.data.records };
  }),
});
