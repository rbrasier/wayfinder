import { z } from "zod";
import {
  AI_CONFIG_SETTING_KEY,
  REGISTRATION_ENABLED_SETTING_KEY,
  SESSION_UPLOAD_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  type AiConfig,
  type AiPurpose,
  type BedrockCredentials,
  type ProviderName,
  type StorageConfig,
} from "@rbrasier/domain";
import { DEFAULT_MODELS_FOR, RuntimeConfigStore } from "@rbrasier/adapters";
import { adminProcedure, publicProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

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

const sessionUploadConfigInputSchema = z.object({
  maxFileSizeBytes: z.number().int().positive(),
  totalBudgetChars: z.number().int().positive(),
});

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

  // Public so the /admin/register page can check whether to render the form
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
});
