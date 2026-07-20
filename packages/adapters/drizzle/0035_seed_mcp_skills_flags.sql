-- ADR-041 §4: Skills and MCP default OFF. The rows exist so both features
-- surface in admin UI (alongside the code-level DEFAULT_FEATURE_FLAGS), but an
-- admin must explicitly enable them (e.g. via the first-run setup wizard).
INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
	('mcp', false, 100, 'Enables MCP servers/tools in flow builder and at runtime'),
	('skills', false, 100, 'Enables Skills library and per-step skill selection')
ON CONFLICT ("key") DO NOTHING;
