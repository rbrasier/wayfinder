import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "mistral"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
  AUTH_METHOD: z
    .enum(["magic-link", "pki", "pki-and-magic-link", "google-oauth", "other"])
    .default("magic-link"),
  PKI_TRUSTED_PROXY_IPS: z.string().optional(),
  PKI_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;
export const serverEnv = (): ServerEnv => {
  if (cached) return cached;
  cached = serverEnvSchema.parse(process.env);
  return cached;
};
