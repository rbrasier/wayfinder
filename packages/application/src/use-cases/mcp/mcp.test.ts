import { domainError, err, ok } from "@wayfinder/domain";
import type {
  CachedMcpTool,
  IMcpClient,
  IMcpServerRepository,
  IMcpServerSecretStore,
  IMcpToolRepository,
  ListMcpServersInput,
  McpServer,
  McpServerSecrets,
  McpServerSecretsPatch,
  McpServerStatus,
  McpServerUpdate,
  McpTool,
  McpToolCallOutput,
  McpToolSettings,
  NewMcpServer,
  Result,
} from "@wayfinder/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DeleteMcpServer,
  DisableMcpServer,
  EnableMcpServer,
  ListMcpServers,
  ListMcpTools,
  RefreshMcpTools,
  RegisterMcpServer,
  ResolveStepTools,
  TestMcpServer,
  UpdateMcpServer,
  UpdateMcpToolSettings,
} from "./mcp";

class InMemoryMcpServerRepository implements IMcpServerRepository {
  rows: McpServer[] = [];
  private sequence = 0;

  async create(input: NewMcpServer): Promise<Result<McpServer>> {
    this.sequence += 1;
    const now = new Date();
    const server: McpServer = {
      id: `mcp-${this.sequence}`,
      label: input.label,
      transport: input.transport ?? "sse",
      url: input.url,
      dataClassification: input.dataClassification ?? "internal",
      verbatimOnly: input.verbatimOnly ?? false,
      callTimeoutMs: input.callTimeoutMs ?? 30_000,
      hasCredential: false,
      customHeaderNames: [],
      status: "active",
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(server);
    return ok(server);
  }

  async update(id: string, patch: McpServerUpdate): Promise<Result<McpServer>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    const current = this.rows[index]!;
    const updated: McpServer = {
      ...current,
      label: patch.label ?? current.label,
      url: patch.url ?? current.url,
      dataClassification: patch.dataClassification ?? current.dataClassification,
      verbatimOnly: patch.verbatimOnly ?? current.verbatimOnly,
      callTimeoutMs: patch.callTimeoutMs ?? current.callTimeoutMs,
    };
    this.rows[index] = updated;
    return ok(updated);
  }

  async findById(id: string): Promise<Result<McpServer | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }

  async list(input?: ListMcpServersInput): Promise<Result<McpServer[]>> {
    return ok(
      input?.includeDisabled ? this.rows : this.rows.filter((row) => row.status === "active"),
    );
  }

  async setStatus(id: string, status: McpServerStatus): Promise<Result<McpServer>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    this.rows[index] = { ...this.rows[index]!, status };
    return ok(this.rows[index]!);
  }

  async delete(id: string): Promise<Result<void>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    this.rows.splice(index, 1);
    return ok(undefined);
  }
}

// Mirrors the adapter: secrets live apart from the server row, and the row only
// reports whether they exist.
class InMemorySecretStore implements IMcpServerSecretStore {
  secrets = new Map<string, McpServerSecrets>();

  constructor(private readonly servers: InMemoryMcpServerRepository) {}

  async get(serverId: string): Promise<Result<McpServerSecrets>> {
    return ok(this.secrets.get(serverId) ?? { bearerToken: null, headers: {} });
  }

  async set(serverId: string, patch: McpServerSecretsPatch): Promise<Result<void>> {
    const current = this.secrets.get(serverId) ?? { bearerToken: null, headers: {} };
    const next: McpServerSecrets = {
      bearerToken: patch.bearerToken === undefined ? current.bearerToken : patch.bearerToken,
      headers: patch.headers === undefined ? current.headers : (patch.headers ?? {}),
    };
    this.secrets.set(serverId, next);
    const index = this.servers.rows.findIndex((row) => row.id === serverId);
    if (index !== -1) {
      this.servers.rows[index] = {
        ...this.servers.rows[index]!,
        hasCredential: next.bearerToken !== null,
        customHeaderNames: Object.keys(next.headers),
      };
    }
    return ok(undefined);
  }
}

const emptySettings: McpToolSettings = { pagination: null, status: null, citation: null };

class InMemoryToolRepository implements IMcpToolRepository {
  rows: CachedMcpTool[] = [];

