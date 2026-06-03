# /e2e — Run Playwright E2E Tests via MCP

Run the full Playwright e2e test suite using the MCP Playwright browser connector
and report results with any failures diagnosed and remediated.

---

## Setup checks

Before running tests, verify:

1. The dev server is reachable at `http://localhost:3000` — use `mcp__playwright__browser_navigate`
   to load the root URL and confirm the page responds.
2. `playwright/.auth/admin.json` exists under `tests/e2e/`. If it does not, the auth
   setup project will create it on first run (requires the server to be running with
   `TEST_AUTH_BYPASS=true` in `apps/web/.env.local`).

---

## How to run

Execute from the `tests/e2e/` directory:

```bash
cd tests/e2e && npx playwright test --config=playwright.config.ts 2>&1
```

Do **not** pass `TEST_AUTH_BYPASS=true` on the command line — the server reads it
from `.env.local` and the auth setup no longer has a redundant process-env guard.

---

## Interpreting results

After the run, produce a structured report with four sections:

### 1. Summary table

| Status | Count |
|--------|-------|
| Passed | N |
| Failed | N |
| Skipped | N |

### 2. Failures (if any)

For each failure:
- Test name and file
- Error message (verbatim, first 3 lines)
- Root cause (diagnosed, not assumed — read relevant source files before concluding)
- Proposed fix

### 3. Skips

List each skipped test and categorise it:
- **By design** — skips that require specific DB state (sessions, flows, confidence scores).
  These are expected and not actionable.
- **Needs investigation** — skips whose guard condition should be satisfied but isn't.

### 4. Recommendations

Actionable next steps only. Do not list "by design" skips as action items.

---

## Fixing failures

If failures are found, fix them immediately unless the fix requires a schema change or
new feature (in which case note it and stop):

1. Read the failing test file and any source files it exercises.
2. Apply the minimal fix — do not refactor surrounding code.
3. Re-run the affected spec in isolation to confirm the fix:
   ```bash
   cd tests/e2e && npx playwright test --config=playwright.config.ts <spec-file> 2>&1
   ```
4. Re-run the full suite to confirm no regressions.
5. Commit all fixes in a single commit with message format:
   `fix: repair e2e <short description>`

---

## Known fragile areas (check these first when diagnosing)

- **Mock route pattern** (`helpers/base.ts`): must match only stream endpoints
  (`/\/api\/chat\/[^/]+\/stream/`), not broader paths like `/api/chat` which would
  intercept `GET /uploads` and break JSON parsing in `ChatComposer`.
- **Send button vs Enter key**: the Next.js dev overlay portal covers the bottom-right
  viewport corner in headless mode. Always use `input.press('Enter')` rather than
  clicking the send button in chat tests.
- **Sidebar vs main-content links**: `a[href^="/chats/"]` matches both nav sidebar links
  and session cards. Filter by content (e.g. `hasText: /step\s+\d+/i`) to target cards.
- **Strict mode violations**: locators that match more than one element will throw.
  Add `.first()` or a more specific selector.
- **Auth state invalidation**: the logout test (`fix-logout-and-register-sidebar.spec.ts`)
  destroys the server-side session. In CI the setup project regenerates it each run.
  Locally, if tests fail with 401/redirect-to-login after the logout test, re-run the
  full suite (setup project will refresh the token).
