/**
 * fix-scheduler-tick-timestamp-serialization.spec.ts
 *
 * Regression guard for the scheduler-tick 500 (fix:
 * scheduler-tick-timestamp-serialization).
 *
 * Root cause (fixed in this patch):
 *   `buildClaimDueStatement` built the durable-claim UPDATE with a raw Drizzle
 *   `sql` template and interpolated two bare JS `Date` objects (`leaseUntil`,
 *   `now`). A raw sql template applies no column serializer, so postgres.js
 *   received the Date instances directly and threw
 *   "The 'string' argument must be of type string ... Received an instance of
 *   Date" before the query reached Postgres. The tick then returned 500
 *   `INFRA_FAILURE: Failed to claim due schedules.` on EVERY call — the failure
 *   is in parameter serialization, so it happens even when nothing is due.
 *
 * The fix binds the timestamps as ISO strings cast to ::timestamptz.
 *
 * What is tested:
 *   An authenticated tick reaches the claim path and returns a non-500 response
 *   with a `data` body. On the unfixed code the claim throws and the endpoint
 *   answers 500 `{ error: "Failed to claim due schedules." }`.
 *
 * Requires SCHEDULER_TICK_SECRET to be configured on the running stack (set in
 * .github/workflows/e2e.yml). Without it the endpoint returns 503 and there is
 * nothing to exercise, so the test skips.
 */

import { test, expect } from './helpers/base';

const SCHEDULER_TICK_SECRET = process.env.SCHEDULER_TICK_SECRET;

test.describe('fix: scheduler tick serializes timestamptz params', () => {
  test('an authenticated tick claims due schedules without a 500', async ({ page }) => {
    test.skip(!SCHEDULER_TICK_SECRET, 'SCHEDULER_TICK_SECRET not configured for this stack');

    const response = await page.request.post('/api/internal/scheduler/tick', {
      headers: { 'x-scheduler-secret': SCHEDULER_TICK_SECRET as string },
    });

    // The bug surfaced as a 500 with the wrapped INFRA_FAILURE message. The fix
    // lets the claim run to completion and return the fired batch.
    expect(response.status()).not.toBe(500);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('data');
    expect(body).not.toHaveProperty('error');
  });
});
