CREATE INDEX "core_audit_log_created_at_idx" ON "core_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_error_log_created_at_idx" ON "app_error_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_notification_log_created_at_idx" ON "app_notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "app_session_messages_created_at_idx" ON "app_session_messages" USING btree ("created_at");