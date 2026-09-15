import { describe, expect, it, vi } from "vitest";
import { ApiValueSetAdapter, API_MAX_PAGES, API_RESPONSE_BYTE_CAP } from "./api-value-set-provider";

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

const adapterWith = (fetchImpl: typeof fetch): ApiValueSetAdapter =>
  new ApiValueSetAdapter({ fetchImpl, guardOptions: { resolveHost: resolvesPublic } });

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

  it("sends the credential it was given as the Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
      credential: "Bearer secret-token",
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
      guardOptions: { resolveHost: resolvesPublic },
      timeoutMs: 5,
    });

    const result = await adapter.fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("never reads a credential itself — it uses only what the caller passed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));
    process.env.LOOKUP_CRED_SHOULD_NOT_BE_READ = "Bearer leaked";

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    const [, requestInit] = fetchImpl.mock.calls[0]!;
    expect(JSON.stringify(requestInit.headers)).not.toContain("leaked");
    delete process.env.LOOKUP_CRED_SHOULD_NOT_BE_READ;
  });
});

describe("ApiValueSetAdapter.discoverCollections", () => {
  it("reports every list in the response, ignoring the configured records path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ result: { items: departments }, meta: [{ page: 1 }] }),
    );

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).discoverCollections({
      config: { url: "https://directory.example.gov/departments", recordsPath: "ignored" },
    });

    expect(result.data?.map((collection) => collection.path)).toEqual(["result.items", "meta"]);
    expect(result.data?.[0]?.fields).toEqual(["department", "department_code"]);
    expect(result.data?.[0]?.count).toBe(2);
  });

  it("reports the response itself when it is the list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(departments));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).discoverCollections({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.data?.[0]?.path).toBe("");
  });

  it("returns nothing when the response holds no lists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ department: "Finance" }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).discoverCollections({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.data).toEqual([]);
  });

  it("still refuses an internal address", async () => {
    const fetchImpl = vi.fn();

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).discoverCollections({
      config: { url: "https://10.0.0.5/departments" },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ApiValueSetAdapter.filtersAtSource", () => {
  const adapter = new ApiValueSetAdapter({});

  it("is true only when the source was given a search parameter to use", () => {
    expect(adapter.filtersAtSource({ url: "https://x.example.gov", searchParam: "q" })).toBe(true);
  });

  it("is false without one, so the caller knows it has to filter itself", () => {
    expect(adapter.filtersAtSource({ url: "https://x.example.gov" })).toBe(false);
  });
});

describe("ApiValueSetAdapter pagination", () => {
  const page = (from: number, size: number) =>
    Array.from({ length: size }, (_, index) => ({ department: `D${from + index}` }));

  const pagedConfig = {
    url: "https://directory.example.gov/departments",
    paging: { style: "offset" as const, param: "offset", sizeParam: "limit", size: 2 },
  };

  it("walks offset pages until a short page ends the set", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page(0, 2)))
      .mockResolvedValueOnce(jsonResponse(page(2, 2)))
      .mockResolvedValueOnce(jsonResponse(page(4, 1)));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: pagedConfig,
    });

    expect(result.data).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("offset=2");
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("limit=2");
  });

  it("counts pages rather than records for a page-numbered source", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page(0, 2)))
      .mockResolvedValueOnce(jsonResponse(page(2, 1)));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: {
        url: "https://directory.example.gov/departments",
        paging: { style: "page", param: "page", size: 2 },
      },
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain("page=1");
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("page=2");
  });

  it("honours a source that numbers its pages from zero", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page(0, 1)));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: {
        url: "https://directory.example.gov/departments",
        paging: { style: "page", param: "page", size: 2, startPage: 0 },
      },
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain("page=0");
  });

  it("follows a cursor the previous response carried", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: page(0, 2), next: "abc" }))
      .mockResolvedValueOnce(jsonResponse({ items: page(2, 2) }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: {
        url: "https://directory.example.gov/departments",
        recordsPath: "items",
        paging: { style: "cursor", param: "cursor", cursorPath: "next", size: 2 },
      },
    });

    expect(result.data).toHaveLength(4);
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain("cursor=");
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("cursor=abc");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops at the configured record ceiling", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(page(0, 2)));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { ...pagedConfig, maxRecords: 3 },
    });

    expect(result.data).toHaveLength(3);
  });

  it("stops at the page ceiling when a source ignores its paging parameters", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(page(0, 2)));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: pagedConfig,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(API_MAX_PAGES);
    expect(result.data).toHaveLength(API_MAX_PAGES * 2);
  });

  it("fetches a single page when the source is doing the searching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page(0, 2)));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { ...pagedConfig, searchParam: "q" },
      query: "fin",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("discards the walk when a page fails, rather than returning a partial set", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page(0, 2)))
      .mockResolvedValueOnce(jsonResponse({ message: "nope" }, { status: 500 }));

    const result = await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: pagedConfig,
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.data).toBeUndefined();
  });

  it("makes one request when the source declares no paging at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page(0, 2)));

    await adapterWith(fetchImpl as unknown as typeof fetch).fetchRecords({
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
