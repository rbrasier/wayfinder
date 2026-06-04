CREATE TABLE "app_session_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"occurrence" integer NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"next_fire_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_session_schedule_runs" ADD CONSTRAINT "app_session_schedule_runs_schedule_id_app_session_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."app_session_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_schedule_runs" ADD CONSTRAINT "app_session_schedule_runs_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_schedule_runs" ADD CONSTRAINT "app_session_schedule_runs_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_schedule_runs" ADD CONSTRAINT "app_session_schedule_runs_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_schedule_runs_created_at_idx" ON "app_session_schedule_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_session_schedule_runs_schedule_id_idx" ON "app_session_schedule_runs" USING btree ("schedule_id");