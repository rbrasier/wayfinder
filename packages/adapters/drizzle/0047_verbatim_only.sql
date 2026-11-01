-- data-impact: preserved — defaulted boolean column; every existing connection keeps current behaviour
ALTER TABLE "admin_mcp_servers" ADD COLUMN "verbatim_only" boolean DEFAULT false NOT NULL;