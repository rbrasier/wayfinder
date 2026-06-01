ALTER TABLE "core_users" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "core_users" ADD COLUMN "team" text;--> statement-breakpoint
INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES ('auto_node', true, 100, 'Enables auto (n8n) nodes in flow builder and at runtime') ON CONFLICT ("key") DO UPDATE SET "enabled" = true;