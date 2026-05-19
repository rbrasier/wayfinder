CREATE TABLE IF NOT EXISTS "app_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"owner_user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"context_docs" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_flow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"type" text DEFAULT 'conversational' NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_flow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"title" text,
	"current_node_id" uuid,
	"graph_checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"confidence" smallint,
	"step_node_id" uuid,
	"document" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_flows" ADD CONSTRAINT "app_flows_owner_user_id_core_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."core_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_flow_nodes" ADD CONSTRAINT "app_flow_nodes_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_flow_edges" ADD CONSTRAINT "app_flow_edges_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_flow_edges" ADD CONSTRAINT "app_flow_edges_from_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_flow_edges" ADD CONSTRAINT "app_flow_edges_to_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_session_messages" ADD CONSTRAINT "app_session_messages_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_flow_nodes_flow_id_idx" ON "app_flow_nodes" USING btree ("flow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_flow_edges_flow_id_idx" ON "app_flow_edges" USING btree ("flow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_flow_edges_from_node_id_idx" ON "app_flow_edges" USING btree ("from_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_sessions_user_id_created_at_idx" ON "app_sessions" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_sessions_flow_id_idx" ON "app_sessions" USING btree ("flow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_session_messages_session_id_created_at_idx" ON "app_session_messages" USING btree ("session_id","created_at");
