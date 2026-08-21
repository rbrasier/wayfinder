import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { core_users } from "./core";
import { app_flows, app_sessions } from "./wayfinder";

// The knowledge-base tables (ADR-016/017 embeddings, ADR-028 curation, ADR-029
// hybrid retrieval). Split out of wayfinder.ts by table prefix, matching the
// per-group layout the rest of this directory already uses.

// Postgres full-text search vector (ADR-029). drizzle-orm has no native tsvector
// column type, so we declare a minimal custom type. The column is generated from
// chunk_text in the database and feeds the keyword side of hybrid retrieval.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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

// Registered lookup sources (ADR-050 §1). `name` is the slug template authors
// write in `(options-source: …)`, so it is unique and stable. `credential_ref`
// points at the encrypted secret store for the `api` kind — the secret itself is
// never stored here and never returned to a client, matching admin_mcp_servers.
export const kb_lookup_sources = pgTable(
  "kb_lookup_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["directory", "managed", "api"] }).notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    display_field: text("display_field").notNull(),
    key_field: text("key_field"),
    // The Authorization header value for an `api` source, encrypted at rest with
    // SettingsEncryptionService — the same key the n8n and AI credentials use.
    credential: text("credential"),
    cache_ttl_seconds: integer("cache_ttl_seconds").notNull().default(3600),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    name_unique: unique("kb_lookup_sources_name_unique").on(t.name),
  }),
);

// The cached value set for a source (ADR-050 §5). Exactly one version is active
// per source: a refresh replaces every row, and an unchanged refresh keeps the
// existing version so snapshots already written against it stay meaningful.
export const kb_lookup_source_entries = pgTable(
  "kb_lookup_source_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    source_id: uuid("source_id")
      .notNull()
      .references(() => kb_lookup_sources.id, { onDelete: "cascade" }),
    display: text("display").notNull(),
    key: text("key"),
    version: text("version").notNull(),
    fetched_at: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    by_source: index("kb_lookup_source_entries_source_id_idx").on(t.source_id),
    by_display: index("kb_lookup_source_entries_display_idx").on(t.source_id, t.display),
  }),
);
