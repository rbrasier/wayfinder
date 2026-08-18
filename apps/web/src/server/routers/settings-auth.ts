import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AUTH_CONFIG_SETTING_KEY,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
  isPkiUsable,
  sessionPolicyViolations,
  type AuthConfig,
} from "@rbrasier/domain";
import { adminProcedure, publicProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { apiKeyState } from "./settings-secrets";

// The auth card's input contract, kept beside the merge it feeds so the two
// stay in step when a method is added.
export const authConfigInputSchema = z.object({
  emailPasswordEnabled: z.boolean(),
  entraEnabled: z.boolean(),
  entra: z.object({
    tenantId: z.string().default(""),
    clientId: z.string().default(""),
    // Empty/omitted secret keeps the stored one — admins can't read it back.
    clientSecret: z.string().nullable().optional(),
  }),
  // Omitted by an older client: keep whatever is stored rather than reading the
  // absence as "turn PKI off".
  pkiEnabled: z.boolean().optional(),
  pki: z
    .object({
      sessionTtlHours: z.number().int().positive().max(24 * 30),
    })
    .optional(),
});

type AuthConfigInput = {
  emailPasswordEnabled: boolean;
  entraEnabled: boolean;
  entra: { tenantId: string; clientId: string; clientSecret?: string | null };
  pkiEnabled?: boolean;
  pki?: { sessionTtlHours: number };
};

/**
 * Merge an incoming auth config with the stored one. A blank/omitted secret
 * keeps the previously-stored value so saving the form does not wipe a secret
 * the admin can never read back from the redacted display.
 */
export const mergeAuthConfig = (incoming: AuthConfigInput, stored: AuthConfig): AuthConfig => ({
  emailPasswordEnabled: incoming.emailPasswordEnabled,
  entraEnabled: incoming.entraEnabled,
  entra: {
    tenantId: incoming.entra.tenantId,
    clientId: incoming.entra.clientId,
    clientSecret:
      incoming.entra.clientSecret && incoming.entra.clientSecret.length > 0
        ? incoming.entra.clientSecret
        : stored.entra.clientSecret,
  },
  pkiEnabled: incoming.pkiEnabled ?? stored.pkiEnabled,
  pki: { sessionTtlHours: incoming.pki?.sessionTtlHours ?? stored.pki.sessionTtlHours },
  // Carried through untouched: the session policy shares this row but has its
  // own card and its own procedures, so saving auth methods must never rewrite
  // it (ADR-035 §4).
  sessionPolicy: stored.sessionPolicy,
});

// Minutes and counts only — the wider "is this policy sane" question belongs to
// the domain, which the router asks through sessionPolicyViolations.
export const sessionPolicyInputSchema = z.object({
  idleTimeoutMinutes: z.number().int().min(0).max(60 * 24 * 30),
  absoluteTimeoutMinutes: z.number().int().min(0).max(60 * 24 * 30),
  concurrentSessionLimit: z.number().int().min(0).max(100),
  evictionStrategy: z.enum(["evict_oldest", "refuse"]),
});

// Everything the settings router exposes for sign-in methods and session
// lifecycle, kept beside the schemas and the merge they depend on. Spread into
// the settings router so the client-facing procedure names are unchanged.
export const authSettingsProcedures = {
  getAuthConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getAuthConfig();
    return {
      emailPasswordEnabled: config.emailPasswordEnabled,
      entraEnabled: config.entraEnabled,
      entra: {
        tenantId: config.entra.tenantId,
        clientId: config.entra.clientId,
        clientSecret: apiKeyState(config.entra.clientSecret),
      },
      pkiEnabled: config.pkiEnabled,
      pki: {
        sessionTtlHours: config.pki.sessionTtlHours,
        // The boolean only. An admin-scoped response is still a network
        // payload, and the client has no business knowing which addresses the
        // trust anchor names (ADR-042 §1).
        envConfigured: ctx.container.runtimeConfig.isPkiEnvConfigured(),
      },
      redirectUri: `${ctx.container.env.BETTER_AUTH_URL}/api/auth/callback/microsoft`,
    };
  }),

  setAuthConfig: adminProcedure
    .input(authConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.container.runtimeConfig.getAuthConfig();
      const merged = mergeAuthConfig(input, current);
      const envHasTrustedProxies = ctx.container.runtimeConfig.isPkiEnvConfigured();

      // A disabled checkbox is a UI affordance, not an authorisation check.
      if (merged.pkiEnabled && !envHasTrustedProxies) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Certificate sign-in cannot be enabled until PKI_TRUSTED_PROXY_IPS is set in the environment.",
        });
      }

      if (!isAtLeastOneMethodEnabled(merged, envHasTrustedProxies)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "At least one usable sign-in method must stay enabled. Certificate sign-in does not count while PKI_TRUSTED_PROXY_IPS is unset.",
        });
      }
      const result = await ctx.container.repos.systemSettings.set(
        AUTH_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateAuth();
      return { ok: true };
    }),

  getSessionPolicy: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getAuthConfig();
    return config.sessionPolicy;
  }),

  setSessionPolicy: adminProcedure
    .input(sessionPolicyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const violations = sessionPolicyViolations(input);
      if (violations.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: violations.join(" ") });
      }

      const current = await ctx.container.runtimeConfig.getAuthConfig();
      const result = await ctx.container.repos.systemSettings.set(
        AUTH_CONFIG_SETTING_KEY,
        JSON.stringify({ ...current, sessionPolicy: input }),
      );
      if (result.error) throw toTrpcError(result.error);
      // The policy rides the auth config, so this is the invalidation that
      // applies it — there is no separate session-policy cache (ADR-035 §4).
      ctx.container.runtimeConfig.invalidateAuth();
      return { ok: true };
    }),

  // Public so the unauthenticated /login page can render the right controls.
  enabledAuthMethods: publicProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getAuthConfig();
    return {
      emailPassword: config.emailPasswordEnabled,
      entra: config.entraEnabled && isEntraConfigured(config.entra),
      pki: isPkiUsable(config, ctx.container.runtimeConfig.isPkiEnvConfigured()),
    };
  }),
};
