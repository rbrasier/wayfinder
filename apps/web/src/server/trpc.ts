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
  let isAdmin = false;

  const token = getSessionTokenFromRequest(req);
  if (token) {
    const session = await container.resolveSession(token);
    if (session) {
      userId = session.userId;
      isAdmin = session.isAdmin;
    }
  }

  const permissions = await resolvePermissions(container, userId, isAdmin);

  return { container, userId, isAdmin, permissions, headers: req.headers };
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

// Guards a procedure behind an effective permission. Admins always pass (ADR-021).
export const permissionProcedure = (key: PermissionKey) =>
  authenticatedProcedure.use(({ ctx, next }) => {
    if (!ctx.isAdmin && !ctx.permissions.has(key)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to do this." });
    }
    return next();
  });
