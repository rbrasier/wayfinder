import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AI_CONFIG_SETTING_KEY,
  CONNECTIVITY_TARGETS,
  DOCUMENT_GENERATION_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
  EMBEDDINGS_CONFIG_SETTING_KEY,
  N8N_CONFIG_SETTING_KEY,
  NOTIFICATION_PREFS_SETTING_KEY,
  REGISTRATION_ENABLED_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  EXTRACTION_CONFIG_SETTING_KEY,
  SIEM_CONFIG_SETTING_KEY,
  SITE_BANNER_CONFIG_SETTING_KEY,
  ABOUT_LINKS_SETTING_KEY,
  ABOUT_LINK_ICONS,
  SITE_BANNER_MAX_TEXT_SIZE_PT,
  SITE_BANNER_MIN_TEXT_SIZE_PT,
  STORAGE_CONFIG_SETTING_KEY,
  type SiemConfig,
  isAiConfigured,
  isAtLeastOneMethodEnabled,
  isEmailConfigured,
  isN8nConfigured,
  isStorageConfigured,
  normaliseSiteBannerLinkUrl,
  normaliseAboutLinkUrl,
  type AiConfig,
  type AiPurpose,
  type BedrockCredentials,
  type ConnectivityTarget,
  type EmailConfig,
  type N8nConfig,
  type NotificationPreferences,
  type ProviderName,
  type StorageConfig,
} from "@rbrasier/domain";
import {
  EMBEDDINGS_DEFAULT_MODELS,
  EMBEDDINGS_DIMENSION,
  EMBEDDINGS_PROVIDERS,
} from "@rbrasier/shared";
import { DEFAULT_MODELS_FOR, RuntimeConfigStore, resolveContextWindow } from "@rbrasier/adapters";
import { adminProcedure, publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { authSettingsProcedures } from "./settings-auth";
import { apiKeyState } from "./settings-secrets";
import { getReindexStatus, startReindex } from "@/lib/reindex-runner";

const providerSchema = z.enum(["anthropic", "openai", "mistral", "bedrock"]);

const bedrockInputSchema = z
  .object({
    region: z.string().optional().nullable(),
    accessKeyId: z.string().optional().nullable(),
    secretAccessKey: z.string().optional().nullable(),
  })
  .nullable()
  .optional();

const aiConfigInputSchema = z.object({
  provider: providerSchema,
  apiKeys: z.object({
    anthropic: z.string().nullable().optional(),
    openai: z.string().nullable().optional(),
    mistral: z.string().nullable().optional(),
    bedrock: bedrockInputSchema,
  }),
  models: z.object({
    chat: z.string().min(1),
    documentGeneration: z.string().min(1),
    branching: z.string().min(1),
  }),
});

const storageConfigInputSchema = z
  .object({
    endpoint: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    useSSL: z.boolean(),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    bucket: z.string().min(1),
    // Legitimately blank for MinIO, which ignores it.
    region: z.string(),
    pathStyle: z.boolean(),
  })
  .refine((config) => config.pathStyle || config.region.length > 0, {
    message: "A region is required for virtual-hosted addressing (Amazon S3).",
    path: ["region"],
  });

const n8nConfigInputSchema = z.object({
  baseUrl: z.string().url(),
  // Empty/omitted apiKey keeps the stored one — admins can't read it back.
  apiKey: z.string().nullable().optional(),
});

const sessionUploadConfigInputSchema = z.object({
  maxFileSizeBytes: z.number().int().positive(),
  totalBudgetChars: z.number().int().positive(),
});

const hexColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #dc2626");

// Mirrors normaliseSiteBannerLinkUrl: the value becomes an href, so only
// http(s) and site-relative paths are accepted. An admin gets a validation
// error here rather than the silent fallback the read path applies.
const siteBannerLinkUrlSchema = z.string().refine(
  (value) => value.length === 0 || normaliseSiteBannerLinkUrl(value) === value.trim(),
  "Enter a full https:// or http:// URL, or a path starting with /",
);

export const siteBannerConfigInputSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(300),
  textSizePt: z.number().int().min(SITE_BANNER_MIN_TEXT_SIZE_PT).max(SITE_BANNER_MAX_TEXT_SIZE_PT),
  textColour: hexColourSchema,
  backgroundColour: hexColourSchema,
  linkUrl: siteBannerLinkUrlSchema,
  linkLabel: z.string().max(60),
});

