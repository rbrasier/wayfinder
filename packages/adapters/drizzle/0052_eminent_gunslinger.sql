-- data-impact: preserved — both statements widen what a row may hold. DROP NOT NULL lets an
-- analyse run carry no flow_version_id (ADR-060 §2); every existing row keeps the value it has.
-- The added column is nullable with no default, so existing rows read null, which is exactly
-- "no worker holds a claim on this run".
ALTER TABLE "app_extraction_runs" ALTER COLUMN "flow_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_extraction_runs" ADD COLUMN "analysis_claimed_at" timestamp with time zone;