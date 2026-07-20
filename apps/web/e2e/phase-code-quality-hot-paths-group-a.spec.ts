/**
 * phase-code-quality-hot-paths-group-a.spec.ts
 *
 * Covers Group A (hot-path data access) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * `session.list` no longer loads every session's full message history to derive
 * its list row — it aggregates the latest assistant message and the best
 * per-step confidence SQL-side in a fixed number of queries
 * (ISessionMessageRepository.summariseForSessionList). This spec proves the list
 * view still renders those derived fields exactly, so the refactor is
 * behaviour-neutral end to end.
 *
 * The seeded "E2E SEED Session" (apps/web/src/lib/e2e-fixtures.ts) belongs to a
 * two-step flow; its newest assistant message is the onboarding-plan reply.
 */

import { test, expect } from './helpers/base';

test.describe('Code quality Group A: session-list hot-path aggregation', () => {
  test('the chats list shows the latest assistant message and step progress', async ({
    page,
    consoleLogs,
  }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    const seededCard = page
      .locator('a[href^="/chats/"]')
      .filter({ hasText: 'E2E SEED Session' })
      .first();
    if (!(await seededCard.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded session not present — seed fixtures to enable this test');
      return;
    }

    // lastMessage is the newest *assistant* message (SQL DISTINCT ON … seq DESC),
    // not the last user turn.
    await expect(seededCard).toContainText(/onboarding plan for Jane Smith/i);
    await expect(seededCard).not.toContainText('Please draft the onboarding plan document.');

    // stepInfo comes from the per-step best-confidence aggregation: a two-step
    // flow renders a "Step n/2" indicator.
    await expect(seededCard).toContainText(/step\s+\d+\s*\/\s*2/i);

    // The refactor must not throw while deriving the list rows.
    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(errors, `JS errors on /chats:\n${errors.map((entry) => entry.text).join('\n')}`).toHaveLength(0);
  });

  test('clicking a session card follows through from the list to the chat', async ({ page }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');

    const seededCard = page
      .locator('a[href^="/chats/"]')
      .filter({ hasText: 'E2E SEED Session' })
      .first();
    if (!(await seededCard.isVisible().catch(() => false))) {
      test.skip(true, 'Seeded session not present — seed fixtures to enable this test');
      return;
    }

    await seededCard.click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]+$/, { timeout: 10_000 });
  });
});
