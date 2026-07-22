import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { FlowPermission, FlowSnapshot, FlowVersionStatus, FlowVisibility } from "@rbrasier/domain";
import type { AiTurnPayload, PendingExecutions, SessionDocument, StepOutputField } from "@rbrasier/domain";
import { core_users } from "./core";

// Postgres full-text search vector (ADR-029). drizzle-orm has no native tsvector
// column type, so we declare a minimal custom type. The column is generated from
// chunk_text in the database and feeds the keyword side of hybrid retrieval.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

type StoredContextDoc = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export const app_flows = pgTable(
  "app_flows",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    expert_role: text("expert_role"),
    owner_user_id: uuid("owner_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    // Flow paradigm discriminator (ADR-033). Defaults to "guided" so every
    // existing row and guided code path is untouched.
    flow_type: text("flow_type", { enum: ["guided", "extraction"] })
      .notNull()
      .default("guided"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    visibility: jsonb("visibility")
      .$type<FlowVisibility>()
      .notNull()
      .default({ kind: "private" }),
    permissions: jsonb("permissions").$type<FlowPermission[]>().notNull().default([]),
    context_docs: jsonb("context_docs").$type<StoredContextDoc[]>().notNull().default([]),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const app_flow_nodes = pgTable(
  "app_flow_nodes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["conversational", "auto", "scheduled", "approval", "mcp"] })
      .notNull()
      .default("conversational"),
    name: text("name").notNull(),
    colour: text("colour"),
    position_x: integer("position_x").notNull().default(0),
    position_y: integer("position_y").notNull().default(0),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_flow_nodes_flow_id_idx").on(t.flow_id),
  }),
);

export const app_flow_edges = pgTable(
  "app_flow_edges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    from_node_id: uuid("from_node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    to_node_id: uuid("to_node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_flow_edges_flow_id_idx").on(t.flow_id),
    by_from_node: index("app_flow_edges_from_node_id_idx").on(t.from_node_id),
  }),
);

// Immutable snapshot of a flow's full definition under a draft→published
// lifecycle (ADR-015). A version is self-contained jsonb so it survives any
// later edit/deletion of the live rows. `version_number` is null while `draft`
// and allocated monotonically per flow on publish.
export const app_flow_versions = pgTable(
  "app_flow_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    version_number: integer("version_number"),
    status: text("status", { enum: ["draft", "published"] })
      .$type<FlowVersionStatus>()
      .notNull()
      .default("draft"),
    snapshot: jsonb("snapshot").$type<FlowSnapshot>().notNull(),
    change_summary: text("change_summary"),
    published_by_user_id: uuid("published_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    published_at: timestamp("published_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_flow_versions_flow_id_idx").on(t.flow_id),
    number_unique: unique("app_flow_versions_flow_id_version_number_unique").on(
      t.flow_id,
      t.version_number,
    ),
    // At most one open draft per flow — editing updates that single draft row
    // rather than writing a new version per save.
    one_draft: uniqueIndex("app_flow_versions_one_draft_idx")
      .on(t.flow_id)
      .where(sql`status = 'draft'`),
  }),
);

export const app_sessions = pgTable(
  "app_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "restrict" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "complete", "abandoned", "cancelled"] })
      .notNull()
      .default("active"),
    title: text("title"),
    current_node_id: uuid("current_node_id"),
    awaiting_confirmation_node_id: uuid("awaiting_confirmation_node_id"),
    flow_version_id: uuid("flow_version_id").references(() => app_flow_versions.id, {
      onDelete: "set null",
    }),
    graph_checkpoint: jsonb("graph_checkpoint").$type<Record<string, unknown>>(),
    pending_executions: jsonb("pending_executions")
      .$type<PendingExecutions>()
      .notNull()
      .default({}),
    // Server-side turn lease (scaling wall #3): one turn in flight at a time.
    active_turn_id: uuid("active_turn_id"),
    active_turn_claimed_by: uuid("active_turn_claimed_by").references(() => core_users.id, {
      onDelete: "set null",
    }),
    active_turn_claimed_at: timestamp("active_turn_claimed_at", { withTimezone: true }),
    // Optimistic-concurrency guard for non-lease writers (scaling wall #3).
    version: integer("version").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_user: index("app_sessions_user_id_created_at_idx").on(t.user_id, t.created_at),
    by_flow: index("app_sessions_flow_id_idx").on(t.flow_id),
    by_flow_version: index("app_sessions_flow_version_id_idx").on(t.flow_version_id),
  }),
);

