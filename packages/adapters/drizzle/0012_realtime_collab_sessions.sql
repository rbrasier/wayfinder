CREATE TABLE "app_session_typing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_session_typing_session_id_user_id_unique" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app_session_messages" ADD COLUMN "sender_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app_session_typing" ADD CONSTRAINT "app_session_typing_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_typing" ADD CONSTRAINT "app_session_typing_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_typing_session_id_expires_at_idx" ON "app_session_typing" USING btree ("session_id","expires_at");--> statement-breakpoint
CREATE INDEX "app_session_typing_user_id_expires_at_idx" ON "app_session_typing" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE "app_session_messages" ADD CONSTRAINT "app_session_messages_sender_user_id_core_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;