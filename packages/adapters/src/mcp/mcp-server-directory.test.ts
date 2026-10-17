import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type { CachedMcpTool, IMcpClient, IMcpServerRepository, IMcpToolRepository, McpServer } from "@wayfinder/domain";
import { McpServerDirectory } from "./mcp-server-directory";

const server = (id: string, dataClassification: McpServer["dataClassification"]): McpServer => ({
  id,
  label: id,
  transport: "streamable-http",
  url: `https://${id}.example/mcp`,
  dataClassification,
  verbatimOnly: false,
  callTimeoutMs: 30_000,
  hasCredential: false,
  customHeaderNames: [],
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const cachedTool = (serverId: string, name: string): CachedMcpTool => ({
  serverId,
  name,
  title: `${name} title`,
  description: null,
  inputSchema: { type: "object" },
  lastSyncedAt: new Date(),
  pagination: null,
  status: null,
  citation: null,
});

const build = (options: { cached: Record<string, CachedMcpTool[]>; live?: IMcpClient["listTools"] }) => {
  const servers = {
    list: vi.fn().mockResolvedValue(
      ok([server("internal", "internal"), server("reader", "public-read"), server("writer", "external-write")]),
    ),
  } as unknown as IMcpServerRepository;
  const tools = {
    listByServer: vi.fn().mockImplementation(async (id: string) => ok(options.cached[id] ?? [])),
    replaceForServer: vi.fn().mockImplementation(async (id: string, listed) =>
      ok(listed.map((entry: { name: string }) => cachedTool(id, entry.name))),
    ),
  } as unknown as IMcpToolRepository;
  const client: IMcpClient = {
    listTools: options.live ?? vi.fn().mockResolvedValue(ok([{ name: "live", title: null, description: null, inputSchema: null }])),
    callTool: vi.fn(),
  };
  return { directory: new McpServerDirectory(servers, client, tools), client, tools };
};

describe("McpServerDirectory", () => {
  it("offers internal and public-data servers, never ones that send records out", async () => {
    const { directory } = build({ cached: { internal: [cachedTool("internal", "a")], reader: [cachedTool("reader", "b")] } });

    const listed = await directory.listServersWithTools();

    expect(listed.data?.map((entry) => entry.server.id)).toEqual(["internal", "reader"]);
  });

  it("reads tools from the cache without calling the server", async () => {
    const { directory, client } = build({ cached: { internal: [cachedTool("internal", "a")], reader: [cachedTool("reader", "b")] } });

    const listed = await directory.listServersWithTools();

    expect(client.listTools).not.toHaveBeenCalled();
    expect(listed.data?.[0]?.tools[0]).toMatchObject({ name: "a", title: "a title", inputSchema: { type: "object" } });
  });

  it("lists live and caches the result when a server has nothing cached", async () => {
    const { directory, client, tools } = build({ cached: { internal: [cachedTool("internal", "a")] } });

    const listed = await directory.listServersWithTools();

    expect(client.listTools).toHaveBeenCalledTimes(1);
    expect(tools.replaceForServer).toHaveBeenCalledWith("reader", expect.any(Array));
    expect(listed.data?.[1]?.tools.map((entry) => entry.name)).toEqual(["live"]);
  });

  it("returns a server that fails to answer with no tools rather than failing the directory", async () => {
    const { directory } = build({ cached: {}, live: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "down"))) });

    const listed = await directory.listServersWithTools();

    expect(listed.data?.map((entry) => entry.tools)).toEqual([[], []]);
  });
});
