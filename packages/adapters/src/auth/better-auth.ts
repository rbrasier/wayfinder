import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isEntraConfigured, type AuthConfig as AuthMethodsConfig } from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_accounts, core_sessions, core_users, core_verification_tokens } from "../db/schema/core";
import { applyEntraPrecedence } from "./entra-precedence";
import { userInfoFromIdToken } from "./entra-user-info";

// PKI is deliberately absent: certificate sign-in is decided by the runtime
// auth config, not by the process's boot-time mechanism, and Better Auth never
// handled it in the first place (ADR-042 §3).
export type AuthMethod =
  | { readonly type: "email-password" }
  | { readonly type: "google-oauth" }
  | { readonly type: "other" };

export interface PasswordResetEmailRequest {
  readonly email: string;
  readonly recipientName: string | null;
  readonly resetUrl: string;
  readonly expiryMinutes: number;
}

export interface CreateAuthOptions {
  readonly secret: string;
  readonly baseURL: string;
  readonly adminSeedEmail: string | undefined;
  readonly authMethod: AuthMethod;
  readonly authConfig: AuthMethodsConfig;
  readonly entraAuthority?: string;
  // Wired whenever the app can send mail *in principle*, not only when email is
  // currently configured: this instance is rebuilt on auth-config changes alone,
  // so binding the endpoint's existence to email settings would leave reset dead
  // until a restart after an admin fills them in. The sender itself refuses when
  // no transport is configured, and the sign-in screen hides the entry point on
  // the same live check, so an unconfigured install still offers nothing.
  readonly sendPasswordResetEmail?: (request: PasswordResetEmailRequest) => Promise<void>;
}

// One hour. Long enough to survive a mail queue and a distracted user, short
// enough that a link left in an inbox stops working the same day.
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60;

export interface MicrosoftProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
  readonly authority?: string;
}

/**
 * Resolves Better Auth's Microsoft social-provider options from the runtime
 * auth config, or null when Entra must not be offered (disabled, or enabled
 * but missing credentials — fail closed per ADR-025).
 *
 * `authority` overrides the login.microsoftonline.com host every endpoint is
 * derived from. It exists for the local mock Entra server and for sovereign
 * clouds; it is env-only by design, so no admin can repoint the auth flow at an
 * arbitrary host from the settings UI.
 */
export const microsoftProviderFor = (
  authConfig: AuthMethodsConfig,
  authority?: string,
): MicrosoftProviderOptions | null => {
  if (!authConfig.entraEnabled) return null;
  if (!isEntraConfigured(authConfig.entra)) return null;
  return {
    clientId: authConfig.entra.clientId,
    clientSecret: authConfig.entra.clientSecret,
    tenantId: authConfig.entra.tenantId,
    ...(authority ? { authority } : {}),
  };
};

/**
 * Minimal structural surface of the Better Auth instance that this template
 * actually uses. Declared explicitly so TypeScript does not have to spell out
 * Better Auth's full inferred type — which transitively references zod's
 * internal modules and breaks portable declaration emit across packages.
 */
export interface Auth {
  readonly handler: (req: Request) => Promise<Response>;
  readonly api: Readonly<Record<string, unknown>>;
  // Better Auth's resolved runtime context, exposed so break-glass recovery can
  // hash a password with the provider's own hasher. Verified against
  // better-auth@1.6: `auth.$context` is the promise returned by `init`
  // (dist/auth/base.mjs), and `password.hash` there is the same function
  // sign-in verifies against (dist/context/create-context.mjs).
  readonly $context: Promise<AuthRuntimeContext>;
}

export interface AuthRuntimeContext {
  readonly password: {
    hash: (password: string) => Promise<string>;
  };
}

/**
 * Constructs a Better Auth instance backed by Drizzle.
 *
 * The first user signing in with ADMIN_SEED_EMAIL is promoted to admin via
 * `seedAdmin` — call it once from the app's container after migrations.
 */
export const createAuth = (db: Database, config: CreateAuthOptions): Auth => {
  if (config.authMethod.type === "google-oauth") {
    throw new Error(
      "google-oauth requires additional setup. See docs/guides/google-oauth.md for configuration steps.",
    );
  }

  const emailPasswordEnabled = config.authConfig.emailPasswordEnabled;
  const microsoftProvider = microsoftProviderFor(config.authConfig, config.entraAuthority);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: core_users,
        session: core_sessions,
        account: core_accounts,
        verification: core_verification_tokens,
      },
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    // Every core_* table declares `id` as a uuid column. Without this, Better
    // Auth supplies its own random string ids and Postgres rejects the insert
    // ("invalid input syntax for type uuid"). "uuid" emits gen_random_uuid().
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    user: {
      modelName: "user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // A first Entra sign-in whose email matches an existing user links to that
      // user instead of creating a duplicate (ADR-025).
      accountLinking: {
        enabled: true,
        trustedProviders: ["microsoft"],
        // Better Auth otherwise refuses to link unless the local row already has
        // `emailVerified: true`, which Wayfinder never sets — no verification
        // email is configured — so every password account was unreachable via
        // Entra. The gate protects against an attacker pre-registering at a
        // victim's address; `applyEntraPrecedence` below removes that attacker's
        // password and sessions at link time instead.
        requireLocalEmailVerified: false,
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        value: "token",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      autoSignIn: true,
      requireEmailVerification: false,
      // A reset means the old password is no longer trusted, so every live
      // session goes with it — the same stance the admin-initiated reset takes.
      revokeSessionsOnPasswordReset: true,
      ...(config.sendPasswordResetEmail
        ? {
            resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
            sendResetPassword: async (request: {
              user: { email: string; name?: string | null };
              url: string;
            }) => {
              await config.sendPasswordResetEmail?.({
                email: request.user.email,
                recipientName: request.user.name ?? null,
                resetUrl: request.url,
                expiryMinutes: PASSWORD_RESET_TOKEN_TTL_SECONDS / 60,
              });
            },
          }
        : {}),
    },
    databaseHooks: {
      account: {
        create: {
          // `before`, not `after`: Better Auth runs the whole request inside
          // `runWithAdapter`, which queues every `create.after` hook until the
          // request ends — past the point where the post-link session has been
          // issued. Revoking sessions from there kills the sign-in that
          // triggered the link. `create.before` is awaited inline instead.
          before: async (account) => {
            await applyEntraPrecedence(db, {
              userId: account.userId,
              providerId: account.providerId,
            });
          },
        },
      },
    },
    ...(microsoftProvider
      ? {
          socialProviders: {
            microsoft: {
              clientId: microsoftProvider.clientId,
              clientSecret: microsoftProvider.clientSecret,
              tenantId: microsoftProvider.tenantId,
              ...(microsoftProvider.authority
                ? {
                    authority: microsoftProvider.authority,
                    // A custom authority is not Microsoft Graph's tenant, and the
                    // stock profile-photo call is hardcoded to graph.microsoft.com
                    // and throws when unreachable. Read the identity from the id
                    // token instead.
                    getUserInfo: async (token: { idToken?: string }) =>
                      userInfoFromIdToken(token),
                  }
                : {}),
            },
          },
        }
      : {}),
  }) as unknown as Auth;
};