export const app_session_schedules = pgTable(
  "app_session_schedules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["relative", "cron", "at", "recurrence"] }).notNull(),
    spec: text("spec").notNull(),
    recurring: boolean("recurring").notNull().default(false),
    next_fire_at: timestamp("next_fire_at", { withTimezone: true }).notNull(),
    last_fired_at: timestamp("last_fired_at", { withTimezone: true }),
    occurrence_count: integer("occurrence_count").notNull().default(0),
    max_occurrences: integer("max_occurrences"),
    status: text("status", { enum: ["active", "completed", "cancelled", "failed"] })
      .notNull()
      .default("active"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_due: index("app_session_schedules_status_next_fire_at_idx").on(t.status, t.next_fire_at),
    by_session: index("app_session_schedules_session_id_idx").on(t.session_id),
  }),
);

// Append-only audit of every schedule fire. Rows are never updated; this is the
// per-fire history that app_session_schedules (current state only) cannot give.
export const app_session_schedule_runs = pgTable(
  "app_session_schedule_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    schedule_id: uuid("schedule_id")
      .notNull()
      .references(() => app_session_schedules.id, { onDelete: "cascade" }),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    outcome: text("outcome", { enum: ["recurred", "completed", "failed"] }).notNull(),
    occurrence: integer("occurrence").notNull(),
    fired_at: timestamp("fired_at", { withTimezone: true }).notNull(),
    next_fire_at: timestamp("next_fire_at", { withTimezone: true }),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_created: index("app_session_schedule_runs_created_at_idx").on(t.created_at),
    by_schedule: index("app_session_schedule_runs_schedule_id_idx").on(t.schedule_id),
  }),
);

export const app_session_messages = pgTable(
  "app_session_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    sender_user_id: uuid("sender_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    confidence: smallint("confidence"),
    step_node_id: uuid("step_node_id"),
    document: jsonb("document").$type<SessionDocument>(),
    document_status: text("document_status", { enum: ["pending", "complete", "failed"] }),
    ai_payload: jsonb("ai_payload").$type<AiTurnPayload>(),
    // Monotonic per-session cursor for real-time replay (scaling wall #2). A
    // global bigserial is strictly increasing within any one session, so an SSE
    // reconnect replays losslessly with `WHERE seq > lastEventId`; cross-session
    // ordering is irrelevant because every subscription is scoped to one session.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_session: index("app_session_messages_session_id_created_at_idx").on(
      t.session_id,
      t.created_at,
    ),
    by_session_seq: index("app_session_messages_session_id_seq_idx").on(
      t.session_id,
      t.seq,
    ),
    // Backs the retention sweep's oldest-first range scan (scaling wall #9).
    by_created: index("app_session_messages_created_at_idx").on(t.created_at),
  }),
);

// Collaborative-session membership as rows (scaling wall #11). The owner is not
// stored here — it is app_sessions.user_id — so this table holds only invited
// collaborators and viewers. Joining stays link-based (opening the collaborate
// link auto-enrols the authenticated user), but the stream route authorises
// against the stored role, so revocation actually works.
export const app_session_participants = pgTable(
  "app_session_participants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "collaborator", "viewer"] })
      .notNull()
      .default("collaborator"),
    joined_at: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    invited_by: uuid("invited_by").references(() => core_users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    session_user_unique: unique("app_session_participants_session_id_user_id_unique").on(
      t.session_id,
      t.user_id,
    ),
    by_session: index("app_session_participants_session_id_idx").on(t.session_id),
    by_user: index("app_session_participants_user_id_idx").on(t.user_id),
  }),
);

export const app_session_uploads = pgTable(
  "app_session_uploads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    message_id: uuid("message_id").references(() => app_session_messages.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    mime_type: text("mime_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    storage_path: text("storage_path").notNull(),
    extracted_text: text("extracted_text"),
    extraction_status: text("extraction_status", {
      enum: ["pending", "complete", "failed", "unsupported"],
    }).notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    storage_path_unique: unique("app_session_uploads_storage_path_unique").on(t.storage_path),
    by_session: index("app_session_uploads_session_id_idx").on(t.session_id),
  }),
);

