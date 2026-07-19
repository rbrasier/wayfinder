import { domainError, err, isValidMcpCredentialRef, MCP_CREDENTIAL_ENV_PREFIX, ok } from "@rbrasier/domain";
import type {
  IMcpClient,
  IMcpServerDirectory,
  IMcpServerRepository,
  ListMcpServersInput,
  McpServer,
  McpServerWithTools,
  McpTool,
  McpToolRef,
  McpTransport,
  Result,
} from "@rbrasier/domain";

const credentialRefError = domainError(
  "VALIDATION_FAILED",
  `Credential reference must name an environment variable in the ${MCP_CREDENTIAL_ENV_PREFIX} namespace.`,
);

export class RegisterMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input: {
    label: string;
    url: string;
    transport?: McpTransport;
    communicatesExternally?: boolean;
    credentialRef?: string | null;
    createdByUserId?: string | null;
  }): Promise<Result<McpServer>> {
    const label = input.label.trim();
    const url = input.url.trim();
    if (label.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Server label is required."));
    }
    if (!isHttpUrl(url)) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    const credentialRef = input.credentialRef?.trim() ? input.credentialRef.trim() : null;
    if (credentialRef !== null && !isValidMcpCredentialRef(credentialRef)) {
      return err(credentialRefError);
    }
    return this.servers.create({
      label,
      url,
      transport: input.transport,
      communicatesExternally: input.communicatesExternally,
      credentialRef,
      createdByUserId: input.createdByUserId ?? null,
    });
  }
}

export class UpdateMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input: {
    id: string;
    label?: string;
    url?: string;
    communicatesExternally?: boolean;
    credentialRef?: string | null;
  }): Promise<Result<McpServer>> {
    if (input.url !== undefined && !isHttpUrl(input.url.trim())) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    const credentialRef =
      input.credentialRef === undefined
        ? undefined
        : input.credentialRef?.trim()
          ? input.credentialRef.trim()
          : null;
    if (credentialRef && !isValidMcpCredentialRef(credentialRef)) {
      return err(credentialRefError);
    }
    return this.servers.update(input.id, {
      label: input.label?.trim(),
      url: input.url?.trim(),
      communicatesExternally: input.communicatesExternally,
      credentialRef,
    });
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
export class TestMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly client: IMcpClient,
  ) {}

  async execute(id: string): Promise<Result<TestMcpServerOutput>> {
    const found = await this.servers.findById(id);
    if (found.error) return err(found.error);
    if (!found.data) return err(domainError("NOT_FOUND", "MCP server not found."));

    const tools = await this.client.listTools(found.data);
    if (tools.error) return err(tools.error);
    return ok({ toolCount: tools.data.length, tools: tools.data });
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
      // Externally-communicating servers are not usable in flows at this stage —
      // drop the ref so a reclassified server can never reach the tool-loop.
      if (!server || server.communicatesExternally) continue;
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
