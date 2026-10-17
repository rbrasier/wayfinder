import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";
import type { McpSourceStatus, McpToolSettings } from "./mcp-tool-result";
import type { ToolRecordCitation } from "./tool-citation";

export type McpServerStatus = "active" | "disabled";

// Remote HTTP transports only. `sse` is the legacy default; `streamable-http`
// targets servers exposing the newer MCP streamable-HTTP endpoint, with or
// without sessions. Local/stdio (process-spawning) is out of scope.
export type McpTransport = "sse" | "streamable-http";

// What a server does with data, as classified by an admin (ADR-062 §1).
// `internal` is a self-contained utility (spellcheck, calculation); `public-read`
// reads published records from outside Wayfinder and sends back nothing but the
// query; `external-write` sends Wayfinder's records out, and is registered but
// never offered to or run by a flow.
export type McpDataClassification = "internal" | "public-read" | "external-write";

export const MCP_DATA_CLASSIFICATIONS: readonly McpDataClassification[] = [
  "internal",
  "public-read",
  "external-write",
];

export const isFlowUsableClassification = (classification: McpDataClassification): boolean =>
  classification !== "external-write";

// Public-data sources routinely take 10–30 s per call, so the default sits above
// that; the ceiling bounds how long a queued call can occupy the worker.
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 30_000;
export const MIN_MCP_CALL_TIMEOUT_MS = 1_000;
export const MAX_MCP_CALL_TIMEOUT_MS = 120_000;

export const isValidMcpCallTimeout = (timeoutMs: number): boolean =>
  Number.isInteger(timeoutMs) &&
  timeoutMs >= MIN_MCP_CALL_TIMEOUT_MS &&
  timeoutMs <= MAX_MCP_CALL_TIMEOUT_MS;

// An admin-registered remote MCP server. Its credential and custom headers are
// write-only (ADR-062 §8): the entity says only whether they exist, and the
// values are decrypted inside the adapter that opens the connection.
export interface McpServer {
  readonly id: string;
  readonly label: string;
  readonly transport: McpTransport;
  readonly url: string;
  readonly dataClassification: McpDataClassification;
  // Admin governance of Wayfinder's own handling (ADR-053 §5): when `true`,
  // Wayfinder will not transform this connection's tool results — it selects
  // from them or passes them through unchanged. It claims nothing about whether
  // the source itself is correct, which Wayfinder cannot know.
  readonly verbatimOnly: boolean;
  readonly callTimeoutMs: number;
  readonly hasCredential: boolean;
  readonly customHeaderNames: string[];
  readonly status: McpServerStatus;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewMcpServer {
  readonly label: string;
  readonly transport?: McpTransport;
  readonly url: string;
  readonly dataClassification?: McpDataClassification;
  readonly verbatimOnly?: boolean;
  readonly callTimeoutMs?: number;
  readonly createdByUserId?: string | null;
}

export interface McpServerUpdate {
  readonly label?: string;
  readonly url?: string;
  readonly dataClassification?: McpDataClassification;
  readonly verbatimOnly?: boolean;
  readonly callTimeoutMs?: number;
}

// The secrets a connection sends. Never returned by a repository read or a
// router — only the secret store's `get` produces one, for the MCP client.
export interface McpServerSecrets {
  readonly bearerToken: string | null;
  readonly headers: Record<string, string>;
}

// `undefined` leaves a secret unchanged; `null` clears it.
export interface McpServerSecretsPatch {
  readonly bearerToken?: string | null;
  readonly headers?: Record<string, string> | null;
}

// Headers the transport sets itself. Letting an admin override them would break
// the protocol (session id, negotiated version, content negotiation) or the
// request framing, so they are refused rather than silently ignored.
export const RESERVED_MCP_HEADER_NAMES: readonly string[] = [
  "host",
  "content-length",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const LINE_BREAK = /[\r\n]/;

// Validates and trims custom header names. `Authorization` is allowed as a custom
// header only when no bearer token is set — otherwise two values would compete
// for the same header and which one is sent would depend on merge order.
export const validateMcpCustomHeaders = (
  headers: Record<string, string>,
  hasBearerToken: boolean,
): Result<Record<string, string>> => {
  const validated: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.trim();
    const lowerName = name.toLowerCase();
    if (!HTTP_TOKEN.test(name)) {
      return err(domainError("VALIDATION_FAILED", `"${rawName}" is not a valid header name.`));
    }
    if (RESERVED_MCP_HEADER_NAMES.includes(lowerName)) {
      return err(domainError("VALIDATION_FAILED", `${name} is set by the connection and cannot be overridden.`));
    }
    if (lowerName === "authorization" && hasBearerToken) {
      return err(
        domainError("VALIDATION_FAILED", "Remove the bearer token before setting an Authorization header."),
      );
    }
    if (LINE_BREAK.test(value)) {
      return err(domainError("VALIDATION_FAILED", `The value for ${name} cannot contain a line break.`));
    }
    validated[name] = value;
  }
  return ok(validated);
};

// A tool discovered on a server. `inputSchema` is the tool's JSON-schema input;
// `title` is the human-readable name the server gives it, when it gives one.
export interface McpTool {
  readonly name: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown> | null;
}

// A cached tool with the admin's per-tool settings (ADR-062 §5). The settings
// survive a refresh for as long as the server keeps listing the tool.
export interface CachedMcpTool extends McpTool, McpToolSettings {
  readonly serverId: string;
  readonly lastSyncedAt: Date;
}

// The human-readable label for a tool wherever a person sees it.
export const mcpToolDisplayTitle = (tool: Pick<McpTool, "name" | "title">): string =>
  tool.title?.trim() ? tool.title.trim() : tool.name;

// A reference to one tool on one server — how a flow node names a tool it may use.
export interface McpToolRef {
  readonly serverId: string;
  readonly toolName: string;
}

// A server plus the tools it currently exposes, for the flow editor.
export interface McpServerWithTools {
  readonly server: McpServer;
  readonly tools: McpTool[];
}

// One tool call made during the conversational tool-loop pre-pass, persisted on
// the turn so a reviewer can reconstruct what a tool told the AI and so later
// turns can re-read it. The members after `calledAt` are absent on rows written
// before ADR-062, which read as one page with no status and no citations.
export interface McpToolCallRecord {
  readonly serverLabel: string;
  readonly toolName: string;
  // JSON-serialised call arguments, capped by the recorder.
  readonly arguments: string;
  // The tool's full output up to the record ceiling; `truncated` marks a cut.
  readonly result: string;
  readonly calledAt: string;
  readonly serverId?: string;
  readonly truncated?: boolean;
  readonly pagesFetched?: number;
  readonly sourceStatus?: McpSourceStatus | null;
  readonly citations?: ToolRecordCitation[];
}