  async listByServer(serverId: string): Promise<Result<CachedMcpTool[]>> {
    return ok(this.rows.filter((row) => row.serverId === serverId));
  }

  async replaceForServer(serverId: string, tools: McpTool[]): Promise<Result<CachedMcpTool[]>> {
    const previous = new Map(
      this.rows.filter((row) => row.serverId === serverId).map((row) => [row.name, row]),
    );
    const replaced = tools.map((tool) => {
      const kept = previous.get(tool.name);
      return {
        ...tool,
        serverId,
        lastSyncedAt: new Date(),
        pagination: kept?.pagination ?? null,
        status: kept?.status ?? null,
        citation: kept?.citation ?? null,
      };
    });
    this.rows = [...this.rows.filter((row) => row.serverId !== serverId), ...replaced];
    return ok(replaced);
  }

  async updateSettings(
    serverId: string,
    toolName: string,
    settings: McpToolSettings,
  ): Promise<Result<CachedMcpTool>> {
    const index = this.rows.findIndex((row) => row.serverId === serverId && row.name === toolName);
    if (index === -1) return err(domainError("NOT_FOUND", "Tool not found."));
    this.rows[index] = { ...this.rows[index]!, ...settings };
    return ok(this.rows[index]!);
  }
}

const stubTools: McpTool[] = [
  { name: "search", title: "Search", description: "Search the web", inputSchema: { type: "object" } },
  { name: "fetch", title: null, description: null, inputSchema: null },
];

const okClient: IMcpClient = {
  async listTools(): Promise<Result<McpTool[]>> {
    return ok(stubTools);
  },
  async callTool(): Promise<Result<McpToolCallOutput>> {
    return ok({
      output: "done",
      structuredContent: null,
      citations: [],
      pagesFetched: 1,
      truncatedAtPageLimit: false,
      sourceStatus: null,
    });
  },
};

const failingClient: IMcpClient = {
  async listTools(): Promise<Result<McpTool[]>> {
    return err(domainError("INFRA_FAILURE", "unreachable"));
  },
  async callTool(): Promise<Result<McpToolCallOutput>> {
    return err(domainError("INFRA_FAILURE", "unreachable"));
  },
};

describe("RegisterMcpServer", () => {
  let repository: InMemoryMcpServerRepository;
  let secrets: InMemorySecretStore;

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
    secrets = new InMemorySecretStore(repository);
  });

  it("creates a server with a trimmed label and url", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "  GitHub  ",
      url: "https://mcp.example.com/sse",
    });
    expect(result.data?.label).toBe("GitHub");
    expect(result.data?.status).toBe("active");
    expect(result.data?.dataClassification).toBe("internal");
  });

  it("rejects an empty label", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({ label: "  ", url: "https://x.y" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-http url", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "Bad",
      url: "ftp://nope",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("registers a public-data reader with its timeout", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "Legislation",
      url: "https://legislation.example/mcp",
      dataClassification: "public-read",
      callTimeoutMs: 45_000,
    });
    expect(result.data).toMatchObject({ dataClassification: "public-read", callTimeoutMs: 45_000 });
  });

  it("rejects a timeout outside the allowed range", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "Slow",
      url: "https://slow.example/mcp",
      callTimeoutMs: 500,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(repository.rows).toHaveLength(0);
  });

  it("stores the bearer token and headers apart from the server and reports only that they exist", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "Stats",
      url: "https://stats.example/mcp",
      bearerToken: "  token-1  ",
      customHeaders: { "X-Api-Key": "key-1" },
    });

    expect(result.data).toMatchObject({ hasCredential: true, customHeaderNames: ["X-Api-Key"] });
    expect(JSON.stringify(result.data)).not.toContain("token-1");
    expect(secrets.secrets.get(result.data!.id)).toEqual({
      bearerToken: "token-1",
      headers: { "X-Api-Key": "key-1" },
    });
  });

  it("rejects a reserved header before creating anything", async () => {
    const result = await new RegisterMcpServer(repository, secrets).execute({
      label: "Bad headers",
      url: "https://x.example/mcp",
      customHeaders: { "Mcp-Session-Id": "fixed" },
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(repository.rows).toHaveLength(0);
  });
});

