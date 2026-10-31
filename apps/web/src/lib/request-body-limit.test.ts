import { describe, expect, it } from "vitest";
import { payloadTooLargeResponse, readBodyWithinLimit, readJsonWithinLimit } from "./request-body-limit";

const encoder = new TextEncoder();

// A streamed body, delivered in chunks, that records how much the reader pulled
// and whether it cancelled the stream rather than draining it to the end.
const chunkedRequest = (
  chunks: string[],
  headers: Record<string, string> = {},
): { request: Request; wasCancelled: () => boolean; chunksPulled: () => number } => {
  let cancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/test", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
  return { request, wasCancelled: () => cancelled, chunksPulled: () => index };
};

describe("readBodyWithinLimit", () => {
  it("returns a body at the limit unchanged", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: "a".repeat(10) });
    expect(await readBodyWithinLimit(request, 10)).toEqual({ data: "a".repeat(10) });
  });

  it("counts bytes, not characters, and keeps multi-byte text intact", async () => {
    const text = "héllo — wörld";
    const byteLength = encoder.encode(text).length;
    const request = new Request("http://localhost/test", { method: "POST", body: text });
    expect(await readBodyWithinLimit(request, byteLength)).toEqual({ data: text });

    const tooSmall = new Request("http://localhost/test", { method: "POST", body: text });
    expect(await readBodyWithinLimit(tooSmall, text.length)).toEqual({ error: "too_large" });
  });

  it("rejects on Content-Length without reading the body", async () => {
    const { request, chunksPulled } = chunkedRequest(["small"], { "content-length": "1000" });
    expect(await readBodyWithinLimit(request, 100)).toEqual({ error: "too_large" });
    expect(chunksPulled()).toBe(0);
  });

  it("stops reading a chunked body as soon as it passes the limit", async () => {
    const { request, wasCancelled } = chunkedRequest(["a".repeat(60), "b".repeat(60), "c".repeat(60)]);
    expect(await readBodyWithinLimit(request, 100)).toEqual({ error: "too_large" });
    expect(wasCancelled()).toBe(true);
  });

  it("joins a chunked body under the limit", async () => {
    const { request } = chunkedRequest(["ab", "cd", "ef"]);
    expect(await readBodyWithinLimit(request, 100)).toEqual({ data: "abcdef" });
  });

  it("reads a request with no body as an empty string", async () => {
    const request = new Request("http://localhost/test", { method: "POST" });
    expect(await readBodyWithinLimit(request, 100)).toEqual({ data: "" });
  });
});

describe("readJsonWithinLimit", () => {
  it("parses JSON under the limit", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: '{"messages":[]}' });
    expect(await readJsonWithinLimit(request, 100)).toEqual({ data: { messages: [] } });
  });

  it("reports malformed JSON", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: "{not json" });
    expect(await readJsonWithinLimit(request, 100)).toEqual({ error: "invalid_json" });
  });

  it("reports an oversized body before parsing", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: `"${"a".repeat(200)}"` });
    expect(await readJsonWithinLimit(request, 100)).toEqual({ error: "too_large" });
  });
});

describe("payloadTooLargeResponse", () => {
  it("is a 413", async () => {
    const response = payloadTooLargeResponse();
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
  });
});
