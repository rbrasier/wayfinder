-- data-impact: preserved — one new nullable column with no default, so no
-- existing row is rewritten and none can fail the migration. Sessions issued
-- before this deploy read as null and fall back to created_at for the idle
-- check, which is the last activity those rows can honestly attest to.
ALTER TABLE "core_sessions" ADD COLUMN "last_active_at" timestamp with time zone;