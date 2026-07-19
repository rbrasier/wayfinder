INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
	('mcp', true, 100, 'Enables MCP servers/tools in flow builder and at runtime'),
	('skills', true, 100, 'Enables Skills library and per-step skill selection')
ON CONFLICT ("key") DO NOTHING;
