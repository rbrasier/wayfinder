import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DIRECTORY_CONFIG_SETTING_KEY,
  isEntraConfigured,
  type DirectoryConfig,
} from "@rbrasier/domain";
import { RuntimeConfigStore } from "@rbrasier/adapters";
import { adminProcedure } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// The approver-directory card's input contract, kept beside the merge it feeds
// so the two stay in step when a credential source is added.
//
// Deliberately absent: the Graph base URL and the token authority. Those decide
// *where* a client secret is sent, so they stay in the environment where an
// admin cannot repoint them — the same split ADR-042 draws for the PKI trusted
// proxy list. Zod strips unknown keys, so a crafted request carrying either is
// dropped rather than honoured.
export const directoryConfigInputSchema = z.object({
  enabled: z.boolean(),
  credentialSource: z.enum(["email", "auth", "own"]),
  entra: z.object({
    tenantId: z.string().default(""),
    clientId: z.string().default(""),
    // Empty/omitted secret keeps the stored one — admins can't read it back.
    clientSecret: z.string().nullable().optional(),
  }),
});

type DirectoryConfigInput = {
  enabled: boolean;
  credentialSource: DirectoryConfig["credentialSource"];
  entra: { tenantId: string; clientId: string; clientSecret?: string | null };
};

/**
 * Merge an incoming directory config with the stored one. A blank/omitted secret
 * keeps the previously-stored value so saving the form does not wipe a secret
 * the admin can never read back from the redacted display.
 */
export const mergeDirectoryConfig = (
  incoming: DirectoryConfigInput,
  stored: DirectoryConfig,
): DirectoryConfig => ({
  enabled: incoming.enabled,
  credentialSource: incoming.credentialSource,
  // An inherited source hides the separate-credential fields, so the form sends
  // them blank. Keeping what is stored means an admin who switches away and back
  // finds their credentials intact, rather than silently wiping them by saving a
  // form that never showed them.
  entra:
    incoming.credentialSource === "own"
      ? {
          tenantId: incoming.entra.tenantId,
          clientId: incoming.entra.clientId,
          clientSecret:
            incoming.entra.clientSecret && incoming.entra.clientSecret.length > 0
              ? incoming.entra.clientSecret
              : stored.entra.clientSecret,
        }
      : stored.entra,
});

// The card's two procedures live here rather than in settings.ts, which is at
// the source-size ratchet's limit. Spread into the settings router, so the
// client still calls settings.getDirectoryConfig / settings.setDirectoryConfig.
export const directorySettingsProcedures = {
  getDirectoryConfig: adminProcedure.query(async ({ ctx }) => {
    const [config, email, auth] = await Promise.all([
      ctx.container.runtimeConfig.getDirectoryConfig(),
      ctx.container.runtimeConfig.getEmailConfig(),
      ctx.container.runtimeConfig.getAuthConfig(),
    ]);
    return {
      ...RuntimeConfigStore.redactDirectory(config),
      // Whether each inherited source has credentials to inherit, so the form can
      // say "not configured yet" instead of letting an admin pick a source that
      // resolves to nothing.
      sources: {
        email: isEntraConfigured({
          tenantId: email.m365TenantId,
          clientId: email.m365ClientId,
          clientSecret: email.m365ClientSecret,
        }),
        auth: isEntraConfigured(auth.entra),
      },
      // Whether a live directory would actually result from what is stored —
      // covers the M365_* environment fallback the redacted config cannot show.
      resolves: (await ctx.container.runtimeConfig.getDirectoryCredentials()) !== null,
    };
  }),

  setDirectoryConfig: adminProcedure
    .input(directoryConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.container.runtimeConfig.getDirectoryConfig();
      const merged = mergeDirectoryConfig(input, current);

      // Enabling a directory whose chosen source has no credentials would leave
      // resolution silently on the HR fallback with the card reporting "On".
      if (merged.enabled && merged.credentialSource === "own" && !isEntraConfigured(merged.entra)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Separate credentials need a tenant ID, a client ID and a client secret before the directory can be enabled.",
        });
      }

      const result = await ctx.container.repos.systemSettings.set(
        DIRECTORY_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateDirectory();
      return { ok: true };
    }),
};
