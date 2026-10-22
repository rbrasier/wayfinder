import { describe, expect, it } from "vitest";
import { FetchOutboundHttpClient, isBlockedAddress } from "./fetch-outbound-http-client";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd12::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "203.0.113.5", "2606:4700::1111"])("allows public %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

type Answer = { status: number; body?: string; location?: string };

const build = (answers: Record<string, Answer>, addresses: Record<string, string>) => {
  const requested: Array<{ url: string; headers: Record<string, string> }> = [];
  const client = new FetchOutboundHttpClient(
    async (hostname) => {
      const address = addresses[hostname];
      if (!address) throw new Error(`ENOTFOUND ${hostname}`);
      return [address];
    },
    async (url, init) => {
      requested.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      const answer = answers[String(url)] ?? { status: 404, body: "" };
      return new Response(answer.body ?? "", {
        status: answer.status,
        headers: answer.location ? { location: answer.location } : {},
      });
    },
  );
  return { client, requested };
};

const request = (url: string, overrides: Partial<Parameters<FetchOutboundHttpClient["requestJson"]>[0]> = {}) => ({
  url,
  method: "GET" as const,
  headers: { Authorization: "Bearer super-secret" },
  timeoutMs: 1000,
  maxBytes: 1024,
  allowedHosts: [],
  ...overrides,
});

describe("FetchOutboundHttpClient", () => {
  it("returns parsed JSON from a public API", async () => {
    const { client } = build(
      { "https://api.example.com/h": { status: 200, body: '{"items":[1]}' } },
      { "api.example.com": "203.0.113.5" },
    );

    const result = await client.requestJson(request("https://api.example.com/h"));

    expect(result.data).toEqual({ status: 200, json: { items: [1] } });
  });

  it("refuses an unlisted private host when the admin has listed private hosts, before sending anything", async () => {
    const { client, requested } = build({}, { "internal.example.com": "10.0.0.5" });

    const result = await client.requestJson(
      request("https://internal.example.com/h", { allowedHosts: ["hearings.internal"] }),
    );

    expect(result.error?.message).toBe("internal.example.com resolves to a private network address, which is not allowed.");
    expect(requested).toEqual([]);
  });

  it("calls a private host the admin has allowed", async () => {
    const { client } = build(
      { "https://hearings.internal/h": { status: 200, body: "{}" } },
      { "hearings.internal": "10.0.0.5" },
    );

    const result = await client.requestJson(request("https://hearings.internal/h", { allowedHosts: ["hearings.internal"] }));

    expect(result.error).toBeUndefined();
  });

  it("calls any private host while the admin's list is blank", async () => {
    const { client } = build(
      { "https://internal.example.com/h": { status: 200, body: "{}" } },
      { "internal.example.com": "10.0.0.5" },
    );

    const result = await client.requestJson(request("https://internal.example.com/h"));

    expect(result.error).toBeUndefined();
  });

  it.each(["169.254.169.254", "fe80::1"])(
    "still refuses the cloud metadata range (%s) while the list is blank",
    async (address) => {
      const { client, requested } = build({}, { "metadata.internal": address });

      const result = await client.requestJson(request("https://metadata.internal/latest"));

      expect(result.error?.message).toBe(
        "metadata.internal resolves to a cloud metadata address, which is not allowed.",
      );
      expect(requested).toEqual([]);
    },
  );

  it("re-checks every redirect and refuses one that lands on a private address", async () => {
    const { client } = build(
      { "https://api.example.com/h": { status: 302, location: "http://169.254.169.254/latest/meta-data" } },
      { "api.example.com": "203.0.113.5" },
    );

    const result = await client.requestJson(request("https://api.example.com/h"));

    expect(result.error?.message).toContain("169.254.169.254");
  });

  it("gives up after three redirects", async () => {
    const { client } = build(
      {
        "https://a.example.com/1": { status: 302, location: "https://a.example.com/2" },
        "https://a.example.com/2": { status: 302, location: "https://a.example.com/3" },
        "https://a.example.com/3": { status: 302, location: "https://a.example.com/4" },
        "https://a.example.com/4": { status: 302, location: "https://a.example.com/5" },
      },
      { "a.example.com": "203.0.113.5" },
    );

    expect((await client.requestJson(request("https://a.example.com/1"))).error?.message).toBe(
      "The API redirected more than 3 times.",
    );
  });

  it("reports a non-2xx answer without leaking the request's headers", async () => {
    const { client } = build({ "https://api.example.com/h": { status: 401, body: "nope" } }, { "api.example.com": "203.0.113.5" });

    const result = await client.requestJson(request("https://api.example.com/h"));

    expect(result.error?.message).toBe("The API answered HTTP 401.");
    expect(JSON.stringify(result.error)).not.toContain("super-secret");
  });

  it("refuses a body over the size limit and a body that is not JSON", async () => {
    const { client } = build(
      {
        "https://api.example.com/big": { status: 200, body: JSON.stringify({ text: "x".repeat(5000) }) },
        "https://api.example.com/html": { status: 200, body: "<html></html>" },
      },
      { "api.example.com": "203.0.113.5" },
    );

    expect((await client.requestJson(request("https://api.example.com/big"))).error?.message).toBe(
      "The response is larger than 1 KB.",
    );
    expect((await client.requestJson(request("https://api.example.com/html"))).error?.message).toBe(
      "The response is not JSON.",
    );
  });

  it("refuses anything but http and https", async () => {
    const { client } = build({}, {});

    expect((await client.requestJson(request("file:///etc/passwd"))).error?.message).toBe(
      "Only http:// and https:// addresses can be called.",
    );
  });
});
