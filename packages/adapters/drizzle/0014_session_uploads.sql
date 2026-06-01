CREATE TABLE "app_session_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"message_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"extracted_text" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_session_uploads_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
ALTER TABLE "app_session_uploads" ADD CONSTRAINT "app_session_uploads_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_uploads" ADD CONSTRAINT "app_session_uploads_message_id_app_session_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."app_session_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_uploads_session_id_idx" ON "app_session_uploads" USING btree ("session_id");