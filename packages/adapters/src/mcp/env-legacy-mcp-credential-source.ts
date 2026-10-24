import { isValidMcpCredentialRef, type ILegacyMcpCredentialSource } from "@rbrasier/domain";

// Reads the bearer token a legacy MCP server names by environment variable. The
// `MCP_CRED_` fence stops an admin pointing a server at DATABASE_URL and having
// the secret sent to their endpoint — or copied into its stored token.
export class EnvLegacyMcpCredentialSource implements ILegacyMcpCredentialSource {
  constructor(private readonly environment: Record<string, string | undefined> = process.env) {}

  read(credentialRef: string): string | null {
    if (!isValidMcpCredentialRef(credentialRef)) return null;
    const token = this.environment[credentialRef];
    return token ? token : null;
  }
}
