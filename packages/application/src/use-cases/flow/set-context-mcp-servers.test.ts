import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type { IFlowRepository, IMcpServerRepository, McpServer } from "@rbrasier/domain";
import { SetFlowContextMcpServers } from "./set-context-mcp-servers";

const server = (overrides: Partial<McpServer>): McpServer => ({
  id: "s",
  label: "S",
  transport: "sse",
  kind: "context",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeServers = (servers: McpServer[]): IMcpServerRepository =>
  ({
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    list: vi.fn().mockResolvedValue(ok(servers)),
    setStatus: vi.fn(),
  }) as unknown as IMcpServerRepository;

const makeFlows = () => {
  const setContextMcpServers = vi.fn().mockResolvedValue(ok({} as never));
  const flows = { setContextMcpServers } as unknown as IFlowRepository;
  return { flows, setContextMcpServers };
};

describe("SetFlowContextMcpServers", () => {
  it("keeps only active context servers and drops actions/disabled/unknown ids", async () => {
    const servers = [
      server({ id: "ctx-active", kind: "context", status: "active" }),
      server({ id: "ctx-disabled", kind: "context", status: "disabled" }),
      server({ id: "actions", kind: "actions", status: "active" }),
    ];
    const { flows, setContextMcpServers } = makeFlows();

    await new SetFlowContextMcpServers(flows, makeServers(servers)).execute("flow-1", [
      "ctx-active",
      "ctx-disabled",
      "actions",
      "does-not-exist",
    ]);

    expect(setContextMcpServers).toHaveBeenCalledWith("flow-1", ["ctx-active"]);
  });
});
