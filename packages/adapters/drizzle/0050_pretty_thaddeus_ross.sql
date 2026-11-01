CREATE TABLE "ai_flow_lesson_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_flow_lesson_evidence_lesson_observation_unique" UNIQUE("lesson_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "ai_flow_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"supersedes_lesson_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_flow_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"distilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_flow_observations_session_node_kind_unique" UNIQUE("session_id","node_id","kind")
);
--> statement-breakpoint
ALTER TABLE "kb_answer_feedback" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_answer_feedback" ADD COLUMN "source" text DEFAULT 'frontline' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_flow_lesson_evidence" ADD CONSTRAINT "ai_flow_lesson_evidence_lesson_id_ai_flow_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."ai_flow_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_flow_lesson_evidence" ADD CONSTRAINT "ai_flow_lesson_evidence_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."ai_flow_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_flow_lessons" ADD CONSTRAINT "ai_flow_lessons_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_flow_lessons" ADD CONSTRAINT "ai_flow_lessons_accepted_by_user_id_core_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."core_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_flow_observations" ADD CONSTRAINT "ai_flow_observations_flow_id_app_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."app_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_flow_observations" ADD CONSTRAINT "ai_flow_observations_session_id_app_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."app_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_flow_lessons_flow_id_status_idx" ON "ai_flow_lessons" USING btree ("flow_id","status");--> statement-breakpoint
CREATE INDEX "ai_flow_lessons_flow_id_node_id_status_idx" ON "ai_flow_lessons" USING btree ("flow_id","node_id","status");--> statement-breakpoint
CREATE INDEX "ai_flow_observations_flow_id_node_id_idx" ON "ai_flow_observations" USING btree ("flow_id","node_id");--> statement-breakpoint
CREATE INDEX "ai_flow_observations_undistilled_idx" ON "ai_flow_observations" USING btree ("flow_id") WHERE "ai_flow_observations"."distilled_at" is null;--> statement-breakpoint
CREATE INDEX "ai_flow_observations_created_at_idx" ON "ai_flow_observations" USING btree ("created_at");