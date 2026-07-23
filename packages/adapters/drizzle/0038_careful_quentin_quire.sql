CREATE TABLE "app_extraction_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"record_id" uuid,
	"filename" text NOT NULL,
	"tree_path" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_extraction_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aggregate_confidence" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"flow_version_id" uuid NOT NULL,
	"initiated_by_user_id" uuid,
	"mode" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"preview_boundary" smallint DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"done_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"unreadable_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_extraction_documents" ADD CONSTRAINT "app_extraction_documents_run_id_app_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."app_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extraction_documents" ADD CONSTRAINT "app_extraction_documents_record_id_app_extraction_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."app_extraction_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extraction_records" ADD CONSTRAINT "app_extraction_records_run_id_app_extraction_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."app_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extraction_runs" ADD CONSTRAINT "app_extraction_runs_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extraction_runs" ADD CONSTRAINT "app_extraction_runs_flow_version_id_app_flow_versions_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."app_flow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_extraction_runs" ADD CONSTRAINT "app_extraction_runs_initiated_by_user_id_core_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_extraction_documents_run_status_idx" ON "app_extraction_documents" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "app_extraction_documents_record_id_idx" ON "app_extraction_documents" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "app_extraction_records_run_id_idx" ON "app_extraction_records" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "app_extraction_runs_flow_id_idx" ON "app_extraction_runs" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "app_extraction_runs_status_idx" ON "app_extraction_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_extraction_runs_created_at_idx" ON "app_extraction_runs" USING btree ("created_at");