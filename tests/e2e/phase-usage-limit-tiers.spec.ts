/**
 * phase-usage-limit-tiers.spec.ts
 *
 * Covers v1.55.0 — Usage limit tiers (off / everyone / role / per-user) + the
 * end-user sidebar usage meter (ADR-031).
 *
 * Primary happy path:
 *   1. Admin opens /admin/usage, ensures the "Enforcement" master switch is On,
 *      and adds an Everyone monthly limit.
 *   2. The caps table shows the new limit with a "Everyone" scope, proving the
 *      scope selector + Scope column work end to end.
 *   3. On a user page, the sidebar renders the "Usage" meter (the everyone limit
 *      resolves for the signed-in user).
 *   4. Toggling enforcement Off hides the meter again — configuration is
 *      retained, only enforcement stops.
 *
 * The admin account is also an ordinary user, so its own sidebar meter is the
 * one asserted here (admins see the meter only when a limit resolves for them,
 * the same rule as everyone else).
 *
 * The test restores the original enforcement state and deletes the limit it
 * created so the shared seed stays deterministic.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const UNIQUE_LIMIT = '51.37'; // distinctive value so we can find our own row

async function ensureEnforcementOn(page: Page): Promise<void> {
  await page.goto('/admin/usage');
  await expect(page.getByText(/^Enforcement:/)).toBeVisible({ timeout: 15_000 });
  const turnOn = page.getByRole('button', { name: /turn on/i });
  if (await turnOn.isVisible().catch(() => false)) {
    await turnOn.click();
    await expect(page.getByText(/Enforcement: On/)).toBeVisible();
  }
}

async function deleteOurLimit(page: Page): Promise<void> {
  const row = page.getByRole('row').filter({ hasText: `$${UNIQUE_LIMIT}` });
  if (await row.first().isVisible().catch(() => false)) {
    await row.first().getByRole('button', { name: /delete/i }).click();
    await expect(page.getByRole('row').filter({ hasText: `$${UNIQUE_LIMIT}` })).toHaveCount(0);
  }
}

test.describe('Usage limit tiers + usage meter', () => {
  test.afterEach(async ({ page }) => {
    // Best-effort cleanup: remove our limit, leave enforcement On (the default).
    await page.goto('/admin/usage').catch(() => undefined);
    await deleteOurLimit(page).catch(() => undefined);
  });

  test('admin configures an Everyone limit and the meter appears, then hides when off', async ({
    page,
  }) => {
    await ensureEnforcementOn(page);
    await deleteOurLimit(page); // start clean if a prior run left one behind

    // Scope defaults to Everyone; fill the limit and add it.
    await page.getByLabel('Limit (USD)').fill(UNIQUE_LIMIT);
    await page.getByRole('button', { name: /add limit/i }).click();

    // The caps table shows the new Everyone-scoped limit.
    const ourRow = page.getByRole('row').filter({ hasText: `$${UNIQUE_LIMIT}` });
    await expect(ourRow).toBeVisible({ timeout: 15_000 });
    await expect(ourRow).toContainText('Everyone');

    // On a user page, the sidebar usage meter resolves for the signed-in user.
    await page.goto('/chats');
    const meter = page.getByRole('progressbar', { name: /usage/i });
    await expect(meter).toBeVisible({ timeout: 15_000 });

    // Error path visible to the user: turning enforcement Off hides the meter.
    await page.goto('/admin/usage');
    await page.getByRole('button', { name: /turn off/i }).click();
    await expect(page.getByText(/Enforcement: Off/)).toBeVisible();

    await page.goto('/chats');
    await expect(page.getByRole('progressbar', { name: /usage/i })).toHaveCount(0);

    // Restore enforcement to the default On for the next test.
    await ensureEnforcementOn(page);
  });
});
