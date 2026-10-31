import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { payloadTooLargeResponse, readBodyWithinLimit, TRPC_BODY_LIMIT_BYTES } from "@/lib/request-body-limit";
import { appRouter } from "@/server/router";
import { createTrpcContext } from "@/server/trpc";

const handle = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTrpcContext(req),
  });

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
