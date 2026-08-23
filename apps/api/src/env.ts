import { z } from "zod";

// A 32-byte key as 64 hex chars or a base64-encoded 32-byte value. Required so a
// deployment can never silently fall back to storing integration credentials in
// plaintext; generate with `openssl rand -hex 32`.
const settingsEncryptionKeySchema = z
  .string()
  .refine(
    (value) => {
      const trimmed = value.trim();
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return true;
      return Buffer.from(trimmed, "base64").length === 32;
    },
    {
      message:
        "SETTINGS_ENCRYPTION_KEY must be 64 hex chars or a base64-encoded 32-byte value (e.g. `openssl rand -hex 32`).",
    },
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().url(),
  // Per-instance Postgres connection pool size for the scheduler/webhook service.
  // Keep this within the same `pool × instances < max_connections` budget as the
  // web app. See the scaling-current-stack phase doc.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  SETTINGS_ENCRYPTION_KEY: settingsEncryptionKeySchema,
  AI_DEFAULT_PROVIDER: z.enum(["anthropic", "openai", "mistral", "bedrock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  AWS_BEDROCK_REGION: z.string().optional(),
  AWS_BEDROCK_ACCESS_KEY_ID: z.string().optional(),
  AWS_BEDROCK_SECRET_ACCESS_KEY: z.string().optional(),
  // Object storage fallback for the extraction worker, mirroring the web app's
  // schema. A stored storage_config row still wins; these matter for an
  // env-only deployment, which otherwise reached for a local MinIO that a
  // hosted install does not have.
  MINIO_ENDPOINT: z.string().default("localhost"),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin"),
  MINIO_BUCKET: z.string().default("wayfinder-documents"),
  MINIO_USE_SSL: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  // Ignored by MinIO; required by Amazon S3, which signs with the bucket region.
  MINIO_REGION: z.string().default(""),
  // MinIO serves path-style addressing; Amazon S3 wants virtual-hosted style.
  MINIO_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
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
  // How many independent heartbeat workers to run. Each tick claims a disjoint
  // batch via FOR UPDATE SKIP LOCKED (ADR-019), so N workers drain a backlog N×
  // faster with no schema change. Keep at 1 unless a backlog is observed.
  SCHEDULER_WORKER_COUNT: z.coerce.number().int().positive().default(1),
  // Full URL of the web app's internal scheduler tick endpoint. Defaults to the
  // web app's own endpoint (see loadEnv), so a normal install only has to set
  // the shared secret below — which is the one thing that cannot be derived.
  SCHEDULER_TICK_URL: z.string().url().optional(),
  // Shared secret the heartbeat presents to that endpoint; the endpoint refuses
  // to fire without it. The heartbeat does not start until this is set, and the
  // web app must see the same value. restart.sh generates one into .env.
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
  // Host overrides for Microsoft Graph, env-only for the same reason
  // ENTRA_AUTHORITY is: a directory lookup must not be repointable from a
  // settings form. Unset, the real Microsoft hosts are used. Set both to drive
  // the local mock Graph (restart.sh --with-mocks) — they are inert on their
  // own, because Graph is only consulted once all three M365 credentials are set.
  M365_GRAPH_BASE_URL: z.string().url().optional(),
  M365_AUTHORITY: z.string().url().optional(),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  // Retention sweep (scaling wall #9). Deletes rows older than the per-table
  // window from the unbounded-growth tables so their hot-path indexes stay lean.
  // Runs in this long-lived API server on a slow cadence. Disabled by default:
  // an operator opts in explicitly. A window of 0 keeps that table forever.
  RETENTION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  RETENTION_TICK_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  RETENTION_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  RETENTION_MAX_BATCHES_PER_TARGET: z.coerce.number().int().positive().default(200),
  // Extraction batch engine (ADR-033 §6). On by default: a run that outlives the
  // browser session has no other engine, so opting in was how a default install
  // ended up with runs that never progressed. Set it to "false" to opt out.
  // Intake limits and the per-run cost ceiling are admin settings
  // (ExtractionConfig), not env vars — only the worker's on/off and tick cadence
  // live here.
  EXTRACTION_WORKER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  EXTRACTION_TICK_MS: z.coerce.number().int().positive().default(5000),
  // Operational/telemetry tables get finite defaults. Audit and conversation
  // history default to 0 (keep forever) — deleting them is a deliberate,
  // compliance-sensitive choice the operator must make.
  RETENTION_USAGE_EVENTS_DAYS: z.coerce.number().int().nonnegative().default(400),
  RETENTION_ERROR_LOG_DAYS: z.coerce.number().int().nonnegative().default(90),
  RETENTION_NOTIFICATION_LOG_DAYS: z.coerce.number().int().nonnegative().default(180),
  RETENTION_AUDIT_LOG_DAYS: z.coerce.number().int().nonnegative().default(0),
  RETENTION_SESSION_MESSAGES_DAYS: z.coerce.number().int().nonnegative().default(0),
  // Extraction runs hold sensitive supplier responses; default keep-forever so
  // deletion is a deliberate operator choice (ADR-033 §9).
  RETENTION_EXTRACTION_RUNS_DAYS: z.coerce.number().int().nonnegative().default(0),
});

export type Env = Omit<z.infer<typeof envSchema>, "SCHEDULER_TICK_URL"> & {
  SCHEDULER_TICK_URL: string;
};

// Path of the web app's internal tick endpoint (apps/web/src/app/api/internal/
// scheduler/tick/route.ts), which the heartbeat POSTs each interval.
const SCHEDULER_TICK_PATH = "/api/internal/scheduler/tick";

export const loadEnv = (): Env => {
  // Shell `source .env` exports empty-value lines (e.g. OTEL_EXPORTER_OTLP_ENDPOINT=)
  // as empty strings. Zod treats "" as a provided string and fails .url() validation.
  // Strip empty strings to undefined so optional URL fields behave as unset.
  const env = Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    SCHEDULER_TICK_URL:
      parsed.SCHEDULER_TICK_URL ?? `${parsed.WEB_BASE_URL.replace(/\/+$/, "")}${SCHEDULER_TICK_PATH}`,
  };
};
