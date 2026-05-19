import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import type { Database } from "../db/client";
import type { PkiConfig } from "./pki-cert-adapter";

export type AuthMethod =
  | {
      readonly type: "magic-link";
      readonly sendMagicLink: (params: { email: string; url: string }) => Promise<void>;
    }
  | { readonly type: "pki"; readonly pkiConfig: PkiConfig }
  | {
      readonly type: "pki-and-magic-link";
      readonly pkiConfig: PkiConfig;
      readonly sendMagicLink: (params: { email: string; url: string }) => Promise<void>;
    }
  | { readonly type: "google-oauth" }
  | { readonly type: "other" };

export interface AuthConfig {
  readonly secret: string;
  readonly baseURL: string;
  readonly adminSeedEmail: string | undefined;
  readonly authMethod: AuthMethod;
}

/**
 * Minimal structural surface of the Better Auth instance that this template
 * actually uses. Declared explicitly so TypeScript does not have to spell out
 * Better Auth's full inferred type — which transitively references zod's
 * internal modules and breaks portable declaration emit across packages.
 *
 * Add fields here as the auth surface grows.
 */
export interface Auth {
  readonly handler: (req: Request) => Promise<Response>;
  readonly api: Readonly<Record<string, unknown>>;
}

/**
 * Constructs a Better Auth instance backed by Drizzle.
 *
 * The first user signing in with ADMIN_SEED_EMAIL is promoted to admin via
 * `seedAdmin` — call it once from the app's container after migrations.
 */
export const createAuth = (db: Database, config: AuthConfig): Auth => {
  if (config.authMethod.type === "google-oauth") {
    throw new Error(
      "google-oauth requires additional setup. See docs/guides/google-oauth.md for configuration steps.",
    );
  }

  const plugins = [];

  if (
    config.authMethod.type === "magic-link" ||
    config.authMethod.type === "pki-and-magic-link"
  ) {
    const { sendMagicLink } = config.authMethod;
    plugins.push(
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLink({ email, url });
        },
      }),
    );
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: config.secret,
    baseURL: config.baseURL,
    plugins,
  }) as unknown as Auth;
};
