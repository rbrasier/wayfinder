ALTER TABLE "core_organisations" ADD COLUMN "email_domain" text;--> statement-breakpoint
ALTER TABLE "admin_groups" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_groups" ADD CONSTRAINT "admin_groups_organisation_id_core_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."core_organisations"("id") ON DELETE set null ON UPDATE no action;