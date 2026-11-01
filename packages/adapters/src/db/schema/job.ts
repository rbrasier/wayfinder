import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admin_mcp_servers } from "./admin";
import { core_users } from "./core";
import { app_sessions } from "./wayfinder";

export const job_registry = pgTable("job_registry", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  status: text("status", { enum: ["healthy", "degraded", "failed", "unknown"] })
    .notNull()
    .default("unknown"),
  last_run_at: timestamp("last_run_at", { withTimezone: true }),
  next_run_at: timestamp("next_run_at", { withTimezone: true }),
  error_count: integer("error_count").notNull().default(0),
  last_error: text("last_error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Queued MCP node calls (ADR-062 §3). The node's turn enqueues a row and ends;
// the apps/api worker claims it with FOR UPDATE SKIP LOCKED, makes the call and
// applies the result, so no turn waits on a slow source.
export const job_mcp_calls = pgTable(
  "job_mcp_calls",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => app_sessions.id, { onDelete: "cascade" }),
    flow_id: uuid("flow_id").notNull(),
    node_id: uuid("node_id").notNull(),
    correlation_id: text("correlation_id").notNull(),
    server_id: uuid("server_id")
      .notNull()
      .references(() => admin_mcp_servers.id, { onDelete: "cascade" }),
    tool_name: text("tool_name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, unknown>>().notNull(),
    // The session user the call is made for — the audit actor (ADR-062 §7).
    actor_id: uuid("actor_id").references(() => core_users.id, { onDelete: "set null" }),
    status: text("status", { enum: ["pending", "running", "succeeded", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    claimed_at: timestamp("claimed_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Backs the worker's claim (oldest pending first) and its stale sweep.
    by_status_created: index("job_mcp_calls_status_created_at_idx").on(t.status, t.created_at),
  }),
);
