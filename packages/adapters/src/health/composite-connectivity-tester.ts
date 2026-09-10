import {
  domainError,
  err,
  ok,
  CONNECTIVITY_TARGETS,
  type AiConfig,
  type AuthConfig,
  type ConnectivityResult,
  type ConnectivityTarget,
  type EmbeddingsConfig,
  type IConnectivityTester,
  type IEmbeddingsProvider,
  type N8nConfig,
  type Result,
  type StorageConfig,
} from "@wayfinder/domain";
import {
  probeAiConnectivity,
  probeAuthEmailPassword,
  probeAuthEntra,
  probeAuthPki,
  probeEmailConnectivity,
  probeEmbeddingsConnectivity,
  probeEntraConnectivity,
  probeN8nConnectivity,
  probeStorageConnectivity,
  type CredentialAccountProbe,
  type EmailProbe,
  type GraphProbe,
  type MinioClientFactory,
} from "./connectivity-probes";

interface RuntimeConfigSource {
  getAiConfig(): Promise<AiConfig>;
  getStorageConfig(): Promise<StorageConfig>;
  getN8nConfig(): Promise<N8nConfig>;
  getEmbeddingsConfig(): Promise<EmbeddingsConfig>;
  getAuthConfig(): Promise<AuthConfig>;
  // The PKI environment gate as a boolean — the addresses themselves never
  // reach a probe (ADR-042 §3).
  isPkiEnvConfigured(): boolean;
}

export interface ConnectivityTesterDeps {
  runtimeConfig: RuntimeConfigSource;
  emailSender: EmailProbe;
  graphClient: GraphProbe;
  embeddingsProvider: IEmbeddingsProvider;
  // Embeddings' OpenAI provider uses the environment key, kept separate from the
  // admin-set AI provider key.
  openaiApiKey: string | null;
  // Counts accounts that carry a password, for the email + password sign-in
  // probe: the method can be enabled with nobody able to use it.
  credentialAccounts: CredentialAccountProbe;
  // Sign-in authority override, matching the one the Entra provider uses.
  entraAuthority?: string;
  fetchFn?: typeof fetch;
  minioClientFactory?: MinioClientFactory;
  timeoutMs?: number;
}

// Mirrors CompositeHealthChecker: holds the integration dependencies and
// dispatches per target. Each probe maps its own failures into a
// ConnectivityResult, so the only throws caught here are unexpected ones (e.g. a
// config lookup failing) — never a probe rejecting across the boundary.
export class CompositeConnectivityTester implements IConnectivityTester {
  constructor(private readonly deps: ConnectivityTesterDeps) {}

  async test(target: ConnectivityTarget): Promise<Result<ConnectivityResult>> {
    try {
      return ok(await this.runProbe(target));
    } catch (cause) {
      return err(
        domainError("INFRA_FAILURE", `Connectivity probe for '${target}' threw unexpectedly.`, cause),
      );
    }
  }

  async testAll(): Promise<Result<ConnectivityResult[]>> {
    try {
      const results = await Promise.all(CONNECTIVITY_TARGETS.map((target) => this.runProbe(target)));
      return ok(results);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Connectivity probes threw unexpectedly.", cause));
    }
  }

  private async runProbe(target: ConnectivityTarget): Promise<ConnectivityResult> {
    const { deps } = this;
    const timeoutMs = deps.timeoutMs;
    switch (target) {
      case "ai":
        return probeAiConnectivity(await deps.runtimeConfig.getAiConfig(), {
          fetchFn: deps.fetchFn,
          timeoutMs,
        });
      case "storage":
        return probeStorageConnectivity(await deps.runtimeConfig.getStorageConfig(), {
          clientFactory: deps.minioClientFactory,
          timeoutMs,
        });
      case "n8n":
        return probeN8nConnectivity(await deps.runtimeConfig.getN8nConfig(), {
          fetchFn: deps.fetchFn,
          timeoutMs,
        });
      case "embeddings":
        return probeEmbeddingsConnectivity(await deps.runtimeConfig.getEmbeddingsConfig(), {
          embeddingsProvider: deps.embeddingsProvider,
          openaiApiKey: deps.openaiApiKey,
          fetchFn: deps.fetchFn,
          timeoutMs,
        });
      case "email":
        return probeEmailConnectivity(deps.emailSender, { timeoutMs });
      case "entra":
        return probeEntraConnectivity(deps.graphClient, { timeoutMs });
      case "auth-entra":
        return probeAuthEntra(await deps.runtimeConfig.getAuthConfig(), {
          fetchFn: deps.fetchFn,
          timeoutMs,
          authority: deps.entraAuthority,
        });
      case "auth-pki":
        return probeAuthPki(
          await deps.runtimeConfig.getAuthConfig(),
          deps.runtimeConfig.isPkiEnvConfigured(),
        );
      case "auth-email-password":
        return probeAuthEmailPassword(
          await deps.runtimeConfig.getAuthConfig(),
          deps.credentialAccounts,
        );
    }
  }
}
