// App Router route handlers impose no body limit of their own, so an oversized
// body would otherwise be buffered and handed to a validator in full — the
// shape of zod's memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5).
export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

// tRPC also carries base64 file uploads (extraction, synthesise, HR data), which
// base64 inflates by about a third: 25 MB leaves room for a ~18 MB file.
export const TRPC_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

export type BoundedBody = { data: string } | { error: "too_large" };
export type BoundedJson = { data: unknown } | { error: "too_large" | "invalid_json" };

const declaredLengthExceeds = (request: Request, maxBytes: number): boolean => {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
};

// Counts bytes as they arrive rather than trusting Content-Length, so a chunked
// body or a lying header is still cut off at the limit.
export const readBodyWithinLimit = async (request: Request, maxBytes: number): Promise<BoundedBody> => {
  if (!request.body) return { data: "" };
  if (declaredLengthExceeds(request, maxBytes)) {
    await request.body.cancel();
    return { error: "too_large" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      return { error: "too_large" };
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  const text = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
  return { data: text };
};

export const readJsonWithinLimit = async (request: Request, maxBytes: number): Promise<BoundedJson> => {
  const body = await readBodyWithinLimit(request, maxBytes);
  if ("error" in body) return body;
  try {
    return { data: JSON.parse(body.data) as unknown };
  } catch {
    return { error: "invalid_json" };
  }
};

export const payloadTooLargeResponse = (): Response => new Response("Payload too large", { status: 413 });
