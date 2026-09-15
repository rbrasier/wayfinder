import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { runWithAuditActor } from "@wayfinder/adapters";
import { appRouter } from "@/server/router";
import { createTrpcContext } from "@/server/trpc";

// The context is built first so the actor scope can be opened around every
// procedure in the request — including the mutations that audit, which have no
// idea who is driving them (ADR-060 §3).
const handler = async (req: Request): Promise<Response> => {
  const context = await createTrpcContext(req);

  return runWithAuditActor(
    { userId: context.userId, impersonatorId: context.impersonatorId },
    () =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: () => context,
      }),
  );
};

export { handler as GET, handler as POST };
