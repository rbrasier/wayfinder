import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  foreignKey,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { core_users } from "./core";
import { app_flows, app_sessions } from "./wayfinder";

export const ai_conversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
  title: text("title"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ai_messages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conversation_id: uuid("conversation_id")
    .notNull()
    .references(() => ai_conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ai_usage_events = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id").references(() => core_users.id, { onDelete: "set null" }),
    conversation_id: uuid("conversation_id"),
    // Flow + session attribution for the governance dashboard (ADR-026). Both
    // nullable: ad-hoc calls with no flow/session record nulls here.
    flow_id: uuid("flow_id").references(() => app_flows.id, { onDelete: "set null" }),
    session_id: uuid("session_id"),
    purpose: text("purpose").notNull().default(""),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    system_tokens: integer("system_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_write_tokens: integer("cache_write_tokens").notNull().default(0),
    cost_usd: real("cost_usd").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs per-user period-spend sums on the enforcement hot path (ADR-026 §5).
    by_user_created: index("ai_usage_events_user_id_created_at_idx").on(t.user_id, t.created_at),
    by_flow_created: index("ai_usage_events_flow_id_created_at_idx").on(t.flow_id, t.created_at),
    by_session: index("ai_usage_events_session_id_idx").on(t.session_id),
    // Backs the retention sweep's oldest-first range scan (scaling wall #9).
    by_created: index("ai_usage_events_created_at_idx").on(t.created_at),
  }),
);

// ── Flow memory (ADR-057, ADR-058) ───────────────────────────────────────────
// `ai_` rather than `app_`: these are model-derived artefacts of the AI
// subsystem, sitting with ai_usage_events, and they are deliberately not part of
// a flow's authoring config — a flow export (ADR-049) carries no lessons.

// One captured, mechanically-derived fact. No model is in its path.
export const ai_flow_observations = pgTable(
  "ai_flow_observations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id").notNull(),
    // Set null rather than cascaded: retention may remove the session while a
    // lesson it supported remains accepted and in force. Evidence then reads as
    // "the session behind this has since been deleted", which is honest —
    // silently retiring live guidance because a row aged out would be worse.
    // Because these rows therefore outlive their sessions, they are their own
    // retention target with their own window.
    session_id: uuid("session_id").references(() => app_sessions.id, { onDelete: "set null" }),
    kind: text("kind", {
      enum: [
        "field_corrected",
        "low_confidence_completion",
        "excess_turns",
        "redundant_question",
        "change_requested",
        "knowledge_gap",
        "abandoned_at_step",
      ],
    }).notNull(),
    detail: jsonb("detail").notNull().default({}),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
    distilled_at: timestamp("distilled_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // What makes capture idempotent: one vote per session per node per kind.
    one_per_session_node_kind: unique("ai_flow_observations_session_node_kind_unique").on(
      t.session_id,
      t.node_id,
      t.kind,
    ),
    by_flow_node: index("ai_flow_observations_flow_id_node_id_idx").on(t.flow_id, t.node_id),
    // Backs the distillation sweep, which only ever wants undistilled rows.
    undistilled_by_flow: index("ai_flow_observations_undistilled_idx")
      .on(t.flow_id)
      .where(sql`${t.distilled_at} is null`),
    // Backs the retention sweep's oldest-first range scan.
    by_created: index("ai_flow_observations_created_at_idx").on(t.created_at),
  }),
);

// The distilled claim. Born `proposed`; only `accepted` has runtime effect.
export const ai_flow_lessons = pgTable(
  "ai_flow_lessons",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    flow_id: uuid("flow_id")
      .notNull()
      .references(() => app_flows.id, { onDelete: "cascade" }),
    node_id: uuid("node_id").notNull(),
    kind: text("kind", { enum: ["guidance", "efficiency", "knowledge_gap"] }).notNull(),
    statement: text("statement").notNull(),
    status: text("status", { enum: ["proposed", "accepted", "rejected", "retired"] })
      .notNull()
      .default("proposed"),
    evidence_count: integer("evidence_count").notNull().default(0),
    first_seen_at: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    accepted_by_user_id: uuid("accepted_by_user_id").references(() => core_users.id, {
      onDelete: "set null",
    }),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    supersedes_lesson_id: uuid("supersedes_lesson_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs the panel read.
    by_flow_status: index("ai_flow_lessons_flow_id_status_idx").on(t.flow_id, t.status),
    // Backs the prompt-time read on every turn (ADR-058).
    by_flow_node_status: index("ai_flow_lessons_flow_id_node_id_status_idx").on(
      t.flow_id,
      t.node_id,
      t.status,
    ),
  }),
);

// The join that makes "why does it say that?" answerable. A lesson with no
// evidence rows is a bug, not a lesson.
export const ai_flow_lesson_evidence = pgTable(
  "ai_flow_lesson_evidence",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    lesson_id: uuid("lesson_id")
      .notNull()
      .references(() => ai_flow_lessons.id, { onDelete: "cascade" }),
    observation_id: uuid("observation_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Named explicitly: Drizzle's generated name for this one would be 65
    // characters, past Postgres's 63-character identifier limit.
    observation_fk: foreignKey({
      name: "ai_flow_lesson_evidence_observation_id_fk",
      columns: [t.observation_id],
      foreignColumns: [ai_flow_observations.id],
    }).onDelete("cascade"),
    one_per_pair: unique("ai_flow_lesson_evidence_lesson_observation_unique").on(
      t.lesson_id,
      t.observation_id,
    ),
  }),
);
