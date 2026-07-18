CREATE TABLE "app_legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"scope" jsonb NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core_audit_log" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "core_audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "core_audit_log" ADD COLUMN "hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "app_legal_holds" ADD CONSTRAINT "app_legal_holds_created_by_core_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_legal_holds_released_at_idx" ON "app_legal_holds" USING btree ("released_at");--> statement-breakpoint
CREATE UNIQUE INDEX "core_audit_log_sequence_idx" ON "core_audit_log" USING btree ("sequence");