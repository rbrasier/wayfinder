CREATE TABLE "app_flow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"version_number" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_flow_versions_flow_id_version_number_unique" UNIQUE("flow_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD COLUMN "flow_version_id" uuid;--> statement-breakpoint
ALTER TABLE "app_flow_versions" ADD CONSTRAINT "app_flow_versions_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_flow_versions" ADD CONSTRAINT "app_flow_versions_published_by_user_id_core_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_flow_versions_flow_id_idx" ON "app_flow_versions" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_flow_versions_one_draft_idx" ON "app_flow_versions" USING btree ("flow_id") WHERE status = 'draft';--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_flow_version_id_app_flow_versions_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."app_flow_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_sessions_flow_version_id_idx" ON "app_sessions" USING btree ("flow_version_id");--> statement-breakpoint
-- Back-fill: one published version_number = 1 per already-published flow,
-- snapshotting its current definition so history is complete from day one.
INSERT INTO "app_flow_versions" ("flow_id", "version_number", "status", "snapshot", "change_summary", "published_by_user_id", "published_at")
SELECT
	f."id",
	1,
	'published',
	jsonb_build_object(
		'flow', jsonb_build_object(
			'name', f."name",
			'description', f."description",
			'icon', f."icon",
			'expertRole', f."expert_role",
			'contextDocs', f."context_docs"
		),
		'nodes', COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'id', n."id",
				'type', n."type",
				'name', n."name",
				'colour', n."colour",
				'positionX', n."position_x",
				'positionY', n."position_y",
				'config', n."config"
			))
			FROM "app_flow_nodes" n WHERE n."flow_id" = f."id"
		), '[]'::jsonb),
		'edges', COALESCE((
			SELECT jsonb_agg(jsonb_build_object(
				'id', e."id",
				'fromNodeId', e."from_node_id",
				'toNodeId', e."to_node_id"
			))
			FROM "app_flow_edges" e WHERE e."flow_id" = f."id"
		), '[]'::jsonb)
	),
	'Initial version (back-filled on migration)',
	f."owner_user_id",
	now()
FROM "app_flows" f
WHERE f."status" = 'published' AND f."deleted_at" IS NULL;--> statement-breakpoint
-- Pin every existing session to its flow's back-filled version so in-progress
-- chats remain stable. Draft-only flows have no version, so their sessions stay null.
UPDATE "app_sessions" s
SET "flow_version_id" = v."id"
FROM "app_flow_versions" v
WHERE v."flow_id" = s."flow_id" AND v."version_number" = 1 AND s."flow_version_id" IS NULL;
