import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  foreignKey,
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
import type { ExtractionFieldResult, FlowPermission, FlowSnapshot, FlowVersionStatus, FlowVisibility } from "@rbrasier/domain";
import type { AiTurnPayload, PendingExecutions, SeedContextItem, SeedStepOutput, SessionDocument, StepOutputField } from "@rbrasier/domain";
import { core_users } from "./core";

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
    // Per-edge authoring data — today the branch rule stating when a fork should
    // take this edge. jsonb rather than a column per property so the next edge
    // property needs no migration.
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
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
    // Live chat or disposable test run (ADR-048). Defaulted rather than
    // back-filled: every existing row is a live session, and every production
    // read filters on this, so a missed predicate is a leak rather than a crash.
    mode: text("mode", { enum: ["live", "test"] }).notNull().default("live"),
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
    // The operator's own estimate, in minutes, of how long this case would have
    // taken without Wayfinder. Captured once the session finishes; null when
    // never asked or skipped. A flow's baseline is the median of these.
    manual_estimate_minutes: integer("manual_estimate_minutes"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // `mode` sits inside the two indexes that back the filtered reads rather
    // than getting one of its own: it is 'live' for almost every row, so a
    // standalone index on it would never be chosen (ADR-048 §4).
    by_user: index("app_sessions_user_id_created_at_idx").on(t.user_id, t.mode, t.created_at),
    by_flow: index("app_sessions_flow_id_idx").on(t.flow_id, t.mode),
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
    // The foreign key is declared below with an explicit name: the one drizzle
    // derives from the column (…_schedule_id_app_session_schedules_id_fk) is 65
    // characters, and Postgres truncates identifiers at 63 — so the name in the
    // database never matches the snapshot and drizzle-kit push re-creates the
    // constraint on every run.
    schedule_id: uuid("schedule_id").notNull(),
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
    schedule_fk: foreignKey({
      columns: [t.schedule_id],
      foreignColumns: [app_session_schedules.id],
      name: "app_session_schedule_runs_schedule_id_fk",
    }).onDelete("cascade"),
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
    // The foreign key is declared below with an explicit name, for the same
    // 63-character reason as app_session_schedule_runs.schedule_id.
    suggested_approver_user_id: uuid("suggested_approver_user_id"),
    approver_user_id: uuid("approver_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    approver_email: text("approver_email"),
    is_override: boolean("is_override").notNull().default(false),
    // A plain text column with a TypeScript-level refinement — there is no CHECK
    // constraint in `drizzle/`, so `approved_with_edits` and `withdrawn` are
    // additive at the database and need no migration (ADR-045 §4).
    status: text("status", {
      enum: [
        "pending",
        "approved",
        "approved_with_edits",
        "rejected",
        "changes_requested",
        "withdrawn",
      ],
    })
      .notNull()
      .default("pending"),
    // Set for `withdrawn` as the moment the row left `pending`; nobody decided
    // it, so `decided_by_user_id` stays null.
    decided_by_user_id: uuid("decided_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    // The originator's note to the approver, written when the request is sent.
    // Kept apart from `comment`, which the approver's decision writes on this
    // same row — one column would have the decision overwrite the request.
    request_message: text("request_message"),
    record_snapshot: jsonb("record_snapshot").$type<Record<string, unknown>>(),
    // Set only when the decision was recorded off system (ADR-055). A `date`
    // rather than a timestamp: the evidence names a day, and a column that
    // carried a clock time would invite one to be invented.
    off_system_approved_on: date("off_system_approved_on"),
    off_system_evidence_filename: text("off_system_evidence_filename"),
    off_system_evidence_mime_type: text("off_system_evidence_mime_type"),
    off_system_evidence_size_bytes: integer("off_system_evidence_size_bytes"),
    off_system_evidence_storage_path: text("off_system_evidence_storage_path"),
    // Who entered the nomination. Its foreign key is declared below by explicit
    // name, for the same 63-character reason as suggested_approver_user_id.
    off_system_nominated_by_user_id: uuid("off_system_nominated_by_user_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_approver_status: index("app_session_approvals_approver_user_id_status_idx").on(
      t.approver_user_id,
      t.status,
    ),
    by_session: index("app_session_approvals_session_id_idx").on(t.session_id),
    suggested_approver_fk: foreignKey({
      columns: [t.suggested_approver_user_id],
      foreignColumns: [core_users.id],
      name: "app_session_approvals_suggested_approver_user_id_fk",
    }).onDelete("set null"),
    off_system_nominator_fk: foreignKey({
      columns: [t.off_system_nominated_by_user_id],
      foreignColumns: [core_users.id],
      name: "app_session_approvals_off_system_nominator_fk",
    }).onDelete("set null"),
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
        "approval_withdrawn",
        "approval_reassigned",
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


// Extraction batch engine (ADR-033 §5, extraction-flows-2). Three tables isolate
// the whole paradigm: a run aggregate, one row per input file (the unit of
// work), and one row per output record (the unit of extraction). jsonb over join
// tables (ADR-006).
export const app_extraction_runs = pgTable(
  "app_extraction_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    flow_version_id: uuid("flow_version_id")
      .notNull()
      .references(() => app_flow_versions.id, { onDelete: "restrict" }),
    initiated_by_user_id: uuid("initiated_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    mode: text("mode", { enum: ["sample", "full"] }).notNull().default("full"),
    status: text("status", {
      enum: ["running", "paused_preview", "paused_cap", "complete", "partial", "cancelled"],
    })
      .notNull()
      .default("running"),
    // Records to process before pausing at the preview breakpoint; 0 = no pause.
    preview_boundary: smallint("preview_boundary").notNull().default(0),
    total_count: integer("total_count").notNull().default(0),
    done_count: integer("done_count").notNull().default(0),
    failed_count: integer("failed_count").notNull().default(0),
    unreadable_count: integer("unreadable_count").notNull().default(0),
    cost_usd: real("cost_usd").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_extraction_runs_flow_id_idx").on(t.flow_id),
    // Backs listClaimableRunIds and the retention sweep's oldest-first scan.
    by_status: index("app_extraction_runs_status_idx").on(t.status),
    by_created: index("app_extraction_runs_created_at_idx").on(t.created_at),
  }),
);

export const app_extraction_records = pgTable(
  "app_extraction_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    run_id: uuid("run_id")
      .notNull()
      .references(() => app_extraction_runs.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull().default(0),
    // The grouping pass's label for the record (e.g. the shared prefix/folder).
    label: text("label").notNull().default(""),
    fields: jsonb("fields").$type<ExtractionFieldResult[]>().notNull().default([]),
    aggregate_confidence: real("aggregate_confidence").notNull().default(0),
    status: text("status", { enum: ["pending", "complete"] }).notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_run: index("app_extraction_records_run_id_idx").on(t.run_id),
  }),
);

// Input documents saved against an extraction flow's draft before any run is
// started (progressive upload). Kept separate from app_extraction_documents
// (which belong to a run): these persist the author's staged intake so it
// survives leaving the editor, and seed the run when a sample is started.
export const app_extraction_draft_documents = pgTable(
  "app_extraction_draft_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    tree_path: text("tree_path").notNull(),
    storage_key: text("storage_key").notNull(),
    mime_type: text("mime_type").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_flow: index("app_extraction_draft_documents_flow_id_idx").on(t.flow_id),
  }),
);

