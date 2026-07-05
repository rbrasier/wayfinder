CREATE TABLE "admin_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"transport" text DEFAULT 'sse' NOT NULL,
	"kind" text DEFAULT 'context' NOT NULL,
	"url" text NOT NULL,
	"credential_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_mcp_tools_server_id_name_unique" UNIQUE("server_id","name")
);
--> statement-breakpoint
CREATE TABLE "app_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_flows" ADD COLUMN "context_mcp_server_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_mcp_servers" ADD CONSTRAINT "admin_mcp_servers_created_by_user_id_core_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_mcp_tools" ADD CONSTRAINT "admin_mcp_tools_server_id_admin_mcp_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."admin_mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_skills" ADD CONSTRAINT "app_skills_created_by_user_id_core_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_mcp_tools_server_id_idx" ON "admin_mcp_tools" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "app_skills_status_idx" ON "app_skills" USING btree ("status");