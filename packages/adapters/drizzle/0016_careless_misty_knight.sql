CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "kb_document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid,
	"session_id" uuid,
	"source_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_document_chunks_scope_check" CHECK (num_nonnulls("flow_id", "session_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD CONSTRAINT "kb_document_chunks_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD CONSTRAINT "kb_document_chunks_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_document_chunks_flow_id_source_type_idx" ON "kb_document_chunks" USING btree ("flow_id","source_type");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_session_id_idx" ON "kb_document_chunks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_storage_path_idx" ON "kb_document_chunks" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_embedding_hnsw_idx" ON "kb_document_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);