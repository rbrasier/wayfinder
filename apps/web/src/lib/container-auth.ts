import { isIP } from "node:net";
import {
  BetterAuthPasswordResetter,
  createAuth,
  type Auth,
  type AuthMethod,
  type Database,
  type PkiEnvDefaults,
  type RuntimeConfigStore,
} from "@rbrasier/adapters";
import { SendPasswordResetEmail } from "@rbrasier/application";
import type { IEmailSender } from "@rbrasier/domain";

interface PkiEnv {
  AUTH_METHOD: string;
  PKI_TRUSTED_PROXY_IPS?: string | undefined;
  PKI_SESSION_TTL_HOURS: number;
}

export interface ResolvedPkiEnv {
  // The addresses the cert adapter enforces against — the one place in the app
  // that needs them.
  trustedProxyIps: string[];
  // Entries that were written but are not addresses, kept so boot can name them
  // rather than dropping them in silence.
  rejectedProxyEntries: string[];
  authMethodNamesPki: boolean;
  // What config resolution is allowed to see: booleans and a number, never the
  // addresses (ADR-042 §1).
  envDefaults: PkiEnvDefaults;
}

/**
 * Resolves PKI's environment half once, for both the trust anchor and the
 * config gate.
 *
 * Entries that are not real addresses are dropped, so a stray
 * `PKI_TRUSTED_PROXY_IPS=,` cannot pass for a trust anchor and then fail to
 * match any request. A hostname is dropped for the same reason: the check
 * compares against the source IP of the incoming request, so `localhost` could
 * never match anything, however reasonable it looks in a `.env`.
 */
export const resolvePkiEnv = (env: PkiEnv): ResolvedPkiEnv => {
  const entries = (env.PKI_TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const trustedProxyIps = entries.filter((entry) => isIP(entry) !== 0);
  const rejectedProxyEntries = entries.filter((entry) => isIP(entry) === 0);
  const authMethodNamesPki =
    env.AUTH_METHOD === "pki" || env.AUTH_METHOD === "pki-and-email-password";

  return {
    trustedProxyIps,
    rejectedProxyEntries,
    authMethodNamesPki,
    envDefaults: {
      authMethodNamesPki,
      hasTrustedProxies: trustedProxyIps.length > 0,
      sessionTtlHours: env.PKI_SESSION_TTL_HOURS,
    },
  };
};

/**
 * Names entries that were written into `PKI_TRUSTED_PROXY_IPS` but are not
 * addresses. Dropping them is correct — the check compares against a source IP
 * — but doing it silently leaves an operator staring at a trusted-proxy
 * rejection with a variable that looks correctly set.
 */
export const warnOnRejectedProxyEntries = (
  logger: { warn: (message: string) => void },
  rejectedProxyEntries: string[],
): void => {
  if (rejectedProxyEntries.length === 0) return;
  logger.warn(
    `PKI_TRUSTED_PROXY_IPS ignored ${rejectedProxyEntries.length} entry/entries that are not IP addresses: ${rejectedProxyEntries.join(", ")}. The trusted-proxy check compares against the request's source IP, so hostnames never match — use the proxy's address (127.0.0.1 for a local proxy).`,
  );
};

/**
 * `AUTH_METHOD` seeds a default and decides nothing else, so it can end up
 * naming PKI while the stored config has it off. Say so once at boot rather than
 * leaving an operator to work it out from a sign-in button that never appears
 * (ADR-042 §3).
 */
export const warnOnLegacyAuthMethodContradiction = (
  runtimeConfig: Pick<RuntimeConfigStore, "getAuthConfig">,
  logger: { warn: (message: string) => void },
  authMethodNamesPki: boolean,
): void => {
  if (!authMethodNamesPki) return;
  void runtimeConfig
    .getAuthConfig()
    .then((authConfig) => {
      if (authConfig.pkiEnabled) return;
      logger.warn(
        "AUTH_METHOD names PKI but certificate sign-in is disabled in settings — settings win; the variable only seeds the initial default",
      );
    })
    .catch(() => {
      // Best-effort: a config read failing at boot is already surfaced by
      // whichever request needs it.
    });
};

// PKI is absent by design: certificate sign-in is decided by runtime config, not
// by the process's boot-time mechanism (ADR-042 §3).
export const resolveAuthMethod = (authMethod: string): AuthMethod => {
  switch (authMethod) {
    case "google-oauth":
      return { type: "google-oauth" as const };
    case "other":
      return { type: "other" as const };
    default:
      return { type: "email-password" as const };
  }
};

export interface AuthRuntimeDependencies {
  readonly db: Database;
  readonly runtimeConfig: RuntimeConfigStore;
  readonly emailSender: IEmailSender;
  readonly authMethod: AuthMethod;
  readonly secret: string;
  readonly baseURL: string;
  readonly adminSeedEmail: string | undefined;
  readonly entraAuthority: string | undefined;
}

export interface AuthRuntime {
  readonly getAuth: () => Promise<Auth>;
  readonly passwordResetter: BetterAuthPasswordResetter;
  readonly sendPasswordResetEmail: SendPasswordResetEmail;
}

/**
 * Builds the auth half of the container: the lazily-rebuilt Better Auth
 * instance and the two password paths that hang off it.
 *
 * Lives here rather than inline in `container.ts` to keep that file under the
 * source-size ceiling, and because everything in it shares one concern —
 * resolving the current auth configuration.
 */
export const buildAuthRuntime = (dependencies: AuthRuntimeDependencies): AuthRuntime => {
  const sendPasswordResetEmail = new SendPasswordResetEmail(dependencies.emailSender);

  // The instance reflects the runtime auth config, so it is built lazily and
  // rebuilt whenever the config is invalidated (ADR-025). The auth route
  // resolves the current instance per request — a settings change applies on the
  // next request with no process restart.
  let authInstance: Auth | null = null;
  let builtAuthVersion = -1;

  const buildAuth = async (): Promise<Auth> => {
    const authConfig = await dependencies.runtimeConfig.getAuthConfig();
    return createAuth(dependencies.db, {
      secret: dependencies.secret,
      baseURL: dependencies.baseURL,
      adminSeedEmail: dependencies.adminSeedEmail,
      authMethod: dependencies.authMethod,
      authConfig,
      entraAuthority: dependencies.entraAuthority,
      // Errors are swallowed on purpose: Better Auth answers a reset request
      // with the same "if this address exists" message either way, so letting a
      // bounce surface here would turn the form into an address oracle. The
      // failed send is already recorded by the sender.
      sendPasswordResetEmail: async (request) => {
        await sendPasswordResetEmail.execute(request);
      },
    });
  };

  const getAuth = async (): Promise<Auth> => {
    const version = dependencies.runtimeConfig.getAuthVersion();
    if (authInstance && builtAuthVersion === version) return authInstance;
    authInstance = await buildAuth();
    builtAuthVersion = version;
    return authInstance;
  };

  return {
    getAuth,
    // Administrator-initiated reset (not the break-glass CLI path): hashes
    // through the live instance, so a config change that rebuilds it cannot
    // leave resets writing a stale hash format.
    passwordResetter: new BetterAuthPasswordResetter({ database: dependencies.db, getAuth }),
    sendPasswordResetEmail,
  };
};
