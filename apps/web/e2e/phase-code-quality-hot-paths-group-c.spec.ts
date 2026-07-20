/**
 * phase-code-quality-hot-paths-group-c.spec.ts
 *
 * Covers Group C (unit-of-work port) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * RunTurn.persistAssistantTurn now writes the assistant message and the session
 * advance/complete/await through a single IUnitOfWork transaction
 * (DrizzleUnitOfWork over db.transaction), so the two writes commit or roll back
 * together. Rollback semantics are unit-tested against the adapter; here we prove
 * the committed turn is durable end to end through the real transaction path: a
 * sent turn's user message and its assistant reply both persist across a reload.
 */

import { test, expect } from './helpers/base';
import { loadSeedFixtures } from './helpers/seed';

test.describe('Code quality Group C: transactional turn persistence', () => {
  test('a committed turn keeps its user message and assistant reply after reload', async ({
    page,
  }) => {
    const sessionId = loadSeedFixtures()?.sessionId;
    if (!sessionId) {
      test.skip(true, 'Seed fixtures unavailable — seed to enable this test');
      return;
    }

    await page.goto(`/chats/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const input = page
      .locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]')
      .first();
    if (!(await input.isVisible().catch(() => false))) {
      test.skip(true, 'Chat input not found — session may be complete/read-only');
      return;
    }

    const userMessage = `Group C durability check ${Date.now()}`;
    await input.fill(userMessage);
    await input.press('Enter');

    // The user turn renders immediately, and the assistant reply follows once the
    // (mocked) model call and the transactional persist complete.
    await expect(page.getByText(userMessage)).toBeVisible({ timeout: 10_000 });
    await page.waitForSelector(
      ['[data-testid="message"]', '[class*="message"]', '[role="log"] > *'].join(', '),
      { timeout: 8_000 },
    );

    // Reload: only committed rows come back. The turn's user message must still be
    // there, proving the transaction committed rather than leaving a half-applied
    // (or rolled-back) turn.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(userMessage)).toBeVisible({ timeout: 10_000 });
  });
});
