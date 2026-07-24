/**
 * fix-sample-run-never-processes.spec.ts
 *
 * Bug fix: a sample run was created but never processed. `extraction.startSample`
 * materialised the run (status `running`, documents `pending`) and returned; the
 * only thing that advanced a run was the `apps/api` poller, which is env-gated
 * and was off by default. The web app built `AdvanceBatchRuns` but never called
 * it, so the run screen polled `extraction.runStatus` forever at `0 of N`.
 *
 * The fix adds `extraction.tick` — an ownership-gated mutation that advances one
 * run — which the run screen drives while the run is live. This spec asserts the
 * procedure exists and is gated. Before the fix, tRPC answered every call with
 * "No procedure found on path extraction.tick"; after it, an unknown run is
 * rejected on ownership/existence like every other run control.
 *
 * Skip-guarded like the other extraction specs so it is inert without a seeded
 * session.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';
const atLogin = (url: string): boolean => url.includes('/login');

async function trpcMutate(
  page: Page,
  procedure: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    data: { '0': { json: input } },
  });
  return { status: response.status(), body: JSON.stringify((await response.json().catch(() => null)) ?? {}) };
}

test.describe('Synthesise Information — a started run actually processes', () => {
  test('extraction.tick exists and is ownership-gated, never a 500', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    const result = await trpcMutate(page, 'extraction.tick', { runId: UNKNOWN_UUID });

    // The regression guard: the procedure must be routable. Before the fix this
    // body carried "No procedure found on path", which is also a 4xx — so the
    // status alone would not have caught it.
    expect(result.body).not.toContain('No procedure found');
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(result.body.toLowerCase()).not.toContain('internal server error');
  });

  test('the tick is rejected for a run the caller does not own', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    // A random run id resolves to no run the caller can control, so the tick is
    // refused before any document is claimed — a tick is a run control, gated
    // exactly like cancel / retryFailed / continue.
    const tick = await trpcMutate(page, 'extraction.tick', { runId: UNKNOWN_UUID });
    const cancel = await trpcMutate(page, 'extraction.cancel', { runId: UNKNOWN_UUID });

    expect(tick.status).toBe(cancel.status);
  });

  test('the run screen renders its progress strip without crashing', async ({ page }) => {
    await page.goto(`/synthesise/${UNKNOWN_UUID}/runs/${UNKNOWN_UUID}`);
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }
    await page.waitForLoadState('networkidle');

    // An unknown run never resolves a status, so the strip stays in its loading
    // state — but the screen must still render its chrome rather than an
    // unhandled error page.
    const heading = page.getByRole('heading', { name: /Summary of outputs/i });
    const gated = page.getByText(/not (available|enabled)|cannot/i).first();
    await expect(heading.or(gated).first()).toBeVisible();
  });
});
