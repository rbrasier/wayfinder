import {
  domainError,
  err,
  isFlowUsableClassification,
  isValidMcpCallTimeout,
  MAX_MCP_CALL_TIMEOUT_MS,
  MIN_MCP_CALL_TIMEOUT_MS,
  ok,
  validateMcpCustomHeaders,
  validateMcpToolSettings,
} from "@wayfinder/domain";
import type {
  CachedMcpTool,
  IMcpClient,
  IMcpServerDirectory,
  IMcpServerRepository,
  IMcpServerSecretStore,
  IMcpToolRepository,
  ListMcpServersInput,
  McpDataClassification,
  McpServer,
  McpServerSecretsPatch,
  McpServerWithTools,
  McpTool,
  McpToolRef,
  McpToolSettings,
  McpTransport,
  Result,
} from "@wayfinder/domain";

const timeoutError = domainError(
  "VALIDATION_FAILED",
  `The call timeout must be between ${MIN_MCP_CALL_TIMEOUT_MS / 1000} and ${MAX_MCP_CALL_TIMEOUT_MS / 1000} seconds.`,
);

// Secrets travel on the request as write-only inputs: `undefined` leaves them
// unchanged, `null` (or a blank token) clears them.
interface McpServerSecretsInput {
  bearerToken?: string | null;
  customHeaders?: Record<string, string> | null;
}

const normaliseToken = (token: string | null | undefined): string | null | undefined => {
  if (token === undefined) return undefined;
  const trimmed = token?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

// Validates the secrets as they will stand after the write — an Authorization
// header is refused only while a bearer token will also be set.
const buildSecretsPatch = (
  input: McpServerSecretsInput,
  currentlyHasCredential: boolean,
): Result<McpServerSecretsPatch> => {
  const bearerToken = normaliseToken(input.bearerToken);
  const willHaveToken = bearerToken === undefined ? currentlyHasCredential : bearerToken !== null;
  if (!input.customHeaders) return ok({ bearerToken, headers: input.customHeaders });
  const headers = validateMcpCustomHeaders(input.customHeaders, willHaveToken);
  if (headers.error) return err(headers.error);
  return ok({ bearerToken, headers: headers.data });
};

const hasSecretChanges = (patch: McpServerSecretsPatch): boolean =>
  patch.bearerToken !== undefined || patch.headers !== undefined;

const reload = async (servers: IMcpServerRepository, id: string): Promise<Result<McpServer>> => {
  const found = await servers.findById(id);
  if (found.error) return err(found.error);
  if (!found.data) return err(domainError("NOT_FOUND", "MCP server not found."));
  return ok(found.data);
};

export class RegisterMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly secrets: IMcpServerSecretStore,
  ) {}

  async execute(
    input: {
      label: string;
      url: string;
      transport?: McpTransport;
      dataClassification?: McpDataClassification;
      verbatimOnly?: boolean;
      callTimeoutMs?: number;
      createdByUserId?: string | null;
    } & McpServerSecretsInput,
  ): Promise<Result<McpServer>> {
    const label = input.label.trim();
    const url = input.url.trim();
    if (label.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Server label is required."));
    }
    if (!isHttpUrl(url)) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    if (input.callTimeoutMs !== undefined && !isValidMcpCallTimeout(input.callTimeoutMs)) {
      return err(timeoutError);
    }
    const secretsPatch = buildSecretsPatch(input, false);
    if (secretsPatch.error) return err(secretsPatch.error);

    const created = await this.servers.create({
      label,
      url,
      transport: input.transport,
      dataClassification: input.dataClassification,
      verbatimOnly: input.verbatimOnly,
      callTimeoutMs: input.callTimeoutMs,
      createdByUserId: input.createdByUserId ?? null,
    });
    if (created.error || !hasSecretChanges(secretsPatch.data)) return created;

    const stored = await this.secrets.set(created.data.id, secretsPatch.data);
    if (stored.error) return err(stored.error);
    return reload(this.servers, created.data.id);
  }
}

export class UpdateMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly secrets: IMcpServerSecretStore,
  ) {}

  async execute(
    input: {
      id: string;
      label?: string;
      url?: string;
      dataClassification?: McpDataClassification;
      verbatimOnly?: boolean;
      callTimeoutMs?: number;
    } & McpServerSecretsInput,
  ): Promise<Result<McpServer>> {
    if (input.url !== undefined && !isHttpUrl(input.url.trim())) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    if (input.callTimeoutMs !== undefined && !isValidMcpCallTimeout(input.callTimeoutMs)) {
      return err(timeoutError);
    }
    const current = await reload(this.servers, input.id);
    if (current.error) return current;

    const secretsPatch = buildSecretsPatch(input, current.data.hasCredential);
    if (secretsPatch.error) return err(secretsPatch.error);

    const updated = await this.servers.update(input.id, {
      label: input.label?.trim(),
      url: input.url?.trim(),
      dataClassification: input.dataClassification,
      verbatimOnly: input.verbatimOnly,
      callTimeoutMs: input.callTimeoutMs,
    });
    if (updated.error || !hasSecretChanges(secretsPatch.data)) return updated;

    const stored = await this.secrets.set(input.id, secretsPatch.data);
    if (stored.error) return err(stored.error);
    return reload(this.servers, input.id);
  }
}

