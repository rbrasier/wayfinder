import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRequestHandler } = vi.hoisted(() => ({ fetchRequestHandler: vi.fn() }));

vi.mock("@trpc/server/adapters/fetch", () => ({ fetchRequestHandler }));
vi.mock("@/server/router", () => ({ appRouter: {} }));
vi.mock("@/server/trpc", () => ({ createTrpcContext: vi.fn() }));

import { TRPC_BODY_LIMIT_BYTES } from "@/lib/request-body-limit";
import { GET, POST } from "./route";

const trpcUrl = "http://localhost:3000/api/trpc/flows.create?batch=1";

describe("/api/trpc", () => {
  beforeEach(() => {
    fetchRequestHandler.mockReset();
    fetchRequestHandler.mockResolvedValue(new Response("ok"));
  });

  it("rejects a POST over the limit without reaching tRPC", async () => {
    const request = new Request(trpcUrl, {
      method: "POST",
      headers: { "content-length": String(TRPC_BODY_LIMIT_BYTES + 1) },
      body: "{}",
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(fetchRequestHandler).not.toHaveBeenCalled();
  });

  it("hands a POST under the limit to tRPC with its body, method and headers intact", async () => {
    const body = JSON.stringify({ 0: { json: { name: "Onboarding" } } });
    const request = new Request(trpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "better-auth.session_token=abc" },
      body,
    });

    await POST(request);

    const forwarded = fetchRequestHandler.mock.calls[0]?.[0].req as Request;
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe(trpcUrl);
    expect(forwarded.headers.get("cookie")).toBe("better-auth.session_token=abc");
    expect(await forwarded.text()).toBe(body);
  });

  it("passes a GET straight through", async () => {
    const request = new Request(trpcUrl, { method: "GET" });

    await GET(request);

    expect(fetchRequestHandler.mock.calls[0]?.[0].req).toBe(request);
  });
});
