-- Append-only enforcement for core_audit_log (ADR-033).
--
-- A reject trigger blocks every UPDATE/DELETE on the audit table, so append-only
-- is enforced by Postgres rather than by convention. The one sanctioned deleter
-- is the retention sweep, which goes through the SECURITY DEFINER function below:
-- it flips a transaction-local flag the trigger honours, and it never touches
-- rows frozen by an active legal hold (resource_id in the excluded set).

CREATE OR REPLACE FUNCTION core_audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only the retention function sets this transaction-local flag before it
  -- deletes; any other UPDATE/DELETE leaves it unset and is rejected here.
  IF current_setting('wayfinder.allow_audit_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'core_audit_log is append-only: % is not permitted', TG_OP;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS core_audit_log_no_mutate ON core_audit_log;
--> statement-breakpoint
CREATE TRIGGER core_audit_log_no_mutate
BEFORE UPDATE OR DELETE ON core_audit_log
FOR EACH ROW
EXECUTE FUNCTION core_audit_log_reject_mutation();
--> statement-breakpoint
-- Sole sanctioned deletion path. SECURITY DEFINER so the transaction-local
-- bypass flag is set inside a trusted function body, not ad hoc by callers.
-- Deletes one bounded, oldest-first batch older than the cutoff, skipping any
-- row whose resource_id is a held session id. Returns the number deleted.
CREATE OR REPLACE FUNCTION core_audit_log_retention_delete(
  p_cutoff timestamptz,
  p_batch integer,
  p_excluded_sessions text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted integer;
BEGIN
  PERFORM set_config('wayfinder.allow_audit_delete', 'on', true);
  WITH doomed AS (
    SELECT id
    FROM core_audit_log
    WHERE created_at < p_cutoff
      AND (resource_id IS NULL OR NOT (resource_id = ANY (p_excluded_sessions)))
    ORDER BY created_at ASC
    LIMIT p_batch
  )
  DELETE FROM core_audit_log
  WHERE id IN (SELECT id FROM doomed);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
