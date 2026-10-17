import { TRPCError } from "@trpc/server";
import { authenticatedProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// Every procedure re-checks the extraction_flows flag server-side — the client
// gate is never the enforcement point (ADR-033 §7).
export const extractionEnabled = authenticatedProcedure.use(async ({ ctx, next }) => {
  const enabled = await ctx.container.useCases.isFeatureEnabledForUser.execute(
    ctx.userId,
    "extraction_flows",
    ctx.isAdmin,
  );
  if (enabled.error) throw toTrpcError(enabled.error);
  if (!enabled.data) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Synthesise Information is not enabled for you.",
    });
  }
  return next();
});

export const authorProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:author")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot author extraction flows." });
  }
  return next();
});

export const runProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (!ctx.isAdmin && !ctx.permissions.has("extraction:run")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot run extraction flows." });
  }
  return next();
});

// Listing/viewing is allowed to either an author or a runner.
export const viewProcedure = extractionEnabled.use(({ ctx, next }) => {
  if (
    !ctx.isAdmin &&
    !ctx.permissions.has("extraction:author") &&
    !ctx.permissions.has("extraction:run")
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You cannot view extraction flows." });
  }
  return next();
});
