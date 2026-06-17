CREATE TABLE "app_usage_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"limit_usd" real NOT NULL,
	"warn_threshold_pct" smallint DEFAULT 80 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "flow_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "app_usage_budgets" ADD CONSTRAINT "app_usage_budgets_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_usage_budgets_user_id_period_unique" ON "app_usage_budgets" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "app_usage_budgets_user_id_idx" ON "app_usage_budgets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_flow_id_created_at_idx" ON "ai_usage_events" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_session_id_idx" ON "ai_usage_events" USING btree ("session_id");