CREATE TABLE "kb_lookup_source_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"display" text NOT NULL,
	"key" text,
	"version" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_lookup_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_field" text NOT NULL,
	"key_field" text,
	"credential" text,
	"cache_ttl_seconds" integer DEFAULT 3600 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_lookup_sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "kb_lookup_source_entries" ADD CONSTRAINT "kb_lookup_source_entries_source_id_kb_lookup_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_lookup_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_lookup_source_entries_source_id_idx" ON "kb_lookup_source_entries" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "kb_lookup_source_entries_display_idx" ON "kb_lookup_source_entries" USING btree ("source_id","display");