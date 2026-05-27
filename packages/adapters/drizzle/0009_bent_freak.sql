ALTER TABLE "app_flows" ADD COLUMN "visibility" jsonb DEFAULT '{"kind":"private"}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "app_flows" SET "visibility" = '{"kind":"global"}'::jsonb WHERE "status" = 'published';