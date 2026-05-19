ALTER TABLE "core_users" ADD COLUMN "cert_fingerprint" text;--> statement-breakpoint
ALTER TABLE "core_users" ADD COLUMN "cert_subject_dn" text;