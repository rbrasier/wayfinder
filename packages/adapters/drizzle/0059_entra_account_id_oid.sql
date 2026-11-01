-- data-impact: preserved — rewrites core_accounts.account_id for Entra rows from the id token's `sub` to its `oid`, read from the row's own stored id_token; no row is deleted, and a row whose token cannot be decoded, carries no oid, or whose oid already has a row is left as it was
-- Better Auth 1.7 keys a Microsoft account on `oid` where 1.6 used `sub`, so an
-- unmigrated row would never match again: the next sign-in would fall back to
-- the email match, add a second account row and run Entra precedence a second
-- time (revoking the user's other sessions). Each row is decoded inside its own
-- exception block so one malformed token cannot fail the whole migration.
DO $$
DECLARE
	entra_account RECORD;
	token_payload TEXT;
	object_id TEXT;
BEGIN
	FOR entra_account IN
		SELECT "id", "account_id", "id_token" FROM "core_accounts"
		WHERE "provider_id" = 'microsoft' AND "id_token" IS NOT NULL
	LOOP
		BEGIN
			token_payload := translate(split_part(entra_account."id_token", '.', 2), '-_', '+/');
			token_payload := token_payload || repeat('=', (4 - length(token_payload) % 4) % 4);
			object_id := convert_from(decode(token_payload, 'base64'), 'UTF8')::jsonb ->> 'oid';
		EXCEPTION WHEN OTHERS THEN
			object_id := NULL;
		END;

		CONTINUE WHEN object_id IS NULL OR object_id = '' OR object_id = entra_account."account_id";
		CONTINUE WHEN EXISTS (
			SELECT 1 FROM "core_accounts"
			WHERE "provider_id" = 'microsoft' AND "account_id" = object_id
		);

		UPDATE "core_accounts"
		SET "account_id" = object_id, "updated_at" = now()
		WHERE "id" = entra_account."id";
	END LOOP;
END $$;
