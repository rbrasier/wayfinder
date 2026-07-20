# Wayfinder E2E Tests

End-to-end tests using Playwright. Lives **inside the Wayfinder repo** at `apps/web/e2e/`.

---

## How it works

### AI mock vs real — the core toggle

Every push runs tests with **mocked AI**. The test fixture intercepts HTTP calls to
`api.anthropic.com`, `api.openai.com`, and Wayfinder's internal `/api/chat` route,
returning fixture responses instantly. No API key needed, no cost, fast.

When you want a **real integration test** (i.e. actual AI responses flowing through),
trigger the workflow manually from the GitHub Actions UI and select `use_real_ai: true`.
You'll need `ANTHROPIC_API_KEY` set as a GitHub secret for that run.

```
Every push   →  USE_REAL_AI=false  →  mock responses, ~2min run, no cost
Manual run   →  USE_REAL_AI=true   →  real Anthropic API, slower, uses credits
```

### What gets captured

Every test captures:
- **Screenshot** of the full page at the end of each meaningful step
- **Console logs** (all levels) attached to the test in the HTML report
- **Console errors** surfaced prominently — if there's a JS error, the test fails
- **Failed network requests** (4xx/5xx) checked in smoke tests
- **Video** of the browser session (retained only on failure)
- **Trace** (DOM snapshots + network timeline, retained only on failure)

---

## File structure (where to add to the Wayfinder repo)

```
wayfinder/                         ← your existing repo root
  tests/
    e2e/                           ← all of this lives here
      playwright.config.ts
      package.json
      auth.setup.ts
      smoke.spec.ts
      flows.spec.ts
      chat.spec.ts
      helpers/
        base.ts                    ← extended fixture: console capture + AI mock
      fixtures/
        ai-responses.ts            ← canned AI response payloads
      playwright/
        .auth/                     ← gitignored; session state saved here
      playwright-report/           ← gitignored; HTML report output
      screenshots/                 ← gitignored; per-test screenshots
      test-results/                ← gitignored; traces and videos
  .github/
    workflows/
      e2e.yml                      ← CI workflow
```

---

## One-time setup

### 1. Add to your `.env`

```
TEST_AUTH_BYPASS=true
TEST_ADMIN_EMAIL=admin@example.com   # match your ADMIN_SEED_EMAIL
```

Restart the app after adding these.

### 2. Add to `.gitignore`

```gitignore
apps/web/e2e/playwright-report/
apps/web/e2e/test-results/
apps/web/e2e/screenshots/
apps/web/e2e/playwright/.auth/
apps/web/e2e/node_modules/
```

### 3. Install Playwright

```bash
cd apps/web/e2e
npm install
npx playwright install --with-deps chromium
```

---

## Running tests locally

Start Wayfinder first (`docker compose up` or your local dev setup), then:

```bash
cd apps/web/e2e

npm test                    # all tests, mocked AI
npm run test:smoke          # just smoke checks
npm run test:flows          # just flows tests
npm run test:chat           # just chat tests
npm run test:real-ai        # all tests, real Anthropic API (needs ANTHROPIC_API_KEY)
```

### View the HTML report

```bash
npm run report
# Opens at http://localhost:9323
# Shows every test with: pass/fail, screenshot, console logs, errors
```

---

## Running away from your desk (GitHub Actions)

### Automatic (every push)
The workflow runs automatically. Go to **Actions → E2E Tests** to see results.
Download the `playwright-report-N` artifact and open `index.html` to see the full report.

### Manual with real AI
1. Go to **Actions → E2E Tests (Playwright)**
2. Click **Run workflow**
3. Set `use_real_ai` to `true`
4. Click **Run workflow**

### Required GitHub secrets
Go to **Settings → Secrets and variables → Actions**:

| Secret | Required for |
|---|---|
| `ANTHROPIC_API_KEY` | Real AI runs only |
| `BETTER_AUTH_SECRET` | All runs (or it uses a default test value) |

---

## Adding new tests

Import from `./helpers/base` instead of `@playwright/test` to get console capture and AI mocking automatically:

```typescript
import { test, expect } from './helpers/base';

test('my new test', async ({ page, consoleLogs }) => {
  await page.goto('/some-page');
  await page.screenshot({ path: 'screenshots/my-new-test.png', fullPage: true });

  // This automatically fails the test if there are JS errors
  const errors = consoleLogs.filter(l => l.type === 'error');
  expect(errors).toHaveLength(0);
});
```

## Adding new mock AI responses

Edit `fixtures/ai-responses.ts` to add responses for specific workflow steps:

```typescript
export const MOCK_RESPONSES = {
  // ... existing responses ...
  myNewStep: "Here's what I say at this step of the workflow.",
};
```

Then update `pickResponse()` in `helpers/base.ts` to use it based on message content.
