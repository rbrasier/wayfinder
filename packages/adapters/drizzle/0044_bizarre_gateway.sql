-- data-impact: preserved — the new mode column is defaulted, so every existing
-- session row backfills to 'live' and no read changes meaning. The two index
-- drops are immediately re-created with mode folded in; an index holds no rows,
-- so nothing is lost, though both are rebuilt in place on a live table.
CREATE TABLE "app_flow_test_fixtures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_node_id" uuid NOT NULL,
	"gathered_context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step_outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "app_sessions_user_id_created_at_idx";--> statement-breakpoint
DROP INDEX "app_sessions_flow_id_idx";--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_flow_test_fixtures" ADD CONSTRAINT "app_flow_test_fixtures_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_flow_test_fixtures" ADD CONSTRAINT "app_flow_test_fixtures_created_by_user_id_core_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_flow_test_fixtures_flow_id_created_by_idx" ON "app_flow_test_fixtures" USING btree ("flow_id","created_by_user_id");--> statement-breakpoint
CREATE INDEX "app_sessions_user_id_created_at_idx" ON "app_sessions" USING btree ("user_id","mode","created_at");--> statement-breakpoint
CREATE INDEX "app_sessions_flow_id_idx" ON "app_sessions" USING btree ("flow_id","mode");