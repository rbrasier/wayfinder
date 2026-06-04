/**
 * phase-scheduler-resume.spec.ts
 *
 * Covers v1.29.0 — scheduler auto-resume.
 *
 * The API heartbeat fires due schedules by POSTing the internal web tick
 * endpoint, which advances the parked session and generates the next message.
 * That endpoint must only fire for the heartbeat: it refuses calls without the
 * shared secret (401 when configured, 503 when the secret is unset). This test
 * asserts the guard — it never supplies the secret, so it never triggers a fire.
 */

import { test, expect } from './helpers/base';

test.describe('Scheduler tick endpoint guard', () => {
  test('rejects an unauthenticated tick request', async ({ page }) => {
    const response = await page.request.post('/api/internal/scheduler/tick');

    // 401 = secret configured but not presented; 503 = secret not configured.
    // Either way the fire path must not run for an unauthenticated caller.
    expect([401, 503]).toContain(response.status());
  });

  test('rejects a tick request bearing the wrong secret', async ({ page }) => {
    const response = await page.request.post('/api/internal/scheduler/tick', {
      headers: { 'x-scheduler-secret': 'definitely-not-the-secret' },
    });

    expect([401, 503]).toContain(response.status());
  });
});
