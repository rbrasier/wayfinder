-- data-impact: preserved — the three new tables are created empty, so their unique constraints cannot meet an existing row; app_sessions.origin defaults to 'manual', which is how every existing session was started, and the other added columns are nullable
CREATE TABLE "admin_event_watch_item_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"last_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_event_watch_item_states_watch_id_item_id_unique" UNIQUE("watch_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "admin_event_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"request_body" jsonb,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"api_key_placement" jsonb,
	"secret_encrypted" text,
	"interval_minutes" integer NOT NULL,
	"items_path" text DEFAULT '' NOT NULL,
	"item_id_path" text DEFAULT '' NOT NULL,
	"condition" jsonb NOT NULL,
	"fire_once_per_item" boolean DEFAULT true NOT NULL,
	"max_runs_per_poll" integer DEFAULT 20 NOT NULL,
	"flow_id" uuid NOT NULL,
	"input_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_as_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"baseline_pending" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failure_threshold" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"paused_reason" text,
	"paused_at" timestamp with time zone,
	"pause_incident_id" uuid,
	"last_polled_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_flow_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"token_hash" text,
	"token_last_four" text,
	"hmac_secret_encrypted" text,
	"run_as_user_id" uuid,
	"created_by" uuid,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_flow_triggers_flow_id_kind_unique" UNIQUE("flow_id","kind"),
	CONSTRAINT "app_flow_triggers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "app_flows" ADD COLUMN "trigger_inputs" jsonb;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "trigger_source_id" uuid;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "trigger_payload" jsonb;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "run_error" jsonb;--> statement-breakpoint
ALTER TABLE "admin_event_watch_item_states" ADD CONSTRAINT "admin_event_watch_item_states_watch_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."admin_event_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_event_watches" ADD CONSTRAINT "admin_event_watches_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_event_watches" ADD CONSTRAINT "admin_event_watches_run_as_user_id_core_users_id_fk" FOREIGN KEY ("run_as_user_id") REFERENCES "public"."core_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_event_watches" ADD CONSTRAINT "admin_event_watches_created_by_core_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_flow_triggers" ADD CONSTRAINT "app_flow_triggers_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_flow_triggers" ADD CONSTRAINT "app_flow_triggers_run_as_user_id_core_users_id_fk" FOREIGN KEY ("run_as_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_flow_triggers" ADD CONSTRAINT "app_flow_triggers_created_by_core_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_event_watches_status_next_poll_at_idx" ON "admin_event_watches" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "app_sessions_trigger_source_id_created_at_idx" ON "app_sessions" USING btree ("trigger_source_id","created_at");