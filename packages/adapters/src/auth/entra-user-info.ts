import { normaliseEmail } from "@rbrasier/domain";

export interface EntraUserInfo {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
  };
  readonly data: Record<string, unknown>;
}

const decodeClaims = (idToken: string): Record<string, unknown> | null => {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const claims: unknown = JSON.parse(decoded);
    if (!claims || typeof claims !== "object") return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

// Tenants have been observed emitting xms_edov as a boolean, as a string and as
// a number, so read all three rather than trusting one spelling.
const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true" || normalised === "1") return true;
    if (normalised === "false" || normalised === "0") return false;
  }
  return null;
};

/**
 * Whether the address may be trusted as the user's own.
 *
 * Entra does not emit `email_verified` — that is a generic OIDC claim, and
 * reading it left every Entra account unverified, which silently disabled
 * email-domain organisation assignment for exactly the users it was meant for.
 *
 * The authoritative Entra signal is `xms_edov` ("email domain owner verified"),
 * so an explicit value there decides it either way. Absent both claims the
 * identity is trusted: the address comes from the tenant directory rather than
 * being self-asserted, and an app registration created after June 2023 omits
 * the `email` claim altogether when the address is unverified.
 *
 * This trust rests on the deployment pinning a single tenant, which is what
 * `ENTRA_TENANT_ID` / the admin Authentication card configure. A deployment that
 * points `tenantId` at `common` or `organizations` accepts identities from
 * tenants it does not control, where an unverified address is an account-linking
 * risk (the nOAuth pattern) — there, `xms_edov` should be turned on for the app
 * registration so the claim decides rather than this fallback.
 */
const emailVerifiedFrom = (claims: Record<string, unknown>): boolean =>
  asBoolean(claims.xms_edov) ?? asBoolean(claims.email_verified) ?? true;

/**
 * Resolves the signed-in identity from the id token alone.
 *
 * Better Auth's stock Microsoft `getUserInfo` also calls Microsoft Graph for a
 * profile photo, against a hardcoded graph.microsoft.com. That call is not
 * optional and `betterFetch` throws when the host is unreachable, so sign-in
 * fails outright on a machine that cannot reach Graph — which is every offline
 * developer and the local mock identity provider. Wherever the authority has
 * been overridden, Graph is not the right host anyway.
 *
 * No signature check: the token was just fetched over TLS in a direct
 * server-to-server code exchange, which is the same basis on which Better
 * Auth's own implementation decodes it without verifying.
 */
export const userInfoFromIdToken = (token: { idToken?: string }): EntraUserInfo | null => {
  if (!token.idToken) return null;

  const claims = decodeClaims(token.idToken);
  if (!claims) return null;

  const email = asString(claims.email) ?? asString(claims.preferred_username);
  if (!email) return null;

  const subject = asString(claims.sub);
  if (!subject) return null;

  return {
    user: {
      id: subject,
      name: asString(claims.name) ?? email,
      email: normaliseEmail(email),
      emailVerified: emailVerifiedFrom(claims),
    },
    data: claims,
  };
};
