import type { AdminCaller } from "@rbrasier/application";
import type { PermissionKey } from "@rbrasier/domain";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { getContainer, type Container } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { causeToMetadata } from "./error-metadata";

export interface TrpcContext {
  readonly container: Container;
  readonly userId: string | null;
  // core_sessions.id of the current sign-in, never the token (ADR-060 §5).
  readonly authSessionId: string | null;
  readonly isAdmin: boolean;
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
  let authSessionId: string | null = null;
  let isAdmin = false;

  const token = getSessionTokenFromRequest(req);
  if (token) {
    const session = await container.resolveSession(token);
    if (session) {
      userId = session.userId;
      authSessionId = session.sessionId;
      isAdmin = session.isAdmin;
    }
  }

  const permissions = await resolvePermissions(container, userId, isAdmin);

  return { container, userId, authSessionId, isAdmin, permissions, headers: req.headers };
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

export const adminProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
  }
  return next();
});

// For reads shared by several admin areas, such as the user list behind both
// user management and the oversight screens' filters (ADR-066 §4).
export const anyPermissionProcedure = (keys: readonly PermissionKey[]) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    if (!ctx.isAdmin && !keys.some((key) => ctx.permissions.has(key))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to do this." });
    }
    return next();
  });

// Whether the caller may open and edit other people's chats and flows, as an
// admin does from All Chats and All Flows (ADR-066 §4). Use it only where
// `isAdmin` stands for "may bypass ownership" — group-admin powers, flag
// resolution and visibility rules stay on `isAdmin`.
export const canOversee = (ctx: Pick<TrpcContext, "isAdmin" | "permissions">): boolean =>
  ctx.isAdmin || ctx.permissions.has("admin:oversight");

// Guards a procedure behind an effective permission. Admins always pass (ADR-021).
export const permissionProcedure = (key: PermissionKey) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    if (!ctx.isAdmin && !ctx.permissions.has(key)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to do this." });
    }
    return next();
  });

// The delegable admin areas (ADR-066 §1). Anything not on one of these stays on
// adminProcedure, so a procedure nobody re-classified fails closed.
export const technicalAdminProcedure = permissionProcedure("admin:technical");
export const userAdminProcedure = permissionProcedure("admin:users");
export const oversightProcedure = permissionProcedure("admin:oversight");

// The caller the user and role use cases guard against (ADR-066 §3).
export const adminCallerOf = (ctx: Pick<TrpcContext, "isAdmin" | "userId">): AdminCaller => ({
  isAdmin: ctx.isAdmin,
  userId: ctx.userId,
});
