-- data-impact: preserved — inserts only; ON CONFLICT DO NOTHING leaves any flag row, scoping or grant an admin already set untouched
INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
	('event_watch', true, 100, 'Admin Event Watch: poll external APIs and start flows'),
	('ai_task_node', true, 100, 'AI task step: unattended AI instruction with reviewer fallback'),
	('email_node', true, 100, 'Email step: send results to users, groups and inboxes')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- seed-roles.ts only scopes flags when it creates the Power Users role, so an
-- install whose roles already exist would otherwise expose these to everyone.
-- On a fresh install the roles do not exist yet and this inserts nothing.
INSERT INTO "admin_feature_flag_roles" ("flag_key", "role_id")
SELECT seeded.flag_key, roles.id
FROM (VALUES ('event_watch', 'admins'), ('ai_task_node', 'power_users'), ('email_node', 'power_users')) AS seeded(flag_key, role_key)
JOIN "admin_roles" roles ON roles.key = seeded.role_key
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Same reason: default grants are written only for roles seed-roles.ts creates.
INSERT INTO "admin_role_permissions" ("role_id", "permission_key")
SELECT roles.id, 'flow:webhook_trigger' FROM "admin_roles" roles WHERE roles.key = 'power_users'
ON CONFLICT DO NOTHING;
