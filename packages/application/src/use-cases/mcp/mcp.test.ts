import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ILegacyMcpCredentialSource,
  IMcpClient,
  IMcpServerRepository,
  ListMcpServersInput,
  McpServer,
  McpServerStatus,
  McpServerUpdate,
  McpTool,
  McpToolCallOutput,
  NewMcpServer,
  Result,
} from "@rbrasier/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DeleteMcpServer,
  DisableMcpServer,
  EnableMcpServer,
  ListMcpServers,
  RegisterMcpServer,
  ResolveStepTools,
  TestMcpServer,
  UpdateMcpServer,
} from "./mcp";

class InMemoryMcpServerRepository implements IMcpServerRepository {
  rows: McpServer[] = [];
  credentials = new Map<string, string>();
  private sequence = 0;

  private storeCredential(id: string, credential: string | null | undefined): void {
    if (credential === undefined) return;
    if (credential === null) this.credentials.delete(id);
    else this.credentials.set(id, credential);
  }

  async create(input: NewMcpServer): Promise<Result<McpServer>> {
    this.sequence += 1;
    const now = new Date();
    const server: McpServer = {
      id: `mcp-${this.sequence}`,
      label: input.label,
      transport: input.transport ?? "sse",
      url: input.url,
      credentialRef: input.credentialRef ?? null,
      hasCredential: typeof input.credential === "string",
      communicatesExternally: input.communicatesExternally ?? false,
      status: "active",
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(server);
    this.storeCredential(server.id, input.credential);
    return ok(server);
  }

  async update(id: string, patch: McpServerUpdate): Promise<Result<McpServer>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index === -1) return err(domainError("NOT_FOUND", "MCP server not found."));
    const current = this.rows[index]!;
    this.storeCredential(id, patch.credential);
    const updated: McpServer = {
      ...current,
      label: patch.label ?? current.label,
      url: patch.url ?? current.url,
      credentialRef:
        patch.credentialRef === undefined ? current.credentialRef : patch.credentialRef,
      hasCredential: this.credentials.has(id),
      communicatesExternally: patch.communicatesExternally ?? current.communicatesExternally,
    };
    this.rows[index] = updated;
    return ok(updated);
  }

  async readCredential(id: string): Promise<Result<string | null>> {
    return ok(this.credentials.get(id) ?? null);
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

const stubTools: McpTool[] = [
  { name: "search", description: "Search the web", inputSchema: null },
  { name: "fetch", description: null, inputSchema: null },
];

const okClient: IMcpClient = {
  async listTools(): Promise<Result<McpTool[]>> {
    return ok(stubTools);
  },
  async callTool(): Promise<Result<McpToolCallOutput>> {
    return ok({ output: "done" });
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

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
  });

  it("creates a server with a trimmed label and url", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "  GitHub  ",
      url: "https://mcp.example.com/sse",
    });
    expect(result.data?.label).toBe("GitHub");
    expect(result.data?.status).toBe("active");
  });

  it("rejects an empty label", async () => {
    const result = await new RegisterMcpServer(repository).execute({ label: "  ", url: "https://x.y" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-http url", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "Bad",
      url: "ftp://nope",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("stores a token given at registration, and never echoes it back", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "GitHub",
      url: "https://mcp.example.com/sse",
      credential: "  ghp_secret  ",
    });

    expect(result.data?.hasCredential).toBe(true);
    expect(result.data?.credentialRef).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain("ghp_secret");
    expect(repository.credentials.get(result.data!.id)).toBe("ghp_secret");
  });

  it("registers without a token when none is given", async () => {
    const result = await new RegisterMcpServer(repository).execute({
      label: "Spellcheck",
      url: "https://mcp.example.com/sse",
      credential: "   ",
    });

    expect(result.data?.hasCredential).toBe(false);
  });
});

