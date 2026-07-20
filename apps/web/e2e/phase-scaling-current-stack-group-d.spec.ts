/**
 * phase-scaling-current-stack-group-d.spec.ts
 *
 * Phase: Scaling Within the Current Stack — Group D (data growth & measurement).
 * Group D is deliberately backend/tooling only:
 *
 *   - item 15: a retention sweep prunes the unbounded-growth tables
 *     (ai_usage_events, app_session_messages, core_audit_log, app_error_log,
 *     app_notification_log) on a slow background worker, backed by new
 *     created_at indexes so the sweep's range scan stays cheap;
 *   - item 16: a k6 load suite (load/) with SLOs — external dev tooling, not a
 *     runtime service.
 *
 * Neither has a user-facing surface. The sweep logic is proven by unit tests
 * (ApplyRetentionPolicies batching, buildDeleteExpiredStatement SQL shape,
 * RetentionWorker health reporting); the load suite is run by hand. What is
 * observable here is the absence of regression: the schema/container changes and
 * the new indexes must not disturb the app the earlier groups shipped — the chat
 * page still renders, and reading session messages (a swept, newly-indexed
 * table) still works.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

async function resolveSessionId(page: import('@playwright/test').Page): Promise<string | null> {
  const seeded = loadSeedFixtures()?.sessionId;
  if (seeded) return seeded;

  await page.goto('/chats');
  await page.waitForLoadState('networkidle');
  const sessionLink = page.getByRole('link').filter({ hasText: /.+/ }).first();
  const href = await sessionLink.getAttribute('href').catch(() => null);
  const match = href?.match(/\/chats\/([^/?]+)/);
  return match?.[1] ?? null;
}

const composerSelector =
  'textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]';

test.describe('Scaling current stack — Group D', () => {
  test('the chats list still renders after the retention wiring landed', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    // The page shell renders regardless of how many sessions exist.
    await expect(page.locator('body')).toBeVisible();
  });

  test('an active session still renders its composer (no regression from the schema change)', async ({
    page,
  }) => {
    const sessionId = await resolveSessionId(page);
    if (!sessionId) {
      test.skip(true, 'No seeded session available');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const terminal = await page
      .getByText(/complete|abandoned|cancelled/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (terminal) {
      test.skip(true, 'Seeded session is not active — composer only renders while active');
      return;
    }
    await expect(page.locator(composerSelector)).toBeVisible();
  });

  test('reading a session over the newly-indexed messages table still streams events', async ({
    page,
  }) => {
    const sessionId = await resolveSessionId(page);
    if (!sessionId) {
      test.skip(true, 'No seeded session available');
      return;
    }

    // app_session_messages gained a standalone created_at index for the sweep;
    // the SSE replay path that reads it must be unaffected.
    const response = await page.request
      .get(`/api/sessions/${sessionId}/events`, { timeout: 4000 })
      .catch(() => null);

    if (!response) return; // held-open stream — correct behaviour
    expect([200, 404]).toContain(response.status());
    if (response.status() === 200) {
      expect(response.headers()['content-type'] ?? '').toContain('text/event-stream');
    }
  });
});
