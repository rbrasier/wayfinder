CREATE TABLE "app_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_session_participants_session_id_user_id_unique" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app_session_typing" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app_session_typing" CASCADE;--> statement-breakpoint
ALTER TABLE "app_session_messages" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "active_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "active_turn_claimed_by" uuid;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "active_turn_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_session_participants" ADD CONSTRAINT "app_session_participants_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_participants" ADD CONSTRAINT "app_session_participants_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_participants" ADD CONSTRAINT "app_session_participants_invited_by_core_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_participants_session_id_idx" ON "app_session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "app_session_participants_user_id_idx" ON "app_session_participants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_active_turn_claimed_by_core_users_id_fk" FOREIGN KEY ("active_turn_claimed_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_audit_log_created_at_idx" ON "core_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_error_log_created_at_idx" ON "app_error_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_notification_log_created_at_idx" ON "app_notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_session_messages_session_id_seq_idx" ON "app_session_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "app_session_messages_created_at_idx" ON "app_session_messages" USING btree ("created_at");