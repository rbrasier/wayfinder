import {
  domainError,
  err,
  isFlowUsableClassification,
  isValidMcpCallTimeout,
  MAX_MCP_CALL_TIMEOUT_MS,
  MIN_MCP_CALL_TIMEOUT_MS,
  ok,
  validateMcpCustomHeaders,
  validateMcpOAuthSettings,
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
  McpOAuthInput,
  McpOAuthSettings,
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
// unchanged, `null` (or a blank token) clears them. OAuth settings travel with
// their client secret; a blank secret keeps the stored one.
interface McpServerSecretsInput {
  bearerToken?: string | null;
  customHeaders?: Record<string, string> | null;
  oauth?: McpOAuthInput | null;
}

interface CurrentSignIn {
  hasCredential: boolean;
  hasOAuth: boolean;
}

interface SignInPatch {
  secrets: McpServerSecretsPatch;
  // Undefined leaves the server's OAuth settings as they are; null removes them.
  oauth: McpOAuthSettings | null | undefined;
}

interface SignInChoice {
  bearerToken: string | null | undefined;
  oauth: McpOAuthSettings | null | undefined;
  oauthClientSecret: string | null | undefined;
}

const normaliseToken = (token: string | null | undefined): string | null | undefined => {
  if (token === undefined) return undefined;
  const trimmed = token?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

// A server signs in exactly one way (issue #361). Switching to OAuth clears the
// bearer token; setting a token, or removing OAuth, clears OAuth and its secret.
const resolveSignIn = (
  input: McpServerSecretsInput,
  current: CurrentSignIn,
): Result<SignInChoice> => {
  const bearerToken = normaliseToken(input.bearerToken);
  if (input.oauth && typeof bearerToken === "string") {
    return err(domainError("VALIDATION_FAILED", "Use either a bearer token or OAuth client credentials, not both."));
  }
  if (input.oauth) {
    const validated = validateMcpOAuthSettings(input.oauth, current.hasOAuth);
    if (validated.error) return err(validated.error);
    return ok({ bearerToken: null, oauth: validated.data.settings, oauthClientSecret: validated.data.clientSecret });
  }
  const dropsOAuth = input.oauth === null || (typeof bearerToken === "string" && current.hasOAuth);
  return ok(
    dropsOAuth
      ? { bearerToken, oauth: null, oauthClientSecret: null }
      : { bearerToken, oauth: undefined, oauthClientSecret: undefined },
  );
};

// Validates the secrets as they will stand after the write — an Authorization
// header is refused only while a bearer token or OAuth will also be set.
const buildSignInPatch = (input: McpServerSecretsInput, current: CurrentSignIn): Result<SignInPatch> => {
  const signIn = resolveSignIn(input, current);
  if (signIn.error) return err(signIn.error);
  const { bearerToken, oauth, oauthClientSecret } = signIn.data;
  const willHaveToken = bearerToken === undefined ? current.hasCredential : bearerToken !== null;
  const willUseOAuth = oauth === undefined ? current.hasOAuth : oauth !== null;
  const secrets = { bearerToken, oauthClientSecret, headers: input.customHeaders };
  if (!input.customHeaders) return ok({ secrets, oauth });
  const headers = validateMcpCustomHeaders(input.customHeaders, willHaveToken || willUseOAuth);
  if (headers.error) return err(headers.error);
  return ok({ secrets: { ...secrets, headers: headers.data }, oauth });
};

const hasSecretChanges = (patch: McpServerSecretsPatch): boolean =>
  patch.bearerToken !== undefined || patch.headers !== undefined || patch.oauthClientSecret !== undefined;

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
    const signIn = buildSignInPatch(input, { hasCredential: false, hasOAuth: false });
    if (signIn.error) return err(signIn.error);

    const created = await this.servers.create({
      label,
      url,
      transport: input.transport,
      dataClassification: input.dataClassification,
      verbatimOnly: input.verbatimOnly,
      callTimeoutMs: input.callTimeoutMs,
      oauth: signIn.data.oauth ?? undefined,
      createdByUserId: input.createdByUserId ?? null,
    });
    if (created.error || !hasSecretChanges(signIn.data.secrets)) return created;

    const stored = await this.secrets.set(created.data.id, signIn.data.secrets);
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

    const signIn = buildSignInPatch(input, {
      hasCredential: current.data.hasCredential,
      hasOAuth: current.data.oauth !== null,
    });
    if (signIn.error) return err(signIn.error);

    const updated = await this.servers.update(input.id, {
      label: input.label?.trim(),
      url: input.url?.trim(),
      dataClassification: input.dataClassification,
      verbatimOnly: input.verbatimOnly,
      callTimeoutMs: input.callTimeoutMs,
      oauth: signIn.data.oauth,
    });
    if (updated.error || !hasSecretChanges(signIn.data.secrets)) return updated;

    const stored = await this.secrets.set(input.id, signIn.data.secrets);
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
