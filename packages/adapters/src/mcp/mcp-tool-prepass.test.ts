import { experimental_createMCPClient, generateText, type ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@rbrasier/domain";
import { buildMcpTransport } from "./ai-sdk-mcp-client";
import { recordTokenUsage } from "../observability/usage-tracking-adapter";
import { extractToolCalls, McpToolPrepass, prefixToolName, selectAllowedTools } from "./mcp-tool-prepass";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  experimental_createMCPClient: vi.fn(),
  generateText: vi.fn(),
}));
vi.mock("./ai-sdk-mcp-client", () => ({ buildMcpTransport: vi.fn(() => ({})) }));
vi.mock("../observability/usage-tracking-adapter", () => ({ recordTokenUsage: vi.fn() }));

// The tool objects are opaque to selection — only the keys matter — so a stub
// shape cast to ToolSet exercises the deny-by-default rule without a live server.
const stubTools = {
  search: {},
  fetch_page: {},
  delete_everything: {},
} as unknown as ToolSet;

describe("selectAllowedTools", () => {
  it("keeps only the allow-listed tools", () => {
    const selected = selectAllowedTools(stubTools, ["search", "fetch_page"]);
    expect(Object.keys(selected).sort()).toEqual(["fetch_page", "search"]);
  });

  it("never assembles a tool that is not allow-listed", () => {
    const selected = selectAllowedTools(stubTools, ["search"]);
    expect(selected.delete_everything).toBeUndefined();
  });

  it("returns an empty set when nothing is allowed", () => {
    expect(Object.keys(selectAllowedTools(stubTools, []))).toHaveLength(0);
  });

  it("ignores allow-listed names the server does not expose", () => {
    const selected = selectAllowedTools(stubTools, ["search", "nonexistent"]);
    expect(Object.keys(selected)).toEqual(["search"]);
  });
});

describe("prefixToolName", () => {
  it("namespaces a tool under its server label", () => {
    expect(prefixToolName("Docs Search", "query")).toBe("Docs_Search__query");
  });

  it("gives two servers exposing the same tool distinct keys", () => {
    expect(prefixToolName("Alpha", "search")).not.toBe(prefixToolName("Beta", "search"));
  });

  it("falls back to a stable prefix when the label has no usable characters", () => {
    expect(prefixToolName("***", "run")).toBe("server__run");
  });
});

describe("extractToolCalls", () => {
  const origins = new Map([
    ["Alpha__search", { serverLabel: "Alpha", toolName: "search" }],
  ]);
  const now = () => new Date("2026-07-13T00:00:00.000Z");

  it("pairs a call with its result via the call id and resolves the origin", () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "c1", toolName: "Alpha__search", args: { q: "hello" } }],
        toolResults: [{ toolCallId: "c1", result: { hits: 2 } }],
      },
    ];
    const records = extractToolCalls(steps, origins, now);
    expect(records).toEqual([
      {
        serverLabel: "Alpha",
        toolName: "search",
        arguments: JSON.stringify({ q: "hello" }),
        result: JSON.stringify({ hits: 2 }),
        calledAt: "2026-07-13T00:00:00.000Z",
      },
    ]);
  });

  it("records an empty result when no matching tool result is present", () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "c9", toolName: "Alpha__search", args: {} }],
        toolResults: [],
      },
    ];
    expect(extractToolCalls(steps, origins, now)[0]?.result).toBe("");
  });
});

describe("McpToolPrepass.run", () => {
  const server = {
    id: "server-1",
    label: "ParlView",
    transport: "streamable-http",
    url: "https://parlview.example/mcp",
    credentialRef: null,
    hasCredential: true,
    oauth: null,
    communicatesExternally: true,
  } as unknown as McpServer;

  const transcriptStep = {
    toolCalls: [{ toolCallId: "c1", toolName: "ParlView__get_transcript", args: { parlViewId: "5976131" } }],
    toolResults: [{ toolCallId: "c1", result: "Senators asked about staffing levels." }],
    usage: { promptTokens: 10, completionTokens: 5 },
  };

  const prepass = (resolve = vi.fn(async () => ({ data: "stored-token" }))) =>
    new McpToolPrepass(
      {} as never,
      { check: vi.fn(async () => ({ data: undefined })) } as never,
      { resolve } as never,
    );

  const input = {
    model: {} as never,
    provider: "anthropic" as const,
    modelName: "chat-model",
    system: "Look things up.",
    messages: [{ role: "user" as const, content: "What did the hearing cover?" }],
    servers: [server],
    allowedToolNamesByServer: { "server-1": ["get_transcript"] },
  };

  beforeEach(() => {
    vi.mocked(experimental_createMCPClient).mockResolvedValue({
      tools: async () => ({ get_transcript: {} }),
      close: async () => {},
    } as never);
  });

  it("connects with the token resolved for the server, not only the environment's", async () => {
    vi.mocked(generateText).mockResolvedValue({
      steps: [],
      text: "",
      usage: { promptTokens: 1, completionTokens: 1 },
    } as never);
    const resolve = vi.fn(async () => ({ data: "resolved-token" }));

    await prepass(resolve).run(input);

    expect(resolve).toHaveBeenCalledWith(server);
    expect(buildMcpTransport).toHaveBeenCalledWith(server, "resolved-token");
  });

  it("keeps what the tools returned before the time limit, rather than nothing", async () => {
    vi.mocked(generateText).mockImplementation((async (options: {
      onStepFinish?: (step: unknown) => void;
      abortSignal?: AbortSignal;
    }) => {
      options.onStepFinish?.(transcriptStep);
      await new Promise((_resolve, reject) =>
        options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }) as never);

    const result = await prepass().run({ ...input, timeoutMs: 20 });

    expect(result.error).toBeUndefined();
    expect(result.data?.toolCalls.map((call) => call.result)).toEqual(["Senators asked about staffing levels."]);
    expect(recordTokenUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ promptTokens: 10, completionTokens: 5 }),
    );
  });

  it("still fails when the time limit passes before any tool returned", async () => {
    vi.mocked(generateText).mockImplementation((async (options: { abortSignal?: AbortSignal }) => {
      await new Promise((_resolve, reject) =>
        options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }) as never);

    const result = await prepass().run({ ...input, timeoutMs: 20 });

    expect(result.error?.code).toBe("AGENT_FAILED");
  });
});
