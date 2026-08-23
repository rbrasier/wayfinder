import { describe, it, expect } from "vitest";
import {
  ok,
  type HrColumnMapping,
  type HrDataset,
  type HrRow,
  type HrRowSearchInput,
  type IHrDatasetRepository,
  type IUserRepository,
  type NewHrDataset,
  type NewHrRow,
  type Result,
  type User,
} from "@rbrasier/domain";
import { GraphClient } from "./graph-client";
import { GraphPeopleDirectory } from "./graph-people-directory";
import { HrPeopleDirectory } from "./hr-people-directory";
import { GraphReportingLineResolver } from "./graph-reporting-line-resolver";
import { UserPeopleDirectory } from "./user-people-directory";
import { escapeLikePattern } from "../repositories/drizzle-user-repository";

class FakeHrRepository implements IHrDatasetRepository {
  datasets: HrDataset[] = [];
  rows: HrRow[] = [];

  seedDataset(id: string, mapping: HrColumnMapping): void {
    this.datasets.push({
      id,
      filename: `${id}.csv`,
      sourceFormat: "csv",
      uploadedByUserId: "admin",
      columns: Object.keys(mapping),
      columnMapping: mapping,
      rowCount: 0,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  seedRow(datasetId: string, data: Record<string, string>): void {
    this.rows.push({
      id: `row-${this.rows.length + 1}`,
      datasetId,
      rowIndex: this.rows.length,
      data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async createDataset(_input: NewHrDataset): Promise<Result<HrDataset>> {
    throw new Error("unused");
  }
  async findDatasetById(id: string): Promise<Result<HrDataset | null>> {
    return ok(this.datasets.find((dataset) => dataset.id === id) ?? null);
  }
  async listDatasets(): Promise<Result<HrDataset[]>> {
    return ok(this.datasets);
  }
  async setColumnMapping(_id: string, _mapping: HrColumnMapping): Promise<Result<HrDataset>> {
    throw new Error("unused");
  }
  async insertRows(_rows: NewHrRow[]): Promise<Result<number>> {
    throw new Error("unused");
  }
  async listRows(datasetId: string): Promise<Result<HrRow[]>> {
    return ok(this.rows.filter((row) => row.datasetId === datasetId));
  }
  async searchRows(input: HrRowSearchInput): Promise<Result<HrRow[]>> {
    const needle = input.query.toLowerCase();
    return ok(
      this.rows
        .filter((row) => Object.values(row.data).some((value) => value.toLowerCase().includes(needle)))
        .slice(0, input.limit),
    );
  }
}

class FakeUsers implements IUserRepository {
  byEmail = new Map<string, User>();
  byId = new Map<string, User>();
  seed(user: User): void {
    this.byEmail.set(user.email.toLowerCase(), user);
    this.byId.set(user.id, user);
  }
  async create(): Promise<Result<User>> {
    throw new Error("unused");
  }
  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.byId.get(id) ?? null);
  }
  async findByEmail(email: string): Promise<Result<User | null>> {
    return ok(this.byEmail.get(email.toLowerCase()) ?? null);
  }
  async list(): Promise<Result<User[]>> {
    return ok([...this.byId.values()]);
  }
  async search(input: { query: string; limit: number }): Promise<Result<User[]>> {
    const term = input.query.trim().toLowerCase();
    if (term.length === 0) return ok([]);
    const matches = [...this.byId.values()].filter(
      (row) =>
        row.email.toLowerCase().includes(term) || (row.name ?? "").toLowerCase().includes(term),
    );
    return ok(matches.slice(0, input.limit));
  }
  async update(): Promise<Result<User>> {
    throw new Error("unused");
  }
  async delete(): Promise<Result<true>> {
    return ok(true as const);
  }
}

const user = (id: string, email: string): User => ({
  id,
  email,
  name: id,
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("HrPeopleDirectory", () => {
  it("maps HR rows to people through the dataset's column mapping", async () => {
    const repository = new FakeHrRepository();
    repository.seedDataset("ds-1", { "Full Name": "name", Email: "email", Title: "position" });
    repository.seedRow("ds-1", { "Full Name": "Ada", Email: "ada@corp.test", Title: "Director" });
    const directory = new HrPeopleDirectory(repository);

    const result = await directory.search({ query: "ada", limit: 10 });

    expect(result.data).toEqual([
      {
        source: "hr",
        directoryId: "row-1",
        userId: null,
        displayName: "Ada",
        email: "ada@corp.test",
        jobTitle: "Director",
        department: null,
      },
    ]);
  });

  it("skips rows with no mapped email", async () => {
    const repository = new FakeHrRepository();
    repository.seedDataset("ds-1", { "Full Name": "name" });
    repository.seedRow("ds-1", { "Full Name": "Ada" });
    const directory = new HrPeopleDirectory(repository);

    const result = await directory.search({ query: "ada", limit: 10 });

    expect(result.data).toEqual([]);
  });
});

describe("GraphClient host overrides", () => {
  const recordingFetch = () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.includes("/oauth2/")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    return { urls, fetchImpl };
  };

  it("targets the real Microsoft hosts when no override is configured", async () => {
    const { urls, fetchImpl } = recordingFetch();
    const graph = new GraphClient({ tenantId: "t", clientId: "c", clientSecret: "s" }, fetchImpl);

    await graph.get("/users");

    expect(urls[0]).toBe("https://login.microsoftonline.com/t/oauth2/v2.0/token");
    expect(urls[1]).toBe("https://graph.microsoft.com/v1.0/users");
  });

  it("targets the configured authority and base URL when both are set", async () => {
    const { urls, fetchImpl } = recordingFetch();
    const graph = new GraphClient(
      {
        tenantId: "mock-tenant",
        clientId: "c",
        clientSecret: "s",
        authority: "http://localhost:4001/entra",
        baseUrl: "http://localhost:4001/graph/v1.0",
      },
      fetchImpl,
    );

    await graph.get("/users", { $top: "5" });

    expect(urls[0]).toBe("http://localhost:4001/entra/mock-tenant/oauth2/v2.0/token");
    expect(urls[1]).toBe("http://localhost:4001/graph/v1.0/users?%24top=5");
  });

  it("tolerates a trailing slash on either override", async () => {
    const { urls, fetchImpl } = recordingFetch();
    const graph = new GraphClient(
      {
        tenantId: "mock-tenant",
        clientId: "c",
        clientSecret: "s",
        authority: "http://localhost:4001/entra/",
        baseUrl: "http://localhost:4001/graph/v1.0/",
      },
      fetchImpl,
    );

    await graph.get("/users");

    expect(urls[0]).toBe("http://localhost:4001/entra/mock-tenant/oauth2/v2.0/token");
    expect(urls[1]).toBe("http://localhost:4001/graph/v1.0/users");
  });

  it("overrides one host without moving the other", async () => {
    const { urls, fetchImpl } = recordingFetch();
    const graph = new GraphClient(
      {
        tenantId: "t",
        clientId: "c",
        clientSecret: "s",
        baseUrl: "http://localhost:4001/graph/v1.0",
      },
      fetchImpl,
    );

    await graph.get("/users");

    expect(urls[0]).toBe("https://login.microsoftonline.com/t/oauth2/v2.0/token");
    expect(urls[1]).toBe("http://localhost:4001/graph/v1.0/users");
  });
});

describe("GraphClient credential resolution", () => {
  const recordingFetch = () => {
    const tokenBodies: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.includes("/oauth2/")) {
        tokenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    return { tokenBodies, fetchImpl };
  };

  it("reports itself unconfigured while the resolver returns nothing", async () => {
    const graph = new GraphClient(async () => null);

    expect(await graph.isConfigured()).toBe(false);
  });

  it("makes no request while the resolver returns nothing", async () => {
    const { tokenBodies, fetchImpl } = recordingFetch();
    const graph = new GraphClient(async () => null, fetchImpl);

    const result = await graph.get("/users");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(tokenBodies).toEqual([]);
  });

  it("becomes configured once the resolver returns credentials, with no restart", async () => {
    let credentials: { tenantId: string; clientId: string; clientSecret: string } | null = null;
    const graph = new GraphClient(async () => credentials);

    expect(await graph.isConfigured()).toBe(false);
    credentials = { tenantId: "t", clientId: "c", clientSecret: "s" };

    expect(await graph.isConfigured()).toBe(true);
  });

  it("reuses the cached token while the credentials are unchanged", async () => {
    const { tokenBodies, fetchImpl } = recordingFetch();
    const graph = new GraphClient(
      async () => ({ tenantId: "t", clientId: "c", clientSecret: "s" }),
      fetchImpl,
    );

    await graph.get("/users");
    await graph.get("/users");

    expect(tokenBodies).toHaveLength(1);
  });

  it("drops the cached token when the client secret is rotated", async () => {
    const { tokenBodies, fetchImpl } = recordingFetch();
    let clientSecret = "first-secret";
    const graph = new GraphClient(
      async () => ({ tenantId: "t", clientId: "c", clientSecret }),
      fetchImpl,
    );

    await graph.get("/users");
    clientSecret = "rotated-secret";
    await graph.get("/users");

    expect(tokenBodies).toHaveLength(2);
    expect(tokenBodies[1]).toContain("rotated-secret");
  });

  it("drops the cached token when the tenant changes", async () => {
    const { tokenBodies, fetchImpl } = recordingFetch();
    let tenantId = "first-tenant";
    const graph = new GraphClient(
      async () => ({ tenantId, clientId: "c", clientSecret: "s" }),
      fetchImpl,
    );

    await graph.get("/users");
    tenantId = "second-tenant";
    await graph.get("/users");

    expect(tokenBodies).toHaveLength(2);
  });
});

describe("GraphPeopleDirectory", () => {
  it("returns no results when Graph is not configured", async () => {
    const directory = new GraphPeopleDirectory(new GraphClient(null));
    const result = await directory.search({ query: "ada", limit: 10 });
    expect(result.data).toEqual([]);
  });

  it("maps Graph users to people", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/oauth2/")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          value: [
            {
              id: "entra-1",
              displayName: "Ada Lovelace",
              mail: "ada@corp.test",
              jobTitle: "Director",
              department: "Policy",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const graph = new GraphClient(
      { tenantId: "t", clientId: "c", clientSecret: "s" },
      fetchImpl,
    );
    const directory = new GraphPeopleDirectory(graph);

    const result = await directory.search({ query: "ada", limit: 10 });

    expect(result.data).toEqual([
      {
        source: "entra",
        directoryId: "entra-1",
        userId: null,
        displayName: "Ada Lovelace",
        email: "ada@corp.test",
        jobTitle: "Director",
        department: "Policy",
      },
    ]);
  });
});

describe("GraphReportingLineResolver (HR fallback)", () => {
  const buildResolver = () => {
    const repository = new FakeHrRepository();
    repository.seedDataset("ds-1", { Email: "email", Manager: "manager", Title: "position" });
    repository.seedRow("ds-1", {
      Email: "operator@corp.test",
      Manager: "manager@corp.test",
      Title: "Officer",
    });
    repository.seedRow("ds-1", {
      Email: "manager@corp.test",
      Manager: "director@corp.test",
      Title: "Manager",
    });
    const users = new FakeUsers();
    users.seed(user("operator-1", "operator@corp.test"));
    users.seed(user("manager-1", "manager@corp.test"));
    users.seed(user("director-1", "director@corp.test"));
    const resolver = new GraphReportingLineResolver(new GraphClient(null), repository, users);
    return { resolver, users };
  };

  it("suggests the first-level manager from the mapped manager column", async () => {
    const { resolver } = buildResolver();
    const result = await resolver.suggest({ level: 1, userId: "operator-1" });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ suggestedApproverUserId: "manager-1" });
  });

  it("walks two hops for the second-level supervisor", async () => {
    const { resolver } = buildResolver();
    const result = await resolver.suggest({ level: 2, userId: "operator-1" });
    expect(result.data).toEqual({ suggestedApproverUserId: "director-1" });
  });

  it("is unresolved when the manager has no account", async () => {
    const repository = new FakeHrRepository();
    repository.seedDataset("ds-1", { Email: "email", Manager: "manager" });
    repository.seedRow("ds-1", { Email: "operator@corp.test", Manager: "ghost@corp.test" });
    const users = new FakeUsers();
    users.seed(user("operator-1", "operator@corp.test"));
    const resolver = new GraphReportingLineResolver(new GraphClient(null), repository, users);

    const result = await resolver.suggest({ level: 1, userId: "operator-1" });

    expect(result.data).toEqual({ unresolved: true });
  });

  it("finds a position holder by mapped role", async () => {
    const repository = new FakeHrRepository();
    repository.seedDataset("ds-1", { Email: "email", Title: "position", Name: "name" });
    repository.seedRow("ds-1", { Email: "del@corp.test", Title: "SES Band 1 Delegate", Name: "Del" });
    const users = new FakeUsers();
    users.seed(user("del-1", "del@corp.test"));
    const resolver = new GraphReportingLineResolver(new GraphClient(null), repository, users);

    const result = await resolver.findPositionHolder({ role: "SES Band 1" });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({ userId: "del-1", email: "del@corp.test" });
  });
});

describe("UserPeopleDirectory", () => {
  const seeded = () => {
    const users = new FakeUsers();
    users.seed({ ...user("ada-1", "ada@corp.test"), name: "Ada Lovelace" } as User);
    users.seed({ ...user("ben-1", "ben@corp.test"), name: "Ben Barnes" } as User);
    return users;
  };

  it("finds an existing account by name", async () => {
    // The gap being closed: a colleague who already has a Wayfinder account but
    // appears in neither Entra nor the HR upload could not be found at all.
    const result = await new UserPeopleDirectory(seeded()).search({ query: "Lovelace", limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      source: "user",
      userId: "ada-1",
      email: "ada@corp.test",
      displayName: "Ada Lovelace",
    });
  });

  it("finds an existing account by email", async () => {
    const result = await new UserPeopleDirectory(seeded()).search({ query: "ben@", limit: 10 });

    expect(result.data?.map((person) => person.userId)).toEqual(["ben-1"]);
  });

  it("carries the account id, so the approval is routed to a user rather than an address", async () => {
    const result = await new UserPeopleDirectory(seeded()).search({ query: "ada", limit: 10 });

    expect(result.data?.[0]?.userId).toBe("ada-1");
    expect(result.data?.[0]?.directoryId).toBeNull();
  });

  it("returns nothing for a blank query rather than the whole user table", async () => {
    const result = await new UserPeopleDirectory(seeded()).search({ query: "  ", limit: 10 });

    expect(result.data).toEqual([]);
  });
});

describe("escapeLikePattern", () => {
  it("neutralises LIKE wildcards so a search narrows rather than widens", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves an ordinary name untouched", () => {
    expect(escapeLikePattern("Ada Lovelace")).toBe("Ada Lovelace");
  });
});
