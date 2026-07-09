# Enhancement: Change Password in User Settings

## What & Why

Users need a self-service way to update their password without contacting an administrator. A "Change password" button on the `/settings` page opens a modal that accepts the current password, a new password, and a confirmation field. Better Auth 1.6.14 already exposes a `/change-password` endpoint; no DB migration or new backend code is required.

## Scope

- **In scope:** User settings page (`/settings`) only.
- **Out of scope:** Admin panel, password reset via email, forced password rotation.

## User Flow

1. User opens `/settings`.
2. Clicks "Change password" button (below the email field in the Profile card).
3. Modal opens with three fields: Current password, New password, Confirm new password.
4. On submit:
   - Client-side: new password must be ≥ 8 characters and match confirmation.
   - Server-side: `authClient.changePassword({ currentPassword, newPassword })` is called.
   - Success → success toast, modal closes, fields reset.
   - Failure (wrong current password, etc.) → inline error message in modal.
5. Clicking Cancel or pressing Escape closes the modal without changes.

## Files Changed

| File | Action |
|------|--------|
| `apps/web/src/components/settings/change-password-modal.tsx` | New — modal component |
| `apps/web/src/components/settings/profile-settings-form.tsx` | Modified — add button + render modal |

## No DB / API Changes

Better Auth's `/change-password` route is already registered via the catch-all auth handler at `apps/web/src/app/api/auth/[...all]/route.ts`. The `authClient` created by `createAuthClient()` already exposes `authClient.changePassword()`.

## Version Bump

PATCH — 1.31.4 → 1.31.5 (UI addition, no schema or API surface changes).

---

## Implementation Summary

**Approach:** Better Auth 1.6.14 exposes `authClient.changePassword({ currentPassword, newPassword })` as a built-in endpoint. No tRPC mutation, DB migration, or adapter changes were needed.

**Files changed:**

- `apps/web/src/components/settings/change-password-modal.tsx` — New modal component. Wraps three password inputs in the standard `Dialog` / `DialogBody` / `DialogFooter` pattern. Client-side validates minimum length (8 chars) and confirmation match before calling `authClient.changePassword`. Shows an inline error on API failure; shows a success toast and resets fields on success.

- `apps/web/src/components/settings/profile-settings-form.tsx` — Added `showChangePassword` state, a "Change password" outline button (left side of the save row), and renders `<ChangePasswordModal>`.

**E2e test:** `tests/e2e/enhance-change-password-settings.spec.ts` — covers button visibility, modal open with all three fields, mismatch validation error, and Cancel close behaviour.
