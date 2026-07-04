ALTER TABLE "app_session_typing" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app_session_typing" CASCADE;--> statement-breakpoint
ALTER TABLE "app_session_messages" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "app_session_messages_session_id_seq_idx" ON "app_session_messages" USING btree ("session_id","seq");