// One row per configured About entry. The URL is validated the same way the
// read path normalises it, so an admin sees a rejection rather than a link that
// silently disappears from the modal.
export const aboutLinksInputSchema = z.object({
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Give the link some text").max(60),
        url: z
          .string()
          .trim()
          .refine(
            (value) => normaliseAboutLinkUrl(value) === value.trim() && value.trim().length > 0,
            "Enter a full https:// or http:// URL, a mailto: address, or a path starting with /",
          ),
        icon: z.enum(ABOUT_LINK_ICONS),
        showInHelpMenu: z.boolean(),
      }),
    )
    .max(12),
});

export const extractionConfigInputSchema = z.object({
  maxFilesPerRun: z.number().int().positive(),
  maxArchiveEntries: z.number().int().positive(),
  maxArchiveEntryBytes: z.number().int().positive(),
  maxArchiveTotalBytes: z.number().int().positive(),
  perRunCostCeilingUsd: z.number().nonnegative(),
});

export const documentGenerationConfigInputSchema = z.object({
  contextBudgetMode: z.enum(["tokens", "model_percent"]),
  contextBudgetTokens: z.number().int().positive(),
  contextBudgetPercent: z.number().int().min(1).max(100),
  fieldBatchSize: z.number().int().positive(),
  maxPromptTokens: z.number().int().positive(),
});

const emailConfigInputSchema = z.object({
  provider: z.enum(["smtp", "m365"]),
  host: z.string().default(""),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().default(""),
  // Empty secret means "keep the stored one" — admins can't read it back.
  password: z.string().nullable().optional(),
  fromAddress: z.string().email(),
  fromName: z.string().nullable().optional(),
  m365TenantId: z.string().default(""),
  m365ClientId: z.string().default(""),
  m365ClientSecret: z.string().nullable().optional(),
});

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  provider: "smtp",
  host: "",
  port: 587,
  secure: false,
  username: "",
  password: "",
  fromAddress: "",
  fromName: null,
  m365TenantId: "",
  m365ClientId: "",
  m365ClientSecret: "",
};

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  sessionComplete: true,
  flowShared: true,
};

