import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import { ApiValueSetAdapter, API_RESPONSE_BYTE_CAP } from "./api-value-set-provider";

const jsonResponse = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });

const departments = [
  { department: "Finance", department_code: "FIN-001" },
  { department: "Human Resources", department_code: "HR-002" },
];

const resolvesPublic = async () => ["93.184.216.34"];

const adapterWith = (
  fetchImpl: typeof fetch,
  credential: string | null = null,
): ApiValueSetAdapter =>
  new ApiValueSetAdapter({
    fetchImpl,
    readCredential: async () => ok(credential),
    guardOptions: { resolveHost: resolvesPublic },
  });

describe("ApiValueSetAdapter", () => {
  it("reads a top-level JSON array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.data).toEqual(departments);
  });

  it("reads an array nested under a dotted records path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result: { items: departments } }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments", recordsPath: "result.items" },
    });

    expect(result.data).toHaveLength(2);
  });

  it("stringifies non-string record values so every field is selectable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ department: "Finance", headcount: 42, active: true }]));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.data?.[0]).toEqual({
      department: "Finance",
      headcount: "42",
      active: "true",
    });
  });

  it("passes the search term on the configured query parameter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments", searchParam: "q" },
      query: "fin",
    });

    const [requestUrl] = fetchImpl.mock.calls[0]!;
    expect(String(requestUrl)).toBe("https://directory.example.gov/departments?q=fin");
  });

  it("omits the search parameter when the source declares none", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
      query: "fin",
    });

    const [requestUrl] = fetchImpl.mock.calls[0]!;
    expect(String(requestUrl)).toBe("https://directory.example.gov/departments");
  });

  it("sends the stored credential as the Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    await adapterWith(fetchImpl as unknown as typeof fetch, "Bearer secret-token").fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
      credentialRef: "lookup_departments_token",
    });

    const [, requestInit] = fetchImpl.mock.calls[0]!;
    expect((requestInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
  });

  it("sends no Authorization header when the source has no credential", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    const [, requestInit] = fetchImpl.mock.calls[0]!;
    expect((requestInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("refuses a URL that points inside the network, without calling fetch", async () => {
    const fetchImpl = vi.fn();

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://10.0.0.5/departments" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a plain HTTP URL", async () => {
    const fetchImpl = vi.fn();

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "http://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a verb other than GET or POST", async () => {
    const fetchImpl = vi.fn();

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: {
        url: "https://directory.example.gov/departments",
        method: "DELETE" as unknown as "GET",
      },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an error status rather than treating it as an empty set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: "nope" }, { status: 403 }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("403");
  });

  it("reports a body that is not a list of records", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ department: "Finance" }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("list of records");
  });

  it("reports a body that is not JSON at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>nope</html>", { status: 200 }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a response larger than the size cap", async () => {
    const oversized = "x".repeat(API_RESPONSE_BYTE_CAP + 1);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ department: oversized }])));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.error?.message).toContain("too large");
  });

  it("caps the number of records at the configured page limit", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ department: `D${index}` }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(many));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments", pageLimit: 4 },
    });

    expect(result.data).toHaveLength(4);
  });

  it("applies the caller's limit when it is tighter than the page limit", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ department: `D${index}` }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(many));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
      limit: 3,
    });

    expect(result.data).toHaveLength(3);
  });

  it("aborts a request that outruns the timeout", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const adapter = new ApiValueSetAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readCredential: async () => ok(null),
      guardOptions: { resolveHost: resolvesPublic },
      timeoutMs: 5,
    });

    const result = await adapter.fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("reports a credential that cannot be read rather than calling out without it", async () => {
    const fetchImpl = vi.fn();
    const adapter = new ApiValueSetAdapter({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readCredential: async () => ({
        error: { code: "NOT_FOUND" as const, message: "no such secret" },
      }),
      guardOptions: { resolveHost: resolvesPublic },
    });

    const result = await adapter.fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
      credentialRef: "lookup_missing",
    });

    expect(result.error).toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
