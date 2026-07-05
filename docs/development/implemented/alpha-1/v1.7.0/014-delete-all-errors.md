# Delete All Errors

**Version:** 1.7.0 (MINOR — new use case + API endpoint)
**Date:** 2026-05-24

---

## What changes and why

Admins need a way to bulk-clear the error log. Currently they can only update
individual or group statuses. A "Delete all" button in the top-right of the
`/admin/errors` page will permanently delete every row in `app_error_log`,
with a confirmation modal to prevent accidental data loss.

---

## Layers affected

| Layer | Change |
|-------|--------|
| `packages/domain` | Add `deleteAll(): Promise<Result<number>>` to `IErrorLogRepository` |
| `packages/adapters` | Implement `deleteAll()` in `DrizzleErrorLogRepository` — `DELETE FROM app_error_log` |
| `packages/application` | New `DeleteAllErrors` use case |
| `apps/web/src/lib/container.ts` | Wire `deleteAllErrors` |
| `apps/web/src/server/routers/error.ts` | Add `deleteAll` admin mutation |
| `apps/web/src/app/(admin)/admin/errors/_content.tsx` | "Delete all" button + confirmation dialog |

No DB schema change — pure data operation.

---

## UI behaviour

- "Delete all" button placed in `CardHeader` alongside the title (top-right, matching other pages)
- Clicking opens a confirmation dialog: "This will permanently delete all error log entries. This cannot be undone."
- Confirm triggers the mutation; on success, invalidates `listGrouped` and `listInGroup`
- Button is disabled while the mutation is pending
