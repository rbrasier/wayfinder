CREATE TABLE "app_session_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"spec" text NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"next_fire_at" timestamp with time zone NOT NULL,
	"last_fired_at" timestamp with time zone,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"max_occurrences" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_session_schedules" ADD CONSTRAINT "app_session_schedules_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_schedules" ADD CONSTRAINT "app_session_schedules_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_schedules" ADD CONSTRAINT "app_session_schedules_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_schedules_status_next_fire_at_idx" ON "app_session_schedules" USING btree ("status","next_fire_at");--> statement-breakpoint
CREATE INDEX "app_session_schedules_session_id_idx" ON "app_session_schedules" USING btree ("session_id");