export const app_session_step_outputs = pgTable(
  "app_session_step_outputs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    message_id: uuid("message_id").references(() => app_session_messages.id, {
      onDelete: "set null",
    }),
    fields: jsonb("fields").$type<StepOutputField[]>().notNull().default([]),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_session_step_outputs_flow_id_idx").on(t.flow_id),
    by_session: index("app_session_step_outputs_session_id_idx").on(t.session_id),
    by_node: index("app_session_step_outputs_node_id_idx").on(t.node_id),
  }),
);

// Approval requests raised when a session reaches an `approval` node. The row is
// the source of truth for the decision; the suggested/confirmed approver and any
// override are all recorded for audit (ADR-018).
export const app_session_approvals = pgTable(
  "app_session_approvals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id")
      .notNull()
      .references(() => app_flow_nodes.id, { onDelete: "cascade" }),
    message_id: uuid("message_id"),
    requested_by_user_id: uuid("requested_by_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "restrict" }),
    approver_source: text("approver_source", {
      enum: ["first_level_supervisor", "second_level_supervisor", "dynamic"],
    }).notNull(),
    suggested_approver_user_id: uuid("suggested_approver_user_id").references(
      () => core_users.id,
      { onDelete: "set null" },
    ),
    approver_user_id: uuid("approver_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    approver_email: text("approver_email"),
    is_override: boolean("is_override").notNull().default(false),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "changes_requested"],
    })
      .notNull()
      .default("pending"),
    decided_by_user_id: uuid("decided_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    record_snapshot: jsonb("record_snapshot").$type<Record<string, unknown>>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_approver_status: index("app_session_approvals_approver_user_id_status_idx").on(
      t.approver_user_id,
      t.status,
    ),
    by_session: index("app_session_approvals_session_id_idx").on(t.session_id),
  }),
);

// Outbox + delivery log for outbound email (ADR-023). Rows are written as
// `pending` inside the triggering action, then flipped to `sent`/`failed` by
// the best-effort send. The unique index makes sends idempotent per
// (trigger, resource, recipient).
export const app_notification_log = pgTable(
  "app_notification_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    recipient_email: text("recipient_email").notNull(),
    recipient_user_id: uuid("recipient_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    trigger: text("trigger", {
      enum: [
        "session_complete",
        "step_complete",
        "flow_shared",
        "approval_requested",
        "approval_decided",
      ],
    }).notNull(),
    resource_type: text("resource_type", { enum: ["session", "flow", "approval"] }).notNull(),
    resource_id: text("resource_id").notNull(),
    subject: text("subject").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    attempts: smallint("attempts").notNull().default(0),
    sent_at: timestamp("sent_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupe_unique: unique("app_notification_log_trigger_resource_recipient_unique").on(
      t.trigger,
      t.resource_id,
      t.recipient_email,
    ),
    by_status_created: index("app_notification_log_status_created_at_idx").on(
      t.status,
      t.created_at,
    ),
    // Backs the retention sweep's oldest-first range scan (scaling wall #9).
    by_created: index("app_notification_log_created_at_idx").on(t.created_at),
  }),
);

// Scoped spend caps (ADR-031, generalising ADR-026). A cap is configured at one
// of three scopes — everyone / role / user — but always evaluated against an
// individual user's own spend. Off by default. `scope_ref` is a generated,
// always-non-null key (user_id | role_key | 'everyone') so the unique index can
// enforce at most one cap per target per period across all scopes (Postgres
// treats raw NULLs as distinct, which a plain composite index could not).
export const app_usage_budgets = pgTable(
  "app_usage_budgets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    scope: text("scope", { enum: ["everyone", "role", "user"] })
      .notNull()
      .default("user"),
    role_key: text("role_key"),
    // Nullable now: only user-scoped rows carry a user_id. FK + cascade retained
    // so deleting a user still removes their per-user caps.
    user_id: uuid("user_id").references(() => core_users.id, { onDelete: "cascade" }),
    period: text("period", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    limit_usd: real("limit_usd").notNull(),
    warn_threshold_pct: smallint("warn_threshold_pct").notNull().default(80),
    enabled: boolean("enabled").notNull().default(false),
    scope_ref: text("scope_ref").generatedAlwaysAs(
      sql`COALESCE("user_id"::text, "role_key", 'everyone')`,
    ),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    period_scope_ref_unique: uniqueIndex("app_usage_budgets_period_scope_ref_unique").on(
      t.period,
      t.scope_ref,
    ),
    by_user: index("app_usage_budgets_user_id_idx").on(t.user_id),
  }),
);

