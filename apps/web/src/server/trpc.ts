import type { PermissionKey } from "@wayfinder/domain";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { getContainer, type Container } from "@/lib/container";
import {
  getImpersonationCookieFromRequest,
  getSessionTokenFromRequest,
} from "@/lib/session-token";
import { causeToMetadata } from "./error-metadata";

export interface TrpcContext {
  readonly container: Container;
  readonly userId: string | null;
  readonly isAdmin: boolean;
  // The admin behind a simulated session (ADR-059). Attribution only — no
  // procedure may gate on it; `isAdmin` above already reflects the principal
  // actually in force.
  readonly impersonatorId: string | null;
  // The raw impersonation cookie, read once when the context is built. Carried
  // here so no procedure has to call `cookies()`: under httpBatchStreamLink a
  // procedure body runs after the response has been handed back, and request
  // APIs are not reliably available there.
  readonly impersonationCookie: string | null;
  readonly permissions: Set<PermissionKey>;
  readonly headers: Headers;
}

export const resolvePermissions = async (
  container: Container,
  userId: string | null,
  isAdmin: boolean,
): Promise<Set<PermissionKey>> => {
  if (!userId) return new Set();
  const result = await container.resolveEffectivePermissions(userId, isAdmin);
  return result.error ? new Set() : result.data;
};

export const createTrpcContext = async (req: Request): Promise<TrpcContext> => {
  const container = getContainer();

  let userId: string | null = null;
  let isAdmin = false;
  let impersonatorId: string | null = null;

  const impersonationCookie = getImpersonationCookieFromRequest(req);

  const token = getSessionTokenFromRequest(req);
  if (token) {
    const session = await container.resolveSession(token, impersonationCookie);
    if (session) {
      userId = session.userId;
      isAdmin = session.isAdmin;
      impersonatorId = session.impersonatorId;
    }
  }

  const permissions = await resolvePermissions(container, userId, isAdmin);

  return {
    container,
    userId,
    isAdmin,
    impersonatorId,
    impersonationCookie,
    permissions,
    headers: req.headers,
  };
};

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

const errorLogging = t.middleware(async ({ ctx, path, type, next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = causeToMetadata(result.error.cause);
    const metadata: Record<string, unknown> = { code: result.error.code };
    if (cause) metadata.cause = cause;
    void ctx.container.services.errorLogger.log({
      level: "error",
      message: result.error.message,
      stack: result.error.stack ?? null,
      page: `trpc:${type}:${path}`,
      metadata,
    });
  }
  return result;
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(errorLogging);

export const authenticatedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required." });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

// Chains from authenticatedProcedure so `userId` is narrowed to a string: an
// admin is by definition a resolved session, and admin procedures that need to
// name the acting user should not each re-prove it.
export const adminProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
  }
  return next();
});

// Guards a procedure behind an effective permission. Admins always pass (ADR-021).
export const permissionProcedure = (key: PermissionKey) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    if (!ctx.isAdmin && !ctx.permissions.has(key)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to do this." });
    }
    return next();
  });
