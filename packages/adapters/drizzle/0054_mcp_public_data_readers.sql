-- data-impact: preserved — adds columns with defaults and a new empty table; every server that had communicates_externally = true is carried into data_classification = 'external-write' below, before 0055 drops the old column (ADR-062 §1)
CREATE TABLE "job_mcp_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"server_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"actor_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "data_classification" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
-- Hand-added: carry the old classification across before 0055 drops it.
UPDATE "admin_mcp_servers" SET "data_classification" = 'external-write' WHERE "communicates_externally" = true;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "call_timeout_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "credential_ciphertext" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD COLUMN "custom_headers_ciphertext" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_tools" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "admin_mcp_tools" ADD COLUMN "pagination_config" jsonb;--> statement-breakpoint
ALTER TABLE "admin_mcp_tools" ADD COLUMN "status_config" jsonb;--> statement-breakpoint
ALTER TABLE "admin_mcp_tools" ADD COLUMN "citation_config" jsonb;--> statement-breakpoint
ALTER TABLE "job_mcp_calls" ADD CONSTRAINT "job_mcp_calls_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_mcp_calls" ADD CONSTRAINT "job_mcp_calls_server_id_admin_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."admin_mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_mcp_calls" ADD CONSTRAINT "job_mcp_calls_actor_id_core_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_mcp_calls_status_created_at_idx" ON "job_mcp_calls" USING btree ("status","created_at");