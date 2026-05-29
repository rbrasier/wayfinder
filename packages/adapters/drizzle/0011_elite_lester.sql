CREATE TABLE "app_session_step_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"message_id" uuid,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_session_step_outputs" ADD CONSTRAINT "app_session_step_outputs_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_step_outputs" ADD CONSTRAINT "app_session_step_outputs_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_step_outputs" ADD CONSTRAINT "app_session_step_outputs_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_step_outputs" ADD CONSTRAINT "app_session_step_outputs_message_id_app_session_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."app_session_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_session_step_outputs_flow_id_idx" ON "app_session_step_outputs" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "app_session_step_outputs_session_id_idx" ON "app_session_step_outputs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "app_session_step_outputs_node_id_idx" ON "app_session_step_outputs" USING btree ("node_id");