ALTER TABLE "app_flows" ADD COLUMN "expert_role" text;
--> statement-breakpoint
ALTER TABLE "app_session_messages" ADD COLUMN "ai_payload" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_system_settings_key_unique" UNIQUE("key")
);
