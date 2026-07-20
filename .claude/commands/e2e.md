# /e2e — Run Playwright E2E Tests via MCP

Run the full Playwright e2e test suite using the MCP Playwright browser connector
and report results with any failures diagnosed and remediated.

---

## Setup checks

Before running tests, verify:

1. The dev server is reachable at `http://localhost:3000` — use `mcp__playwright__browser_navigate`
   to load the root URL and confirm the page responds.
2. `playwright/.auth/admin.json` exists under `apps/web/e2e/`. If it does not, the auth
   setup project will create it on first run (requires the server to be running with
   `TEST_AUTH_BYPASS=true` in `apps/web/.env.local`).

---

## How to run

Before executing the test suite, record the current timestamp in milliseconds:

```javascript
const TEST_START_MS = Date.now();
```

Then execute from the `apps/web/e2e/` directory:

```bash
cd apps/web/e2e && npx playwright test --config=playwright.config.ts 2>&1
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

## Cleanup: delete test data

After producing the results report, delete flows and sessions created during the
run so they do not accumulate across repeated test executions.

### 1. Delete E2E flows

Navigate to `http://localhost:3000` to ensure fetch calls are on the correct
origin (session cookies are origin-scoped), then use
`mcp__playwright__browser_evaluate` to list and delete every flow whose name
starts with `E2E ` (the prefix all test flows use):

```javascript
async () => {
  const res = await fetch(
    '/api/trpc/flow.listMine?batch=1&input=' +
      encodeURIComponent(JSON.stringify({ "0": { "json": null } }))
  );
  const data = await res.json();
  const flows = data[0]?.result?.data?.json ?? [];

  const toDelete = flows.filter(f => f.name.startsWith('E2E '));
  for (const flow of toDelete) {
    await fetch('/api/trpc/flow.delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ "0": { "json": { flowId: flow.id } } }),
    });
  }
  return toDelete.map(f => f.name);
}
```

Log the returned names so the cleanup is visible.

### 2. Close test sessions

Close any sessions created at or after `TEST_START_MS` (the timestamp recorded
before the run):

```javascript
async (testStartMs) => {
  const res = await fetch(
    '/api/trpc/session.list?batch=1&input=' +
      encodeURIComponent(JSON.stringify({ "0": { "json": null } }))
  );
  const data = await res.json();
  const sessions = data[0]?.result?.data?.json ?? [];

  const toClose = sessions.filter(
    s => new Date(s.createdAt).getTime() >= testStartMs
  );
  for (const session of toClose) {
    await fetch('/api/trpc/session.close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ "0": { "json": { sessionId: session.id } } }),
    });
  }
  return toClose.length;
}
```

Pass `TEST_START_MS` as the argument. Log the count of sessions closed.

> The tRPC endpoints use a superjson transformer. For plain UUID inputs no
> extra `meta` wrapper is needed — `{"0":{"json":{...}}}` is sufficient.

---

## Fixing failures

If failures are found, don't fix them immediately. Note them in the recommendations with enough context to understand what failed and why, and the recommended approach to fix. 

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
