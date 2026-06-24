import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().url(),
  // Per-instance Postgres connection pool size for the scheduler/webhook service.
  // Keep this within the same `pool × instances < max_connections` budget as the
  // web app. See the scaling-to-concurrent-load phase doc.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "mistral", "bedrock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  AWS_BEDROCK_REGION: z.string().optional(),
  AWS_BEDROCK_ACCESS_KEY_ID: z.string().optional(),
  AWS_BEDROCK_SECRET_ACCESS_KEY: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("template-api"),
  // The scheduler heartbeat runs in this long-lived API server and POSTs the
  // web tick endpoint each interval. Disabled only by an explicit "false".
  SCHEDULER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().optional(),
  // Full URL of the web app's internal scheduler tick endpoint and the shared
  // secret it requires. The heartbeat only starts when both are set.
  SCHEDULER_TICK_URL: z.string().url().optional(),
  SCHEDULER_TICK_SECRET: z.string().optional(),
  // Email notifications (ADR-023) — the n8n callback webhook can complete a
  // session, so this app sends the session-complete email too. Links in email
  // bodies point at the web app.
  NOTIFICATIONS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SMTP_TRANSPORT_MODE: z.enum(["oauth2", "smtp", "stream"]).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  M365_TENANT_ID: z.string().optional(),
  M365_CLIENT_ID: z.string().optional(),
  M365_CLIENT_SECRET: z.string().optional(),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (): Env => {
  // Shell `source .env` exports empty-value lines (e.g. OTEL_EXPORTER_OTLP_ENDPOINT=)
  // as empty strings. Zod treats "" as a provided string and fails .url() validation.
  // Strip empty strings to undefined so optional URL fields behave as unset.
  const env = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  return envSchema.parse(env);
};
