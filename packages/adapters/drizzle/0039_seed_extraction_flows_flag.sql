INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
	('extraction_flows', true, 100, 'Enables the Synthesise Information extraction-flows surface')
ON CONFLICT ("key") DO NOTHING;
