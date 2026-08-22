import type { EntraCredentials } from "@rbrasier/domain";
import type { ServerEnv } from "./env";

// The two Microsoft app registrations the environment can supply, read out of
// `ServerEnv` in one place rather than inline in container.ts. Both are
// fallbacks: what an admin saves at /admin/settings wins (ADR-041 §2).
//
// A partial set reads as absent rather than as a broken registration — two of
// three values authenticate nothing, and an `undefined` here lets the runtime
// config store fall back to its own defaults.
const credentialsFrom = (
  tenantId: string | undefined,
  clientId: string | undefined,
  clientSecret: string | undefined,
): EntraCredentials | undefined =>
  tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : undefined;

// ENTRA_* — the sign-in registration. A complete set switches Entra sign-in on
// by itself, so an env-only deployment needs no DB row (ADR-025 §1).
export const entraEnvCredentials = (env: ServerEnv): EntraCredentials | undefined =>
  credentialsFrom(env.ENTRA_TENANT_ID, env.ENTRA_CLIENT_ID, env.ENTRA_CLIENT_SECRET);

// M365_* — the email transport's registration, which the approver directory
// inherits by default. A complete set is what keeps an install that configured
// Graph through the environment resolving after the upgrade, with no DB row and
// no admin action.
export const m365EnvCredentials = (env: ServerEnv): EntraCredentials | undefined =>
  credentialsFrom(env.M365_TENANT_ID, env.M365_CLIENT_ID, env.M365_CLIENT_SECRET);
