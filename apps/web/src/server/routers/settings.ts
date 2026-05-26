import { z } from "zod";
import {
  AI_CONFIG_SETTING_KEY,
  STORAGE_CONFIG_SETTING_KEY,
  type AiConfig,
  type AiPurpose,
  type ProviderName,
  type StorageConfig,
} from "@rbrasier/domain";
import { DEFAULT_MODELS_FOR, RuntimeConfigStore } from "@rbrasier/adapters";
import { adminProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const providerSchema = z.enum(["anthropic", "openai", "mistral"]);

const aiConfigInputSchema = z.object({
  provider: providerSchema,
  apiKeys: z.object({
    anthropic: z.string().nullable().optional(),
    openai: z.string().nullable().optional(),
    mistral: z.string().nullable().optional(),
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

const PURPOSES: AiPurpose[] = ["chat", "documentGeneration", "branching"];

/**
 * Merge incoming apiKeys with stored ones — if the client sends null/empty
 * for a key, keep the previously-stored value (so editing the modal doesn't
 * wipe an existing key the admin can't read back from a redacted display).
 */
const mergeApiKeys = (
  incoming: { anthropic?: string | null; openai?: string | null; mistral?: string | null },
  stored: AiConfig["apiKeys"],
): AiConfig["apiKeys"] => ({
  anthropic: incoming.anthropic && incoming.anthropic.length > 0 ? incoming.anthropic : stored.anthropic,
  openai: incoming.openai && incoming.openai.length > 0 ? incoming.openai : stored.openai,
  mistral: incoming.mistral && incoming.mistral.length > 0 ? incoming.mistral : stored.mistral,
});

const apiKeyState = (value: string | null): "set" | "unset" =>
  value && value.length > 0 ? "set" : "unset";

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
});
