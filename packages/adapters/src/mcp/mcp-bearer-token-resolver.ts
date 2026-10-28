import { domainError, err, ok, type IMcpServerRepository, type McpServer, type Result } from "@rbrasier/domain";
import { OAuthClientCredentialsTokenSource } from "./oauth-client-credentials-token-source";

// The bearer token a connection to this server sends: a fresh OAuth access token
// for a server that signs in with client credentials, else its stored token. The
// legacy `MCP_CRED_` fallback stays in `buildMcpTransport`. One instance is shared
// by every MCP connection so its token cache is too.
export class McpBearerTokenResolver {
  constructor(
    private readonly credentials: Pick<IMcpServerRepository, "readCredential" | "readOAuthClientSecret">,
    private readonly tokenSource: Pick<OAuthClientCredentialsTokenSource, "accessToken"> =
      new OAuthClientCredentialsTokenSource(),
  ) {}

  async resolve(server: McpServer): Promise<Result<string | null>> {
    if (!server.oauth) {
      return server.hasCredential ? this.credentials.readCredential(server.id) : ok(null);
    }
    const clientSecret = await this.credentials.readOAuthClientSecret(server.id);
    if (clientSecret.error) return clientSecret;
    if (!clientSecret.data) {
      return err(domainError("VALIDATION_FAILED", "This server's OAuth client secret is missing — save it again."));
    }
    return this.tokenSource.accessToken(server.id, server.oauth, clientSecret.data);
  }
}
