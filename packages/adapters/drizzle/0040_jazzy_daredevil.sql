CREATE TABLE "app_extraction_draft_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"tree_path" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_extraction_draft_documents" ADD CONSTRAINT "app_extraction_draft_documents_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_extraction_draft_documents_flow_id_idx" ON "app_extraction_draft_documents" USING btree ("flow_id");