import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  // Per-instance Postgres connection pool size. Keep low for dev; in production
  // size it so `DATABASE_POOL_MAX × instances < Postgres max_connections`, ideally
  // behind a transaction-mode pooler. See docs/guides/scaling-current-stack.md.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Short-TTL cache for session + permission resolution on the request path. A few
  // seconds removes the per-request auth DB round-trips while bounding staleness after
  // a logout or role change. Set to 0 to disable (e.g. a multi-instance deployment that
  // has not yet promoted this cache to a shared store). See docs/guides/scaling-new-infrastructure.md.
  AUTH_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(5000),
  AUTH_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(10000),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  // Shared secret the API scheduler heartbeat presents to the internal tick
  // endpoint. The endpoint refuses to fire unless this is set and matches.
  SCHEDULER_TICK_SECRET: z.string().optional(),
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
  // Email notifications (ADR-023). When SMTP_TRANSPORT_MODE is set the env
  // transport takes precedence over the admin-settings SMTP config.
  NOTIFICATIONS_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  // Empty strings come through when .env exports blank-value lines; treat them
  // as unset so the enum/number validations behave.
  SMTP_TRANSPORT_MODE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["oauth2", "smtp", "stream"]).optional(),
  ),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().optional(),
  ),
  SMTP_SECURE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  M365_TENANT_ID: z.string().optional(),
  M365_CLIENT_ID: z.string().optional(),
  M365_CLIENT_SECRET: z.string().optional(),
  // Microsoft Entra ID sign-in (ADR-025). Fallbacks the admin-settings auth
  // config overrides — the DB row takes precedence when present.
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;
export const serverEnv = (): ServerEnv => {
  if (cached) return cached;
  cached = serverEnvSchema.parse(process.env);
  return cached;
};