export const admin_system_settings = pgTable(
  "admin_system_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    key: text("key").notNull(),
    value: text("value").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    key_unique: unique("admin_system_settings_key_unique").on(t.key),
  }),
);

export const kb_context_doc_content = pgTable(
  "kb_context_doc_content",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    storage_path: text("storage_path").notNull(),
    extracted_text: text("extracted_text"),
    extraction_status: text("extraction_status", {
      enum: ["pending", "complete", "failed", "unsupported"],
    }).notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    storage_path_unique: unique("kb_context_doc_content_storage_path_unique").on(t.storage_path),
    by_flow: index("kb_context_doc_content_flow_id_idx").on(t.flow_id),
  }),
);

export const kb_document_chunks = pgTable(
  "kb_document_chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id").references(() => app_flows.id, { onDelete: "cascade" }),
    session_id: uuid("session_id").references(() => app_sessions.id, { onDelete: "cascade" }),
    source_type: text("source_type", {
      enum: ["flow_context_doc", "session_upload", "template"],
    }).notNull(),
    storage_path: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    chunk_index: integer("chunk_index").notNull(),
    chunk_text: text("chunk_text").notNull(),
    // 384 dims (ADR-017): shared by the local all-MiniLM model and OpenAI
    // text-embedding-3-small reduced via its `dimensions` parameter.
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    // Curation lifecycle (ADR-028). Inference retrieval filters to `active`;
    // archived chunks are retained for audit but never retrieved.
    status: text("status", { enum: ["active", "archived", "draft"] }).notNull().default("active"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    retrieval_count: integer("retrieval_count").notNull().default(0),
    last_retrieved_at: timestamp("last_retrieved_at", { withTimezone: true }),
    // Keyword side of hybrid retrieval (ADR-029): generated from chunk_text.
    content_tsv: tsvector("content_tsv").generatedAlwaysAs(
      sql`to_tsvector('english', "chunk_text")`,
    ),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow_source: index("kb_document_chunks_flow_id_source_type_idx").on(t.flow_id, t.source_type),
    by_session: index("kb_document_chunks_session_id_idx").on(t.session_id),
    by_storage_path: index("kb_document_chunks_storage_path_idx").on(t.storage_path),
    by_status: index("kb_document_chunks_status_idx").on(t.status),
    embedding_hnsw: index("kb_document_chunks_embedding_hnsw_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    content_tsv_gin: index("kb_document_chunks_content_tsv_idx").using("gin", t.content_tsv),
    // Exactly one scope per chunk: flow-scoped sources carry flow_id, session
    // uploads carry session_id (phase doc §6).
    scope_check: check(
      "kb_document_chunks_scope_check",
      sql`num_nonnulls("flow_id", "session_id") = 1`,
    ),
  }),
);

// Append-only edit history for a curated chunk (ADR-028 Decision 2). Each row
// captures the chunk's text and embedding *as they were before* an edit or
// revert, so a revert restores an exact prior state and nothing is destroyed.
export const kb_chunk_versions = pgTable(
  "kb_chunk_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    chunk_id: uuid("chunk_id")
      .notNull()
      .references(() => kb_document_chunks.id, { onDelete: "cascade" }),
    chunk_text: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 384 }).notNull(),
    edited_by: uuid("edited_by").references(() => core_users.id, { onDelete: "set null" }),
    reason: text("reason"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_chunk: index("kb_chunk_versions_chunk_id_idx").on(t.chunk_id, t.created_at),
  }),
);

// A frontline "Fix This Answer" submission (ADR-028 Decision 3). Captured raw
// and decoupled from any chunk; an SME maps it to a chunk during triage.
export const kb_answer_feedback = pgTable(
  "kb_answer_feedback",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    message_id: uuid("message_id"),
    flagged_answer: text("flagged_answer").notNull(),
    corrected_text: text("corrected_text").notNull(),
    reason: text("reason", {
      enum: ["outdated", "wrong", "incomplete", "other"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "dismissed"],
    }).notNull().default("pending"),
    created_by: uuid("created_by").references(() => core_users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_status: index("kb_answer_feedback_status_idx").on(t.status, t.created_at),
    by_session: index("kb_answer_feedback_session_id_idx").on(t.session_id),
  }),
);
