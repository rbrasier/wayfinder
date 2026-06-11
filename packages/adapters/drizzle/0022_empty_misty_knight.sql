CREATE TABLE "admin_hr_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"source_format" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_hr_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_session_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"message_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"approver_source" text NOT NULL,
	"suggested_approver_user_id" uuid,
	"approver_user_id" uuid,
	"approver_email" text,
	"is_override" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"record_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_hr_datasets" ADD CONSTRAINT "admin_hr_datasets_uploaded_by_user_id_core_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_hr_rows" ADD CONSTRAINT "admin_hr_rows_dataset_id_admin_hr_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."admin_hr_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_node_id_app_flow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."app_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_requested_by_user_id_core_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_suggested_approver_user_id_core_users_id_fk" FOREIGN KEY ("suggested_approver_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_approver_user_id_core_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_session_approvals" ADD CONSTRAINT "app_session_approvals_decided_by_user_id_core_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_hr_rows_dataset_id_idx" ON "admin_hr_rows" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "admin_hr_rows_data_gin_idx" ON "admin_hr_rows" USING gin ("data");--> statement-breakpoint
CREATE INDEX "app_session_approvals_approver_user_id_status_idx" ON "app_session_approvals" USING btree ("approver_user_id","status");--> statement-breakpoint
CREATE INDEX "app_session_approvals_session_id_idx" ON "app_session_approvals" USING btree ("session_id");