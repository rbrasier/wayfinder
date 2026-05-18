# Database Conventions

All Postgres tables follow a strict naming scheme so the schema stays legible
as it grows. `validate.sh` enforces these rules.

## Table names

`<group>_<thing>` — `snake_case` throughout. The group prefix identifies
which area the table belongs to.

| Prefix   | Use for…                                                           |
| -------- | ------------------------------------------------------------------ |
| `core_`  | users, sessions, organisations, identity primitives                |
| `ai_`    | conversations, messages, model configs, prompts                    |
| `kb_`    | knowledge base, documents, chunks, embeddings                      |
| `admin_` | feature flags, audit logs, internal tools state                    |
| `app_`   | application-specific tables added per project (errors, settings)   |
| `job_`   | background job state (when added later)                            |

Add a new prefix only with an ADR.

### Examples

| ✅ Good                | ❌ Bad                          |
| --------------------- | ------------------------------ |
| `core_users`          | `Users`                        |
| `ai_conversations`    | `conversations`                |
| `kb_document_chunks`  | `kbDocumentChunks`             |
| `app_error_log`       | `errors_table`                 |

## Column names

- `snake_case`
- All tables have `id uuid primary key default gen_random_uuid()`
- All tables have `created_at timestamptz not null default now()` and
  `updated_at timestamptz not null default now()`
- Foreign keys use `<other_table_singular>_id` — e.g. `user_id`, not `userId`.

## Enums vs text-with-check

Prefer Drizzle `text("col", { enum: [...] })` for small, finite sets so the
schema reads inline. Use a Postgres enum type only when the set is shared
across many tables.

## Migration policy

- Generate via `pnpm db:generate` after editing
  `packages/adapters/src/db/schema/*`.
- Commit the generated SQL files alongside the schema change.
- Never edit applied migrations — write a new one.

## Adding a table

1. Pick the prefix.
2. Add the table to a file in `packages/adapters/src/db/schema/<group>.ts`
   (create the file if the group doesn't have one yet — keep grouped tables
   together).
3. Add `id`, `created_at`, `updated_at` like the existing tables.
4. Re-export from `packages/adapters/src/db/schema/index.ts` if it's a new
   file.
5. Run `pnpm db:generate` to produce the SQL migration. Commit both.
6. Run `pnpm db:migrate` locally before opening a PR.

`validate.sh` greps every `pgTable("…")` definition and fails if any name
doesn't match `^(core|ai|kb|admin|app|job)_[a-z_]+$`.
