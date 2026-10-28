import { domainError, err, ok, validateMcpOAuthSettings } from "@rbrasier/domain";
import type {
  ILegacyMcpCredentialSource,
  IMcpClient,
  IMcpServerDirectory,
  IMcpServerRepository,
  ListMcpServersInput,
  McpCredentialChange,
  McpOAuthInput,
  McpOAuthWrite,
  McpServer,
  McpServerUpdate,
  McpServerWithTools,
  McpTool,
  McpToolRef,
  McpTransport,
  Result,
} from "@rbrasier/domain";

// A blank token field means "no change", not "an empty token".
const tokenFrom = (credential: McpCredentialChange): McpCredentialChange => {
  if (credential === undefined || credential === null) return credential;
  const token = credential.trim();
  return token.length > 0 ? token : undefined;
};

// Both would compete for the one Authorization header.
const bothSignInMethods = () =>
  err(domainError("VALIDATION_FAILED", "Use either a bearer token or OAuth client credentials, not both."));

export class RegisterMcpServer {
  constructor(private readonly servers: IMcpServerRepository) {}

  async execute(input: {
    label: string;
    url: string;
    transport?: McpTransport;
    communicatesExternally?: boolean;
    credential?: string | null;
    oauth?: McpOAuthInput | null;
    createdByUserId?: string | null;
  }): Promise<Result<McpServer>> {
    const label = input.label.trim();
    const url = input.url.trim();
    const credential = tokenFrom(input.credential) ?? undefined;
    if (label.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Server label is required."));
    }
    if (!isHttpUrl(url)) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    if (input.oauth && credential) return bothSignInMethods();

    let oauth: McpOAuthWrite | undefined;
    if (input.oauth) {
      const validated = validateMcpOAuthSettings(input.oauth, false);
      if (validated.error) return validated;
      oauth = validated.data;
    }
    return this.servers.create({
      label,
      url,
      transport: input.transport,
      communicatesExternally: input.communicatesExternally,
      credential,
      oauth,
      createdByUserId: input.createdByUserId ?? null,
    });
  }
}

export class UpdateMcpServer {
  constructor(
    private readonly servers: IMcpServerRepository,
    private readonly legacyCredentials: ILegacyMcpCredentialSource,
  ) {}

  async execute(input: {
    id: string;
    label?: string;
    url?: string;
    communicatesExternally?: boolean;
    credential?: string | null;
    oauth?: McpOAuthInput | null;
  }): Promise<Result<McpServer>> {
    const credential = tokenFrom(input.credential);
    if (input.url !== undefined && !isHttpUrl(input.url.trim())) {
      return err(domainError("VALIDATION_FAILED", "Server URL must be a valid http(s) URL."));
    }
    if (input.oauth && typeof credential === "string") return bothSignInMethods();
    const current = await this.servers.findById(input.id);
    if (current.error) return current;
    if (!current.data) return err(domainError("NOT_FOUND", "MCP server not found."));

    const signIn = this.signInPatch(current.data, credential, input.oauth);
    if (signIn.error) return signIn;
    return this.servers.update(input.id, {
      label: input.label?.trim(),
      url: input.url?.trim(),
      communicatesExternally: input.communicatesExternally,
      ...signIn.data,
    });
  }

  // A server signs in exactly one way. Switching to OAuth drops the stored token
  // and any legacy reference; setting a token, or removing OAuth, drops OAuth.
  // The client secret may be left blank only when the server already uses OAuth.
  private signInPatch(
    server: McpServer,
    credential: McpCredentialChange,
    oauth: McpOAuthInput | null | undefined,
  ): Result<Pick<McpServerUpdate, "credential" | "credentialRef" | "oauth">> {
    if (oauth) {
      const validated = validateMcpOAuthSettings(oauth, server.oauth !== null);
      if (validated.error) return validated;
      return ok({ oauth: validated.data, credential: null, credentialRef: null });
    }
    const tokenPatch = this.credentialPatch(server, credential);
    const dropsOAuth = oauth === null || (typeof credential === "string" && server.oauth !== null);
    return ok(dropsOAuth ? { ...tokenPatch, oauth: null } : tokenPatch);
  }

  // Any save of a server still on a legacy environment variable moves it to a
  // stored token: the one typed, or else the variable's current value. With
  // neither, the reference stays so the server keeps working as it did.
  private credentialPatch(
    server: McpServer,
    credential: McpCredentialChange,
  ): Pick<McpServerUpdate, "credential" | "credentialRef"> {
    if (credential === null) return { credential: null, credentialRef: null };
    if (credential !== undefined) {
      return server.credentialRef ? { credential, credentialRef: null } : { credential };
    }
    if (!server.credentialRef || server.hasCredential) return {};
    const legacyToken = this.legacyCredentials.read(server.credentialRef);
    return legacyToken ? { credential: legacyToken, credentialRef: null } : {};
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
      if (!server) continue;
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
