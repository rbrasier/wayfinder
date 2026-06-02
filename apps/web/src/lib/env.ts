import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "mistral", "bedrock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  AWS_BEDROCK_REGION: z.string().optional(),
  AWS_BEDROCK_ACCESS_KEY_ID: z.string().optional(),
  AWS_BEDROCK_SECRET_ACCESS_KEY: z.string().optional(),
  // Embeddings (ADR-017): default provider + local-model controls. The admin
  // setting overrides EMBEDDINGS_PROVIDER at runtime.
  EMBEDDINGS_PROVIDER: z.enum(["local", "openai"]).default("local"),
  EMBEDDINGS_LOCAL_MODEL_PATH: z.string().optional(),
  EMBEDDINGS_ALLOW_REMOTE_MODELS: z.enum(["true", "false"]).optional(),
  EMBEDDINGS_CACHE_DIR: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
  AUTH_METHOD: z
    .enum(["email-password", "pki", "pki-and-email-password", "google-oauth", "other"])
    .default("email-password"),
  PKI_TRUSTED_PROXY_IPS: z.string().optional(),
  PKI_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  DOCUMENT_STORAGE_PATH: z.string().default("./data"),
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("wayfinder-documents"),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;
export const serverEnv = (): ServerEnv => {
  if (cached) return cached;
  cached = serverEnvSchema.parse(process.env);
  return cached;
};
