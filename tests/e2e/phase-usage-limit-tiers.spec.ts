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
 * A budget is globally unique per (period, scope target), so the test starts
 * from a clean slate — it removes every existing limit before adding its own,
 * which also makes it robust to CI retries and any leftover row.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const LIMIT = '51.37';

async function gotoUsageAdmin(page: Page): Promise<void> {
  await page.goto('/admin/usage');
  await expect(page.getByText(/^Enforcement:/)).toBeVisible({ timeout: 20_000 });
}

// Delete every configured limit so neither a seeded row, a prior run, nor a CI
// retry can collide with the (period, scope) uniqueness constraint.
async function clearAllLimits(page: Page): Promise<void> {
  await expect(
    page
      .getByText('No limits configured.')
      .or(page.getByRole('button', { name: /^Delete$/ }).first()),
  ).toBeVisible({ timeout: 20_000 });

  for (let guard = 0; guard < 25; guard++) {
    const deleteButton = page.getByRole('button', { name: /^Delete$/ }).first();
    if (!(await deleteButton.isVisible().catch(() => false))) break;
    await deleteButton.click();
    // Wait for the row count to shrink before the next iteration.
    await page.waitForTimeout(200);
  }
  await expect(page.getByText('No limits configured.')).toBeVisible({ timeout: 20_000 });
}

async function ensureEnforcementOn(page: Page): Promise<void> {
  const turnOn = page.getByRole('button', { name: /turn on/i });
  if (await turnOn.isVisible().catch(() => false)) {
    await turnOn.click();
    await expect(page.getByText('Enforcement: On')).toBeVisible();
  }
}

test.describe('Usage limit tiers + usage meter', () => {
  test.afterEach(async ({ page }) => {
    // Best-effort: leave the DB clean and enforcement On (the default).
    await gotoUsageAdmin(page).catch(() => undefined);
    await clearAllLimits(page).catch(() => undefined);
    await ensureEnforcementOn(page).catch(() => undefined);
  });

  test('admin configures an Everyone limit and the meter appears, then hides when off', async ({
    page,
  }) => {
    await gotoUsageAdmin(page);
    await clearAllLimits(page);
    await ensureEnforcementOn(page);

    // Scope defaults to Everyone; fill the limit and add it.
    await page.getByLabel('Limit (USD)').fill(LIMIT);
    await page.getByRole('button', { name: /add limit/i }).click();

    // The caps table shows the new Everyone-scoped limit.
    const ourRow = page.getByRole('row').filter({ hasText: `$${LIMIT}` });
    await expect(ourRow).toBeVisible({ timeout: 20_000 });
    await expect(ourRow).toContainText('Everyone');

    // On a user page, the sidebar usage meter resolves for the signed-in user.
    await page.goto('/chats');
    await expect(page.getByRole('progressbar', { name: /usage/i })).toBeVisible({
      timeout: 20_000,
    });

    // Error path visible to the user: turning enforcement Off hides the meter.
    await gotoUsageAdmin(page);
    await page.getByRole('button', { name: /turn off/i }).click();
    await expect(page.getByText('Enforcement: Off')).toBeVisible();

    await page.goto('/chats');
    await expect(page.getByRole('progressbar', { name: /usage/i })).toHaveCount(0, {
      timeout: 20_000,
    });
  });
});