export const app_extraction_documents = pgTable(
  "app_extraction_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    run_id: uuid("run_id")
      .notNull()
      .references(() => app_extraction_runs.id, { onDelete: "cascade" }),
    // Null until the grouping pass assigns the file to a record; a file matched
    // by no record stays null and lands in the exceptions bucket (ADR-033 §4a).
    record_id: uuid("record_id").references(() => app_extraction_records.id, {
      onDelete: "set null",
    }),
    filename: text("filename").notNull(),
    tree_path: text("tree_path").notNull(),
    storage_key: text("storage_key").notNull(),
    mime_type: text("mime_type").notNull(),
    status: text("status", {
      enum: ["pending", "extracting", "complete", "failed", "unreadable"],
    })
      .notNull()
      .default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs the worker's FOR UPDATE SKIP LOCKED claim (pending rows per run).
    by_run_status: index("app_extraction_documents_run_status_idx").on(t.run_id, t.status),
    by_record: index("app_extraction_documents_record_id_idx").on(t.record_id),
  }),
);

// A saved, re-runnable seed for a flow test (ADR-048). Rows are scoped to their
// creator on every read: a fixture cloned from a live session can hold real
// personal or commercially sensitive values, and this is the boundary that
// contains it. Deliberately not shared with everyone who can edit the flow.
export const app_flow_test_fixtures = pgTable(
  "app_flow_test_fixtures",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The node the fixture seeds up to. Not a foreign key: a fixture should
    // survive its node being deleted and re-created during authoring, and the
    // seed validator already reports a node that is no longer in the flow.
    start_node_id: uuid("start_node_id").notNull(),
    gathered_context: jsonb("gathered_context")
      .$type<SeedContextItem[]>()
      .notNull()
      .default([]),
    step_outputs: jsonb("step_outputs").$type<SeedStepOutput[]>().notNull().default([]),
    created_by_user_id: uuid("created_by_user_id")
      .notNull()
      .references(() => core_users.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs the only listing there is: this flow's fixtures, for this author.
    by_flow_creator: index("app_flow_test_fixtures_flow_id_created_by_idx").on(
      t.flow_id,
      t.created_by_user_id,
    ),
  }),
);
