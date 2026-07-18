import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AI_CONFIG_SETTING_KEY,
  CONNECTIVITY_TARGETS,
  AUTH_CONFIG_SETTING_KEY,
  DOCUMENT_GENERATION_CONFIG_SETTING_KEY,
  EMAIL_CONFIG_SETTING_KEY,
  EMBEDDINGS_CONFIG_SETTING_KEY,
  N8N_CONFIG_SETTING_KEY,
  NOTIFICATION_PREFS_SETTING_KEY,
  REGISTRATION_ENABLED_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  SIEM_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  type SiemConfig,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
  type AiConfig,
  type AiPurpose,
  type AuthConfig,
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

const storageConfigInputSchema = z.object({
  endpoint: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  useSSL: z.boolean(),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  bucket: z.string().min(1),
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

const apiKeyState = (value: string | null): "set" | "unset" =>
  value && value.length > 0 ? "set" : "unset";

const authConfigInputSchema = z.object({
  emailPasswordEnabled: z.boolean(),
  entraEnabled: z.boolean(),
  entra: z.object({
    tenantId: z.string().default(""),
    clientId: z.string().default(""),
    // Empty/omitted secret keeps the stored one — admins can't read it back.
    clientSecret: z.string().nullable().optional(),
  }),
});

type AuthConfigInput = {
  emailPasswordEnabled: boolean;
  entraEnabled: boolean;
  entra: { tenantId: string; clientId: string; clientSecret?: string | null };
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
      redirectUri: `${ctx.container.env.BETTER_AUTH_URL}/api/auth/callback/microsoft`,
    };
  }),

  setAuthConfig: adminProcedure
    .input(authConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.container.runtimeConfig.getAuthConfig();
      const merged = mergeAuthConfig(input, current);
      if (!isAtLeastOneMethodEnabled(merged)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "At least one sign-in method must stay enabled.",
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

  // Public so the unauthenticated /login page can render the right controls.
  enabledAuthMethods: publicProcedure.query(async ({ ctx }) => {
    const config = await ctx.container.runtimeConfig.getAuthConfig();
    return {
      emailPassword: config.emailPasswordEnabled,
      entra: config.entraEnabled && isEntraConfigured(config.entra),
    };
  }),

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
});
