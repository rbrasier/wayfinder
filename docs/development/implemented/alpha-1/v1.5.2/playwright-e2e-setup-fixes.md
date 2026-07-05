# Bug Fix: Playwright E2E Test Suite — Setup & Coverage

## Root Cause Diagnosis

Nine issues prevent the E2E suite from running or providing meaningful coverage.

### Critical — tests cannot run at all

**1. Missing `/api/auth/test-session` endpoint**
`auth.setup.ts` POSTs to `/api/auth/test-session` and expects `{ token }` in the JSON response. This endpoint does not exist. The nearest equivalent, `/api/dev-login`, is gated behind `NODE_ENV === 'development'` (not `TEST_AUTH_BYPASS`), checks `ADMIN_SEED_EMAIL` only, and sets a cookie rather than returning the token. The test setup will throw on every run.

**2. Chat tests navigate to the wrong URL**
All four chat tests call `page.goto('/')`. The root page (`(user)/page.tsx`) performs a server-side redirect: admins go to `/admin/flows`, regular users go to `/chats`. The admin session used by the test suite will always be redirected away from `/`. No chat input will ever be found.

**3. Send button selector never matches**
`chat.spec.ts:68` uses `getByRole('button', { name: /send|submit/i })`. The `ChatComposer` button contains the arrow character `↑` — no text matching "send" or "submit". The selector always returns zero elements.

### Infrastructure — test artifacts will pollute the repo

**4. Missing `.gitignore` entries**
`tests/e2e/screenshots/`, `playwright-report/`, `test-results/`, `playwright/.auth/`, and `node_modules/` are not gitignored and will be committed on first run.

### Coverage gaps — key paths untested

**5. `/chats` page not in smoke suite**
The primary end-user page ("My Chats") has no smoke coverage.

**6. Admin pages `/admin/users` and `/admin/sessions` not in smoke suite**

**7. No unauthenticated redirect test**
Nothing verifies that protected routes redirect unauthenticated visitors to `/admin/login`.

**8. Flow canvas selector uses non-existent data-testid attributes**
`flows.spec.ts:87` uses `[data-testid="flow-card"] a, [data-testid="flow-item"]`. No `data-testid` attributes exist anywhere in the UI. The "Edit" link inside `<Button asChild>` is the correct target.

**9. Unreliable 1000ms `waitForTimeout` after flow create**
A fixed sleep is used instead of waiting for the dialog to close.

---

## Fix Plan

| # | File | Change |
|---|------|--------|
| 1 | `apps/web/src/app/api/auth/test-session/route.ts` | Create endpoint gated by `TEST_AUTH_BYPASS=true`; return `{ token }` |
| 2 | `tests/e2e/chat.spec.ts` | Navigate to `/chats`; add session-creation helper for full-chat tests |
| 3 | `apps/web/src/components/chat/chat-composer.tsx` | Add `aria-label="Send message"` to button |
| 3 | `tests/e2e/chat.spec.ts` | Update selector to `/send message/i` |
| 4 | `.gitignore` | Add e2e artifact paths |
| 5–6 | `tests/e2e/smoke.spec.ts` | Add `/chats`, `/admin/users`, `/admin/sessions` to PAGES |
| 7 | `tests/e2e/smoke.spec.ts` | Add unauthenticated redirect test |
| 8 | `tests/e2e/flows.spec.ts` | Replace data-testid selectors with `getByRole('link', { name: 'Edit' })` |
| 9 | `tests/e2e/flows.spec.ts` | Replace `waitForTimeout(1000)` with dialog-close wait |

Version bump: **1.5.1 → 1.5.2** (PATCH — test infrastructure only, no schema change).