const loadNotificationPrefs = async (
  systemSettings: { get: (key: string) => Promise<{ data?: { value: string } | null; error?: unknown }> },
): Promise<NotificationPreferences> => {
  const result = await systemSettings.get(NOTIFICATION_PREFS_SETTING_KEY);
  if (result.error || !result.data) return DEFAULT_NOTIFICATION_PREFS;
  try {
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(JSON.parse(result.data.value) as Partial<NotificationPreferences>) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
};

const loadEmailConfig = async (
  systemSettings: { get: (key: string) => Promise<{ data?: { value: string } | null; error?: unknown }> },
): Promise<EmailConfig> => {
  const result = await systemSettings.get(EMAIL_CONFIG_SETTING_KEY);
  if (result.error || !result.data) return DEFAULT_EMAIL_CONFIG;
  try {
    return { ...DEFAULT_EMAIL_CONFIG, ...(JSON.parse(result.data.value) as Partial<EmailConfig>) };
  } catch {
    return DEFAULT_EMAIL_CONFIG;
  }
};

const PURPOSES: AiPurpose[] = ["chat", "documentGeneration", "branching"];

type BedrockInput = {
  region?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
} | null | undefined;

const mergeBedrockCredentials = (
  incoming: BedrockInput,
  stored: BedrockCredentials | null,
): BedrockCredentials | null => {
  if (incoming === null || incoming === undefined) return stored;
  const region = incoming.region && incoming.region.length > 0 ? incoming.region : stored?.region;
  const accessKeyId =
    incoming.accessKeyId && incoming.accessKeyId.length > 0
      ? incoming.accessKeyId
      : stored?.accessKeyId;
  const secretAccessKey =
    incoming.secretAccessKey && incoming.secretAccessKey.length > 0
      ? incoming.secretAccessKey
      : stored?.secretAccessKey;
  if (!region || !accessKeyId || !secretAccessKey) return stored;
  return { region, accessKeyId, secretAccessKey };
};

/**
 * Merge incoming apiKeys with stored ones — if the client sends null/empty
 * for a key, keep the previously-stored value (so editing the modal doesn't
 * wipe an existing key the admin can't read back from a redacted display).
 */
export const mergeApiKeys = (
  incoming: {
    anthropic?: string | null;
    openai?: string | null;
    mistral?: string | null;
    bedrock?: BedrockInput;
  },
  stored: AiConfig["apiKeys"],
): AiConfig["apiKeys"] => ({
  anthropic: incoming.anthropic && incoming.anthropic.length > 0 ? incoming.anthropic : stored.anthropic,
  openai: incoming.openai && incoming.openai.length > 0 ? incoming.openai : stored.openai,
  mistral: incoming.mistral && incoming.mistral.length > 0 ? incoming.mistral : stored.mistral,
  bedrock: mergeBedrockCredentials(incoming.bedrock, stored.bedrock),
});

const bedrockState = (value: BedrockCredentials | null) => ({
  region: value?.region ?? null,
  accessKeyId: apiKeyState(value?.accessKeyId ?? null),
  secretAccessKey: apiKeyState(value?.secretAccessKey ?? null),
});

export const settingsRouter = router({
  get: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.get(input.key);
      if (result.error) throw toTrpcError(result.error);
      return result.data ?? null;
    }),

  set: adminProcedure
    .input(z.object({ key: z.string().min(1), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(input.key, input.value);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  getAiConfig: adminProcedure.query(async ({ ctx }) => {
    const config: AiConfig = await ctx.container.runtimeConfig.getAiConfig();
    return {
      provider: config.provider,
      models: config.models,
      apiKeys: {
        anthropic: apiKeyState(config.apiKeys.anthropic),
        openai: apiKeyState(config.apiKeys.openai),
        mistral: apiKeyState(config.apiKeys.mistral),
        bedrock: bedrockState(config.apiKeys.bedrock),
      },
      defaultModelsForProvider: DEFAULT_MODELS_FOR,
      purposes: PURPOSES,
    };
  }),

  setAiConfig: adminProcedure
    .input(aiConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current: AiConfig = await ctx.container.runtimeConfig.getAiConfig();
      const merged: AiConfig = {
        provider: input.provider as ProviderName,
        apiKeys: mergeApiKeys(input.apiKeys, current.apiKeys),
        models: input.models,
      };
      const result = await ctx.container.repos.systemSettings.set(
        AI_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateAi();
      return { ok: true };
    }),

  ...authSettingsProcedures,

  getN8nConfig: adminProcedure.query(async ({ ctx }) => {
    const config: N8nConfig = await ctx.container.runtimeConfig.getN8nConfig();
    return RuntimeConfigStore.redactN8n(config);
  }),

  setN8nConfig: adminProcedure
    .input(n8nConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current: N8nConfig = await ctx.container.runtimeConfig.getN8nConfig();
      const merged: N8nConfig = {
        baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
        apiKey: input.apiKey && input.apiKey.length > 0 ? input.apiKey : current.apiKey,
      };
      const result = await ctx.container.repos.systemSettings.set(
        N8N_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateN8n();
      return { ok: true };
    }),

  getStorageConfig: adminProcedure.query(async ({ ctx }) => {
    const config: StorageConfig = await ctx.container.runtimeConfig.getStorageConfig();
    return RuntimeConfigStore.redactStorage(config);
  }),

  setStorageConfig: adminProcedure
    .input(storageConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        STORAGE_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateStorage();
      return { ok: true };
    }),

  // Public so the /register page can check whether to render the form
  // without forcing the visitor to authenticate first.
  registrationEnabled: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.repos.systemSettings.get(
      REGISTRATION_ENABLED_SETTING_KEY,
    );
    if (result.error) throw toTrpcError(result.error);
    return { enabled: result.data?.value !== "false" };
  }),

  setRegistrationEnabled: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        REGISTRATION_ENABLED_SETTING_KEY,
        input.enabled ? "true" : "false",
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  getEmbeddingsConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getEmbeddingsConfig();
    return { ...config, dimension: EMBEDDINGS_DIMENSION };
  }),

  setEmbeddingsConfig: adminProcedure
    .input(z.object({ provider: z.enum(EMBEDDINGS_PROVIDERS) }))
    .mutation(async ({ ctx, input }) => {
      // Model is derived from the provider; switching providers requires
      // re-indexing existing documents (ADR-017 Decision 3).
      const config = { provider: input.provider, model: EMBEDDINGS_DEFAULT_MODELS[input.provider] };
      const result = await ctx.container.repos.systemSettings.set(
        EMBEDDINGS_CONFIG_SETTING_KEY,
        JSON.stringify(config),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateEmbeddings();
      return { ok: true };
    }),

  startReindex: adminProcedure.mutation(async ({ ctx }) => {
    return startReindex(ctx.container.useCases.reindexAllDocuments);
  }),

  reindexStatus: adminProcedure.query(() => getReindexStatus()),

  getSessionUploadConfig: adminProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getSessionUploadConfig();
  }),

  setSessionUploadConfig: adminProcedure
    .input(sessionUploadConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        SESSION_UPLOAD_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateSessionUpload();
      return { ok: true };
    }),

  // Public: the login and register pages need the banner too, and a site
  // warning carries no secret material.
  getSiteBanner: publicProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getSiteBannerConfig();
  }),

  setSiteBanner: adminProcedure
    .input(siteBannerConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        SITE_BANNER_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateSiteBanner();
      return { ok: true };
    }),

  // Authenticated rather than admin: every signed-in user sees these on the
  // About modal and in the help menu, and they carry no secret material.
  getAboutLinks: publicProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getAboutLinksConfig();
  }),

  setAboutLinks: adminProcedure
    .input(aboutLinksInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        ABOUT_LINKS_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateAboutLinks();
      return { ok: true };
    }),

  getExtractionConfig: adminProcedure.query(async ({ ctx }) => {
    return ctx.container.runtimeConfig.getExtractionConfig();
  }),

  setExtractionConfig: adminProcedure
    .input(extractionConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        EXTRACTION_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateExtraction();
      return { ok: true };
    }),

  getDocumentGenerationConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getDocumentGenerationConfig();
    const aiConfig = await ctx.container.runtimeConfig.getAiConfig();
    const contextWindow = resolveContextWindow(aiConfig.provider, aiConfig.models.documentGeneration);
    return {
      config,
      model: {
        provider: aiConfig.provider,
        model: aiConfig.models.documentGeneration,
        contextWindowTokens: contextWindow.tokens,
        estimated: contextWindow.estimated,
      },
    };
  }),

  setDocumentGenerationConfig: adminProcedure
    .input(documentGenerationConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        DOCUMENT_GENERATION_CONFIG_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateDocumentGeneration();
      return { ok: true };
    }),

  getEmailConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await loadEmailConfig(ctx.container.repos.systemSettings);
    return {
      provider: config.provider,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      fromAddress: config.fromAddress,
      fromName: config.fromName,
      password: apiKeyState(config.password ?? null),
      m365TenantId: config.m365TenantId,
      m365ClientId: config.m365ClientId,
      m365ClientSecret: apiKeyState(config.m365ClientSecret ?? null),
    };
  }),

  setEmailConfig: adminProcedure
    .input(emailConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await loadEmailConfig(ctx.container.repos.systemSettings);
      const merged: EmailConfig = {
        provider: input.provider,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username,
        password: input.password && input.password.length > 0 ? input.password : current.password,
        fromAddress: input.fromAddress,
        fromName: input.fromName && input.fromName.length > 0 ? input.fromName : null,
        m365TenantId: input.m365TenantId,
        m365ClientId: input.m365ClientId,
        m365ClientSecret:
          input.m365ClientSecret && input.m365ClientSecret.length > 0
            ? input.m365ClientSecret
            : current.m365ClientSecret,
      };
      const result = await ctx.container.repos.systemSettings.set(
        EMAIL_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  getNotificationPrefs: adminProcedure.query(async ({ ctx }) => {
    return loadNotificationPrefs(ctx.container.repos.systemSettings);
  }),

  setNotificationPrefs: adminProcedure
    .input(z.object({ sessionComplete: z.boolean(), flowShared: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.repos.systemSettings.set(
        NOTIFICATION_PREFS_SETTING_KEY,
        JSON.stringify(input),
      );
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  sendTestEmail: adminProcedure
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.services.emailSender.send({
        to: input.to,
        subject: "Wayfinder test email",
        text: "This is a test email from Wayfinder. Your SMTP configuration is working.",
      });
      if (result.error) throw toTrpcError(result.error);
      return { ok: true };
    }),

  testConnectivity: adminProcedure
    .input(
      z.object({
        target: z.enum([...CONNECTIVITY_TARGETS] as [ConnectivityTarget, ...ConnectivityTarget[]]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.connectivityTester.test(input.target);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  testAllConnectivity: adminProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.connectivityTester.testAll();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  getSiemConfig: adminProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getSiemConfig();
    return RuntimeConfigStore.redactSiem(config);
  }),

  setSiemConfig: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        endpoint: z.string(),
        format: z.enum(["json", "cef"]),
        // Empty/omitted token keeps the stored one — admins can't read it back.
        token: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.enabled && input.endpoint.trim().length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A SIEM endpoint is required to enable streaming.",
        });
      }
      const current = await ctx.container.runtimeConfig.getSiemConfig();
      const merged: SiemConfig = {
        enabled: input.enabled,
        endpoint: input.endpoint.trim(),
        format: input.format,
        token: input.token && input.token.length > 0 ? input.token : current.token,
      };
      const result = await ctx.container.repos.systemSettings.set(
        SIEM_CONFIG_SETTING_KEY,
        JSON.stringify(merged),
      );
      if (result.error) throw toTrpcError(result.error);
      ctx.container.runtimeConfig.invalidateSiem();
      return { ok: true };
    }),

  // ── First-run onboarding (ADR-041) ──────────────────────────────────────────

  getOnboardingState: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getOnboardingState.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  completeOnboarding: adminProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.container.useCases.completeOnboarding.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  getDeploymentConfig: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.getDeploymentConfig.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  setDeploymentConfig: adminProcedure
    .input(z.object({ multiOrganisation: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.setDeploymentConfig.execute({
        multiOrganisation: input.multiOrganisation,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  // Per-step configured state for the wizard (ADR-041 §2). "configured" means a
  // value is present from env or DB; the wizard treats a step as complete only
  // once its live Test also passes, so this read never claims "tested".
  getSetupStatus: adminProcedure.query(async ({ ctx }) => {
    const [storage, ai, auth, email, n8n, organisations] = await Promise.all([
      ctx.container.runtimeConfig.getStorageConfig(),
      ctx.container.runtimeConfig.getAiConfig(),
      ctx.container.runtimeConfig.getAuthConfig(),
      loadEmailConfig(ctx.container.repos.systemSettings),
      ctx.container.runtimeConfig.getN8nConfig(),
      ctx.container.useCases.listOrganisations.execute(),
    ]);

    return {
      encryptionKeyReady: ctx.container.env.SETTINGS_ENCRYPTION_KEY.length > 0,
      deployment: {
        organisationConfigured: !organisations.error && organisations.data.length > 0,
      },
      storage: { configured: isStorageConfigured(storage) },
      ai: { configured: isAiConfigured(ai) },
      auth: {
        configured: isAtLeastOneMethodEnabled(
          auth,
          ctx.container.runtimeConfig.isPkiEnvConfigured(),
        ),
        // Which methods the wizard must gate on: only enabled ones are tested
        // (ADR-042 §5), so turning one off is the escape hatch when its probe
        // fails for a transient reason.
        enabledMethods: {
          emailPassword: auth.emailPasswordEnabled,
          entra: auth.entraEnabled,
          pki: auth.pkiEnabled,
        },
      },
      email: { configured: isEmailConfigured(email) },
      n8n: { configured: isN8nConfigured(n8n) },
    };
  }),
});
