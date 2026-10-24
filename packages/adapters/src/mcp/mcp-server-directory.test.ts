import { ok, type IMcpClient, type IMcpServerRepository, type McpServer } from "@rbrasier/domain";
import { describe, expect, it } from "vitest";
import { McpServerDirectory } from "./mcp-server-directory";

const server = (id: string, communicatesExternally: boolean): McpServer => ({
  id,
  label: id,
  transport: "sse",
  url: `https://${id}.example/sse`,
  credentialRef: null,
  hasCredential: false,
  communicatesExternally,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("McpServerDirectory", () => {
  it("offers every active server to flow authors, including ones that send data outside Wayfinder", async () => {
    const servers = {
      list: async () => ok([server("spellcheck", false), server("parlview", true)]),
    } as unknown as IMcpServerRepository;
    const client = {
      listTools: async () => ok([{ name: "lookup", description: null, inputSchema: null }]),
    } as unknown as IMcpClient;

    const result = await new McpServerDirectory(servers, client).listServersWithTools();

    expect(result.data?.map((entry) => entry.server.id)).toEqual(["spellcheck", "parlview"]);
  });
});
