import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { runWithAuditActor } from "@wayfinder/adapters";
import { payloadTooLargeResponse, readBodyWithinLimit, TRPC_BODY_LIMIT_BYTES } from "@/lib/request-body-limit";
import { appRouter } from "@/server/router";
import { createTrpcContext } from "@/server/trpc";

// The context is built first so the actor scope can be opened around every
// procedure in the request — including the mutations that audit, which have no
// idea who is driving them (ADR-060 §3).
const handle = async (req: Request): Promise<Response> => {
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

const GET = (req: Request): Promise<Response> => handle(req);

// The body is read under a cap before tRPC sees it, then replayed as a fresh
// Request, because tRPC itself buffers and validates whatever it is given. The
// original Content-Length is dropped: re-encoding the decoded text can change
// the byte count, and a mismatched header would corrupt the replay.
const POST = async (req: Request): Promise<Response> => {
  const body = await readBodyWithinLimit(req, TRPC_BODY_LIMIT_BYTES);
  if ("error" in body) return payloadTooLargeResponse();
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return handle(new Request(req.url, { method: req.method, headers, body: body.data }));
};

export { GET, POST };
