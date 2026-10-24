import { describe, expect, it } from "vitest";
import { buildWatchRequest, truncateSample } from "./watch-request";

const connection = {
  url: "https://api.example.gov.au/hearings",
  method: "GET" as const,
  requestBody: null,
  authType: "bearer" as const,
  apiKeyPlacement: null,
};

describe("buildWatchRequest", () => {
  it("sends a bearer token in the Authorization header", () => {
    expect(buildWatchRequest(connection, "token", []).headers).toEqual({ Authorization: "Bearer token" });
  });

  it("sends an API key in the named header or query parameter", () => {
    const header = buildWatchRequest(
      { ...connection, authType: "api_key", apiKeyPlacement: { in: "header", name: "X-Key" } },
      "secret",
      [],
    );
    const query = buildWatchRequest(
      { ...connection, authType: "api_key", apiKeyPlacement: { in: "query", name: "key" } },
      "secret",
      [],
    );

    expect(header.headers).toEqual({ "X-Key": "secret" });
    expect(query.url).toBe("https://api.example.gov.au/hearings?key=secret");
  });

  it("sends the body only with a POST", () => {
    expect(buildWatchRequest({ ...connection, requestBody: { a: 1 } }, null, []).body).toBeUndefined();
    expect(buildWatchRequest({ ...connection, method: "POST", requestBody: { a: 1 } }, null, []).body).toEqual({ a: 1 });
  });
});

describe("truncateSample", () => {
  it("returns a small sample untouched", () => {
    expect(truncateSample({ data: [1, 2] })).toEqual({ sample: { data: [1, 2] }, truncated: false });
  });

  it("cuts a sample with too many nodes and says so", () => {
    const result = truncateSample({ items: Array.from({ length: 5_000 }, (_, index) => ({ id: index })) });

    expect(result.truncated).toBe(true);
    expect((result.sample as { items: unknown[] }).items.length).toBeLessThan(2_000);
  });

  it("cuts a sample that is too large", () => {
    const result = truncateSample({ items: Array.from({ length: 100 }, () => "x".repeat(10_000)) });

    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.sample).length).toBeLessThanOrEqual(256 * 1024);
  });
});
