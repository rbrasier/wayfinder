CREATE TABLE "core_organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "core_organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "core_users" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "core_users" ADD CONSTRAINT "core_users_organisation_id_core_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."core_organisations"("id") ON DELETE set null ON UPDATE no action;