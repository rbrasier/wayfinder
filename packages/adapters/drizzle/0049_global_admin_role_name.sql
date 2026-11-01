-- data-impact: preserved — renames one role's display name; key, flags and grants are untouched
-- ADR-066: the is_admin role becomes "Global Admin" now that Technical Admin and
-- User Admin sit beside it. seed-roles.ts never renames a row it did not create,
-- so existing installs need this. Only the default name is replaced, so a name a
-- Global Admin chose themselves survives.
UPDATE "admin_roles" SET "name" = 'Global Admin', "updated_at" = now()
WHERE "key" = 'admins' AND "name" = 'Admins';