describe("UpdateMcpServer", () => {
  const environment = (values: Record<string, string>): ILegacyMcpCredentialSource => ({
    read: (credentialRef) => values[credentialRef] ?? null,
  });

  const legacyServer = async (repository: InMemoryMcpServerRepository): Promise<string> => {
    const created = await repository.create({
      label: "Legacy",
      url: "https://legacy.example.com/sse",
      credentialRef: "MCP_CRED_LEGACY",
    });
    return created.data!.id;
  };

  it("rejects an invalid url on update", async () => {
    const repository = new InMemoryMcpServerRepository();
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.y",
    });
    const result = await new UpdateMcpServer(repository, environment({})).execute({
      id: created.data!.id,
      url: "not-a-url",
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new UpdateMcpServer(new InMemoryMcpServerRepository(), environment({})).execute({
      id: "missing",
      label: "X",
    });
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("keeps a stored token when none is sent, replaces it when one is, and removes it on null", async () => {
    const repository = new InMemoryMcpServerRepository();
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.y",
      credential: "first",
    });
    const id = created.data!.id;
    const update = new UpdateMcpServer(repository, environment({}));

    await update.execute({ id, label: "Renamed", credential: "  " });
    expect(repository.credentials.get(id)).toBe("first");

    await update.execute({ id, credential: "second" });
    expect(repository.credentials.get(id)).toBe("second");

    const removed = await update.execute({ id, credential: null });
    expect(repository.credentials.has(id)).toBe(false);
    expect(removed.data?.hasCredential).toBe(false);
  });

  it("moves a legacy server's environment token into storage when it is saved", async () => {
    const repository = new InMemoryMcpServerRepository();
    const id = await legacyServer(repository);

    const result = await new UpdateMcpServer(repository, environment({ MCP_CRED_LEGACY: "from-env" })).execute({
      id,
      label: "Legacy, renamed",
    });

    expect(result.data?.credentialRef).toBeNull();
    expect(result.data?.hasCredential).toBe(true);
    expect(repository.credentials.get(id)).toBe("from-env");
  });

  it("stores a newly typed token on a legacy server and drops its environment reference", async () => {
    const repository = new InMemoryMcpServerRepository();
    const id = await legacyServer(repository);

    const result = await new UpdateMcpServer(repository, environment({ MCP_CRED_LEGACY: "from-env" })).execute({
      id,
      credential: "typed",
    });

    expect(result.data?.credentialRef).toBeNull();
    expect(repository.credentials.get(id)).toBe("typed");
  });

  it("keeps a legacy reference when its environment variable is empty, so the server works as before", async () => {
    const repository = new InMemoryMcpServerRepository();
    const id = await legacyServer(repository);

    const result = await new UpdateMcpServer(repository, environment({})).execute({ id, label: "Renamed" });

    expect(result.data?.credentialRef).toBe("MCP_CRED_LEGACY");
    expect(result.data?.hasCredential).toBe(false);
  });

  it("clears a legacy reference when the token is removed", async () => {
    const repository = new InMemoryMcpServerRepository();
    const id = await legacyServer(repository);

    const result = await new UpdateMcpServer(repository, environment({ MCP_CRED_LEGACY: "from-env" })).execute({
      id,
      credential: null,
    });

    expect(result.data?.credentialRef).toBeNull();
    expect(result.data?.hasCredential).toBe(false);
  });
});

describe("Disable / Enable / List", () => {
  it("excludes disabled servers by default and includes them on request", async () => {
    const repository = new InMemoryMcpServerRepository();
    const register = new RegisterMcpServer(repository);
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
    const register = new RegisterMcpServer(repository);
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

  beforeEach(() => {
    repository = new InMemoryMcpServerRepository();
  });

  it("returns the discovered tool count for a reachable server", async () => {
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.example/sse",
    });
    const result = await new TestMcpServer(repository, okClient).execute(created.data!.id);
    expect(result.data?.toolCount).toBe(2);
    expect(result.data?.tools[0]?.name).toBe("search");
  });

  it("propagates a client failure as an error", async () => {
    const created = await new RegisterMcpServer(repository).execute({
      label: "X",
      url: "https://x.example/sse",
    });
    const result = await new TestMcpServer(repository, failingClient).execute(created.data!.id);
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("returns NOT_FOUND for an unknown server", async () => {
    const result = await new TestMcpServer(repository, okClient).execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
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
    const server = await new RegisterMcpServer(repository).execute({
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
    const server = await new RegisterMcpServer(repository).execute({
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

  it("keeps refs to a server that sends data outside Wayfinder — the classification is a label", async () => {
    const repository = new InMemoryMcpServerRepository();
    const server = await new RegisterMcpServer(repository).execute({
      label: "Integration",
      url: "https://ext.example/sse",
      communicatesExternally: true,
    });

    const result = await new ResolveStepTools(repository).execute([
      { serverId: server.data!.id, toolName: "search" },
    ]);

    expect(result.data?.refs).toEqual([{ serverId: server.data!.id, toolName: "search" }]);
    expect(result.data?.servers.map((entry) => entry.label)).toEqual(["Integration"]);
  });
});