export class ListMcpServers {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input?: ListMcpServersInput): Promise<Result<McpServer[]>> {
    return this.servers.list(input);
  }
}

export class DisableMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(id: string): Promise<Result<McpServer>> {
    return this.servers.setStatus(id, "disabled");
  }
}

export class EnableMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(id: string): Promise<Result<McpServer>> {
    return this.servers.setStatus(id, "active");
  }
}

export class DeleteMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(id: string): Promise<Result<void>> {
    return this.servers.delete(id);
  }
}

export interface TestMcpServerOutput {
  readonly toolCount: number;
  readonly tools: McpTool[];
}

// Connection test: resolves the server and lists its tools. Surfaces a typed
// error rather than throwing so the admin UI can show why a server is unreachable.
// A successful listing also refreshes the tool cache — it is the same answer.
export class TestMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
    private readonly tools: IMcpToolRepository,
  ) {}

  async execute(id: string): Promise<Result<TestMcpServerOutput>> {
    const server = await reload(this.servers, id);
    if (server.error) return err(server.error);

    const listed = await this.client.listTools(server.data);
    if (listed.error) return err(listed.error);
    await this.tools.replaceForServer(id, listed.data);
    return ok({ toolCount: listed.data.length, tools: listed.data });
  }
}

// Re-reads a server's tools into the `admin_mcp_tools` cache (ADR-062 §5).
export class RefreshMcpTools {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
    private readonly tools: IMcpToolRepository,
  ) {}

  async execute(serverId: string): Promise<Result<CachedMcpTool[]>> {
    const server = await reload(this.servers, serverId);
    if (server.error) return err(server.error);

    const listed = await this.client.listTools(server.data);
    if (listed.error) return err(listed.error);
    return this.tools.replaceForServer(serverId, listed.data);
  }
}

export class ListMcpTools {
  constructor(private readonly tools: IMcpToolRepository) {}

  async execute(serverId: string): Promise<Result<CachedMcpTool[]>> {
    return this.tools.listByServer(serverId);
  }
}

export class UpdateMcpToolSettings {
  constructor(private readonly tools: IMcpToolRepository) {}

  async execute(input: {
    serverId: string;
    toolName: string;
    settings: McpToolSettings;
  }): Promise<Result<CachedMcpTool>> {
    const validated = validateMcpToolSettings(input.settings);
    if (validated.error) return err(validated.error);
    return this.tools.updateSettings(input.serverId, input.toolName, validated.data);
  }
}

export class ListMcpServersWithTools {
  constructor(private readonly directory: IMcpServerDirectory) {}

  async execute(): Promise<Result<McpServerWithTools[]>> {
    return this.directory.listServersWithTools();
  }
}

export interface ResolvedStepTools {
  // Only tool refs whose server is active are kept (deny-by-default, ADR-032).
  readonly refs: McpToolRef[];
  // The active servers referenced, deduplicated — the runner needs these to open
  // connections.
  readonly servers: McpServer[];
}

// Resolves a conversational step's allowedMcpToolRefs into the tools that may
// actually be offered to the model. A ref naming a missing or disabled server is
// dropped silently so a stale reference never fails a turn — the node's list, not
// the skill, is the enforcement boundary.
export class ResolveStepTools {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(allowedToolRefs: McpToolRef[] | undefined): Promise<Result<ResolvedStepTools>> {
    const refs = allowedToolRefs ?? [];
    if (refs.length === 0) return ok({ refs: [], servers: [] });

    const serversResult = await this.servers.list();
    if (serversResult.error) return err(serversResult.error);

    const activeById = new Map(serversResult.data.map((server) => [server.id, server]));
    const keptRefs: McpToolRef[] = [];
    const usedServers = new Map<string, McpServer>();

    for (const ref of refs) {
      const server = activeById.get(ref.serverId);
      // A server that sends records out is never usable in a flow (ADR-062 §1) —
      // drop the ref so a reclassified server can never reach the tool-loop.
      if (!server || !isFlowUsableClassification(server.dataClassification)) continue;
      keptRefs.push(ref);
      usedServers.set(server.id, server);
    }

    return ok({ refs: keptRefs, servers: [...usedServers.values()] });
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
