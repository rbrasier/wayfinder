import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type { IPeopleDirectory, PeopleSearchInput, Person } from "@rbrasier/domain";
import { DirectoryValueSetAdapter, DIRECTORY_LIST_LIMIT } from "./directory-value-set-provider";

const person = (overrides: Partial<Person> = {}): Person => ({
  source: "hr",
  directoryId: "row-1",
  userId: null,
  displayName: "Ada Lovelace",
  email: "ada@example.gov",
  jobTitle: "Analyst",
  department: "Finance",
  ...overrides,
});

const directoryServing = (people: Person[]): IPeopleDirectory & { calls: PeopleSearchInput[] } => {
  const calls: PeopleSearchInput[] = [];
  return {
    calls,
    search: vi.fn(async (input: PeopleSearchInput) => {
      calls.push(input);
      return ok(people);
    }),
  };
};

describe("DirectoryValueSetAdapter", () => {
  it("exposes each person's fields so an admin can choose display and key", async () => {
    const directory = directoryServing([person()]);

    const result = await new DirectoryValueSetAdapter(directory).fetchRecords({ config: {} });

    expect(result.data?.[0]).toEqual({
      displayName: "Ada Lovelace",
      email: "ada@example.gov",
      jobTitle: "Analyst",
      department: "Finance",
      directoryId: "row-1",
      source: "hr",
    });
  });

  it("omits fields the directory has no value for", async () => {
    const directory = directoryServing([person({ jobTitle: null, department: null })]);

    const result = await new DirectoryValueSetAdapter(directory).fetchRecords({ config: {} });

    expect(result.data?.[0]).not.toHaveProperty("jobTitle");
    expect(result.data?.[0]).not.toHaveProperty("department");
  });

  it("passes a type-ahead term straight to the directory", async () => {
    const directory = directoryServing([person()]);

    await new DirectoryValueSetAdapter(directory).fetchRecords({
      config: {},
      query: "ada",
      limit: 5,
    });

    expect(directory.calls[0]).toEqual({ query: "ada", limit: 5 });
  });

  it("seeds a listing with the configured query and the list limit", async () => {
    const directory = directoryServing([person()]);

    await new DirectoryValueSetAdapter(directory).fetchRecords({ config: { query: "finance" } });

    expect(directory.calls[0]).toEqual({ query: "finance", limit: DIRECTORY_LIST_LIMIT });
  });

  it("surfaces a directory failure rather than an empty set", async () => {
    const directory: IPeopleDirectory = {
      search: vi.fn(async () => ({
        error: { code: "INFRA_FAILURE" as const, message: "Entra unavailable" },
      })),
    };

    const result = await new DirectoryValueSetAdapter(directory).fetchRecords({ config: {} });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("DirectoryValueSetAdapter — federation", () => {
  it("merges several directories, keeping the first entry for a shared email", async () => {
    const accounts = directoryServing([person({ source: "user", displayName: "Ada (account)" })]);
    const entra = directoryServing([person({ source: "entra", displayName: "Ada (Entra)" })]);

    const result = await new DirectoryValueSetAdapter(accounts, entra).fetchRecords({ config: {} });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.displayName).toBe("Ada (account)");
  });

  it("keeps distinct people from different directories", async () => {
    const accounts = directoryServing([person()]);
    const hr = directoryServing([
      person({ source: "hr", email: "grace@example.gov", displayName: "Grace Hopper" }),
    ]);

    const result = await new DirectoryValueSetAdapter(accounts, hr).fetchRecords({ config: {} });

    expect(result.data).toHaveLength(2);
  });

  it("skips a directory that fails and serves the rest", async () => {
    const failing: IPeopleDirectory = {
      search: vi.fn(async () => ({
        error: { code: "INFRA_FAILURE" as const, message: "Entra unavailable" },
      })),
    };
    const accounts = directoryServing([person()]);

    const result = await new DirectoryValueSetAdapter(failing, accounts).fetchRecords({
      config: {},
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
  });

  it("reports the failure when every directory fails", async () => {
    const failing: IPeopleDirectory = {
      search: vi.fn(async () => ({
        error: { code: "INFRA_FAILURE" as const, message: "Entra unavailable" },
      })),
    };

    const result = await new DirectoryValueSetAdapter(failing).fetchRecords({ config: {} });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
