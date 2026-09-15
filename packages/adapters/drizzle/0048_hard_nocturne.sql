ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_approved_on" date;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_filename" text;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_mime_type" text;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_evidence_storage_path" text;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD COLUMN "off_system_nominated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_off_system_nominator_fk" FOREIGN KEY ("off_system_nominated_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;