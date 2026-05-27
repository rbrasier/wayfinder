CREATE TABLE "kb_context_doc_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"extracted_text" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_context_doc_content_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" DROP CONSTRAINT "ai_usage_events_conversation_id_ai_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "kb_context_doc_content" ADD CONSTRAINT "kb_context_doc_content_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_context_doc_content_flow_id_idx" ON "kb_context_doc_content" USING btree ("flow_id");