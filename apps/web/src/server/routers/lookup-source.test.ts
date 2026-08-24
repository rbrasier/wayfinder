import { describe, expect, it, vi } from "vitest";
import type { PermissionKey } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { lookupSourceRouter } from "./lookup-source";

const testRouter = router({ lookupSource: lookupSourceRouter });
const createCaller = createCallerFactory(testRouter);

const registeredSource = {
  id: "source-1",
  name: "departments",
  label: "Departments",
  kind: "api" as const,
  config: { url: "https://directory.example.gov/departments" },
  displayField: "department",
  keyField: "department_code",
  credentialSet: true,
  cacheTtlSeconds: 3600,
  enabled: true,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const spies = () => ({
  listLookupSources: { execute: vi.fn(async () => ({ data: [registeredSource] })) },
  registerLookupSource: { execute: vi.fn(async () => ({ data: registeredSource })) },
  updateLookupSource: { execute: vi.fn(async () => ({ data: registeredSource })) },
  deleteLookupSource: { execute: vi.fn(async () => ({ data: undefined })) },
  testLookupSource: {
    execute: vi.fn(async () => ({
      data: {
        collections: [
          {
            path: "result.items",
            count: 2,
            fields: ["department", "department_code"],
            sample: [{ department: "Finance", department_code: "FIN-001" }],
          },
        ],
        fields: ["department", "department_code"],
        sample: [{ department: "Finance", department_code: "FIN-001" }],
        preview: [{ display: "Finance", key: "FIN-001" }],
      },
    })),
  },
});

const searchSpy = vi.fn(async () => ({ data: [{ display: "Finance", key: "FIN-001" }] }));

const matchSpy = vi.fn(async () => ({
  data: {
    matches: [
      {
        input: "procurement",
        outcome: {
          kind: "candidates" as const,
          candidates: [
            { entry: { display: "Finance", key: "FIN-001" }, score: 0.78, tier: "semantic" as const },
          ],
        },
      },
    ],
    stale: false,
    version: "v-1",
    fetchedAt: new Date("2026-08-01T00:00:00.000Z"),
  },
}));

const containerWith = (useCases: ReturnType<typeof spies>): Container =>
  ({
    useCases,
    repos: { lookupSources: { readCredential: async () => ({ data: "Bearer stored" }) } },
    services: {
      valueSetProvider: { search: searchSpy, match: matchSpy },
      errorLogger: { log: async () => undefined },
    },
  }) as unknown as Container;

const contextFor = (
  useCases: ReturnType<typeof spies>,
  overrides: Partial<TrpcContext> = {},
): TrpcContext => ({
  container: containerWith(useCases),
  userId: "dana",
  isAdmin: true,
  permissions: new Set<PermissionKey>(),
  headers: new Headers(),
  ...overrides,
});

const draft = {
  name: "departments",
  label: "Departments",
  kind: "api" as const,
  config: { url: "https://directory.example.gov/departments" },
  displayField: "department",
  keyField: "department_code",
  cacheTtlSeconds: 3600,
  enabled: true,
};

describe("lookup source router — admin operations", () => {
  it("lists registered sources", async () => {
    const caller = createCaller(contextFor(spies()));

    await expect(caller.lookupSource.list()).resolves.toHaveLength(1);
  });

  it("reports that a credential is stored without ever returning it", async () => {
    const caller = createCaller(contextFor(spies()));

    const [source] = await caller.lookupSource.list();

    expect(source?.credentialSet).toBe(true);
    expect(JSON.stringify(source)).not.toContain("Bearer");
    expect(JSON.stringify(source)).not.toContain("secret");
  });

  it("creates a source", async () => {
    const useCases = spies();
    const caller = createCaller(contextFor(useCases));

    await caller.lookupSource.create(draft);

    expect(useCases.registerLookupSource.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "departments", displayField: "department" }),
    );
  });

  it("updates a source by id", async () => {
    const useCases = spies();
    const caller = createCaller(contextFor(useCases));

    await caller.lookupSource.update({ id: "source-1", source: draft });

    expect(useCases.updateLookupSource.execute).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ name: "departments" }),
    );
  });

  it("deletes a source", async () => {
    const useCases = spies();
    const caller = createCaller(contextFor(useCases));

    await expect(caller.lookupSource.delete({ id: "source-1" })).resolves.toEqual({
      deleted: true,
    });
  });

  it("tests a draft and returns its fields, sample and preview", async () => {
    const useCases = spies();
    const caller = createCaller(contextFor(useCases));

    const result = await caller.lookupSource.test({
      kind: "api",
      config: { url: "https://directory.example.gov/departments" },
      displayField: "department",
      keyField: "department_code",
    });

    expect(result.fields).toEqual(["department", "department_code"]);
    expect(result.preview).toEqual([{ display: "Finance", key: "FIN-001" }]);
  });

  it("defaults the cache TTL when the editor omits it", async () => {
    const useCases = spies();
    const caller = createCaller(contextFor(useCases));

    await caller.lookupSource.create({
      name: "teams",
      label: "Teams",
      kind: "managed",
      displayField: "display",
    });

    expect(useCases.registerLookupSource.execute).toHaveBeenCalledWith(
      expect.objectContaining({ cacheTtlSeconds: 3600, enabled: true }),
    );
  });

  it("surfaces a use-case failure as a tRPC error", async () => {
    const useCases = spies();
    useCases.registerLookupSource.execute = vi.fn(async () => ({
      error: { code: "ALREADY_EXISTS" as const, message: "taken" },
    })) as unknown as typeof useCases.registerLookupSource.execute;
    const caller = createCaller(contextFor(useCases));

    await expect(caller.lookupSource.create(draft)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("lookup source router — authorization", () => {
  it("refuses a non-admin listing sources", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(caller.lookupSource.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a non-admin creating a source", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(caller.lookupSource.create(draft)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a non-admin testing a source, which would reach the network", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.test({ kind: "api", config: { url: "https://example.gov" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a non-admin operator search a source, which they must to fill a field", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.search({ sourceName: "departments", query: "fin" }),
    ).resolves.toEqual([{ display: "Finance", key: "FIN-001" }]);
  });

  it("caps how many results one search may pull", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.search({ sourceName: "departments", query: "fin", limit: 500 }),
    ).rejects.toBeDefined();
  });
});

describe("lookup source router — match", () => {
  it("lets a non-admin operator narrow a value, which they must to answer a block", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    const result = await caller.lookupSource.match({
      sourceName: "departments",
      values: ["procurement"],
    });

    expect(result.matches[0]?.outcome.kind).toBe("candidates");
  });

  it("refuses an unbounded batch of values", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.match({
        sourceName: "departments",
        values: Array.from({ length: 11 }, (_, index) => `value-${index}`),
      }),
    ).rejects.toBeDefined();
  });

  it("refuses an empty batch rather than walking the whole set for nothing", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.match({ sourceName: "departments", values: [] }),
    ).rejects.toBeDefined();
  });

  it("caps how many candidates one value may return", async () => {
    const caller = createCaller(contextFor(spies(), { isAdmin: false }));

    await expect(
      caller.lookupSource.match({ sourceName: "departments", values: ["x"], limit: 50 }),
    ).rejects.toBeDefined();
  });
});