describe("UpdateMcpServer", () => {
  let repository: InMemoryMcpServerRepository;
  let secrets: InMemorySecretStore;

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
    secrets = new InMemorySecretStore(repository);
  });

  const register = () =>
    new RegisterMcpServer(repository, secrets).execute({ label: "X", url: "https://x.y" });

  it("rejects an invalid url on update", async () => {
    const created = await register();
    const result = await new UpdateMcpServer(repository, secrets).execute({
      id: created.data!.id,
      url: "not-a-url",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reclassifies a server and changes its timeout", async () => {
    const created = await register();
    const result = await new UpdateMcpServer(repository, secrets).execute({
      id: created.data!.id,
      dataClassification: "public-read",
      callTimeoutMs: 60_000,
    });
    expect(result.data).toMatchObject({ dataClassification: "public-read", callTimeoutMs: 60_000 });
  });

  it("leaves secrets alone when they are not sent, and clears them on null", async () => {
    const created = await new RegisterMcpServer(repository, secrets).execute({
      label: "X",
      url: "https://x.y",
      bearerToken: "token-1",
    });
    const id = created.data!.id;

    await new UpdateMcpServer(repository, secrets).execute({ id, label: "Renamed" });
    expect(secrets.secrets.get(id)?.bearerToken).toBe("token-1");

    const cleared = await new UpdateMcpServer(repository, secrets).execute({ id, bearerToken: null });
    expect(cleared.data?.hasCredential).toBe(false);
  });

  it("refuses an Authorization header while the server keeps a bearer token", async () => {
    const created = await new RegisterMcpServer(repository, secrets).execute({
      label: "X",
      url: "https://x.y",
      bearerToken: "token-1",
    });
    const result = await new UpdateMcpServer(repository, secrets).execute({
      id: created.data!.id,
      customHeaders: { Authorization: "Basic abc" },
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new UpdateMcpServer(repository, secrets).execute({ id: "missing", label: "Y" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("Disable / Enable / List", () => {
  it("excludes disabled servers by default and includes them on request", async () => {
    const repository = new InMemoryMcpServerRepository();
    const register = new RegisterMcpServer(repository, new InMemorySecretStore(repository));
    const first = await register.execute({ label: "A", url: "https://a.example/sse" });
    await register.execute({ label: "B", url: "https://b.example/sse" });

    await new DisableMcpServer(repository).execute(first.data!.id);

    const active = await new ListMcpServers(repository).execute();
    expect(active.data).toHaveLength(1);

    const all = await new ListMcpServers(repository).execute({ includeDisabled: true });
    expect(all.data).toHaveLength(2);

    await new EnableMcpServer(repository).execute(first.data!.id);
    const reactivated = await new ListMcpServers(repository).execute();
    expect(reactivated.data).toHaveLength(2);
  });
});

describe("DeleteMcpServer", () => {
  it("permanently removes a server so it no longer lists", async () => {
    const repository = new InMemoryMcpServerRepository();
    const register = new RegisterMcpServer(repository, new InMemorySecretStore(repository));
    const first = await register.execute({ label: "A", url: "https://a.example/sse" });
    await register.execute({ label: "B", url: "https://b.example/sse" });

    const result = await new DeleteMcpServer(repository).execute(first.data!.id);
    expect(result.error).toBeUndefined();

    const remaining = await new ListMcpServers(repository).execute({ includeDisabled: true });
    expect(remaining.data).toHaveLength(1);
    expect(remaining.data![0]?.label).toBe("B");
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const repository = new InMemoryMcpServerRepository();
    const result = await new DeleteMcpServer(repository).execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("TestMcpServer", () => {
  let repository: InMemoryMcpServerRepository;
  let tools: InMemoryToolRepository;

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
    tools = new InMemoryToolRepository();
  });

  const register = () =>
    new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "X",
      url: "https://x.example/sse",
    });

  it("returns the discovered tools for a reachable server and caches them", async () => {
    const created = await register();
    const result = await new TestMcpServer(repository, okClient, tools).execute(created.data!.id);
    expect(result.data?.toolCount).toBe(2);
    expect(result.data?.tools[0]?.name).toBe("search");
    expect(tools.rows.map((row) => row.name)).toEqual(["search", "fetch"]);
  });

  it("propagates a client failure as an error and leaves the cache alone", async () => {
    const created = await register();
    const result = await new TestMcpServer(repository, failingClient, tools).execute(created.data!.id);
    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(tools.rows).toEqual([]);
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new TestMcpServer(repository, okClient, tools).execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("RefreshMcpTools / ListMcpTools", () => {
  it("replaces the cache from a live listing and keeps settings for surviving tools", async () => {
    const repository = new InMemoryMcpServerRepository();
    const tools = new InMemoryToolRepository();
    const created = await new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "X",
      url: "https://x.example/mcp",
    });
    const id = created.data!.id;
    await tools.replaceForServer(id, [
      { name: "search", title: null, description: null, inputSchema: null },
      { name: "retired", title: null, description: null, inputSchema: null },
    ]);
    const pagination = { cursorArgument: "cursor", nextCursorPath: "next", itemsPath: "items", maxPages: 3 };
    await tools.updateSettings(id, "search", { ...emptySettings, pagination });

    const refreshed = await new RefreshMcpTools(repository, okClient, tools).execute(id);

    expect(refreshed.data?.map((tool) => tool.name)).toEqual(["search", "fetch"]);
    const listed = await new ListMcpTools(tools).execute(id);
    expect(listed.data?.find((tool) => tool.name === "search")).toMatchObject({ title: "Search", pagination });
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new RefreshMcpTools(new InMemoryMcpServerRepository(), okClient, new InMemoryToolRepository()).execute(
      "missing",
    );
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("UpdateMcpToolSettings", () => {
  it("saves valid settings", async () => {
    const tools = new InMemoryToolRepository();
    await tools.replaceForServer("server-1", stubTools);
    const status = { statusPath: "status", meanings: { down: "source-unavailable" as const }, caveatsPath: null };

    const result = await new UpdateMcpToolSettings(tools).execute({
      serverId: "server-1",
      toolName: "search",
      settings: { ...emptySettings, status },
    });

    expect(result.data?.status).toEqual(status);
  });

  it("rejects invalid settings without saving", async () => {
    const tools = new InMemoryToolRepository();
    await tools.replaceForServer("server-1", stubTools);

    const result = await new UpdateMcpToolSettings(tools).execute({
      serverId: "server-1",
      toolName: "search",
      settings: {
        ...emptySettings,
        pagination: { cursorArgument: "cursor", nextCursorPath: "next", itemsPath: "items", maxPages: 0 },
      },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(tools.rows[0]?.pagination).toBeNull();
  });
});

describe("ResolveStepTools", () => {
  it("returns empty when the step allows no tools", async () => {
    const repository = new InMemoryMcpServerRepository();
    const result = await new ResolveStepTools(repository).execute(undefined);
    expect(result.data).toEqual({ refs: [], servers: [] });
  });

  it("keeps allowed tools on active servers and dedupes the server list", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "S",
      url: "https://s.example/sse",
    });
    const id = server.data!.id;

    const result = await new ResolveStepTools(repository).execute([
      { serverId: id, toolName: "search" },
      { serverId: id, toolName: "fetch" },
    ]);

    expect(result.data?.refs).toHaveLength(2);
    expect(result.data?.servers).toHaveLength(1);
  });

  it("drops refs to a disabled server (deny-by-default)", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "S",
      url: "https://s.example/sse",
    });
    const id = server.data!.id;
    await new DisableMcpServer(repository).execute(id);

    const result = await new ResolveStepTools(repository).execute([
      { serverId: id, toolName: "search" },
    ]);

    expect(result.data?.refs).toEqual([]);
    expect(result.data?.servers).toEqual([]);
  });

  it("keeps refs to a public-data reader", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "Legislation",
      url: "https://legislation.example/mcp",
      dataClassification: "public-read",
    });

    const result = await new ResolveStepTools(repository).execute([
      { serverId: server.data!.id, toolName: "search" },
    ]);

    expect(result.data?.refs).toHaveLength(1);
  });

  it("drops refs to a server that sends records out", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository, new InMemorySecretStore(repository)).execute({
      label: "Integration",
      url: "https://ext.example/sse",
      dataClassification: "external-write",
    });

    const result = await new ResolveStepTools(repository).execute([
      { serverId: server.data!.id, toolName: "search" },
    ]);

    expect(result.data?.refs).toEqual([]);
    expect(result.data?.servers).toEqual([]);
  });
});
