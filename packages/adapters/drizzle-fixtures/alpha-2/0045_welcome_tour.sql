-- data-impact: preserved — accounts that exist when this runs have already signed in, so they are stamped as having seen the welcome tour; new accounts start null and are shown it (ADR-056 §1)
ALTER TABLE "core_users" ADD COLUMN "welcome_tour_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "core_users" SET "welcome_tour_completed_at" = now();
