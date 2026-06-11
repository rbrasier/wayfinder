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
