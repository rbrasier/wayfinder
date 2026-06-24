CREATE TABLE "kb_answer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid,
	"flagged_answer" text NOT NULL,
	"corrected_text" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunk_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"edited_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "retrieval_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "last_retrieved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kb_document_chunks" ADD COLUMN "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "chunk_text")) STORED;--> statement-breakpoint
ALTER TABLE "kb_answer_feedback" ADD CONSTRAINT "kb_answer_feedback_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_answer_feedback" ADD CONSTRAINT "kb_answer_feedback_created_by_core_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunk_versions" ADD CONSTRAINT "kb_chunk_versions_chunk_id_kb_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_document_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunk_versions" ADD CONSTRAINT "kb_chunk_versions_edited_by_core_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_answer_feedback_status_idx" ON "kb_answer_feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "kb_answer_feedback_session_id_idx" ON "kb_answer_feedback" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "kb_chunk_versions_chunk_id_idx" ON "kb_chunk_versions" USING btree ("chunk_id","created_at");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_status_idx" ON "kb_document_chunks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kb_document_chunks_content_tsv_idx" ON "kb_document_chunks" USING gin ("content_tsv");