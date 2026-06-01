/**
 * chats-card-layout.spec.ts
 *
 * Covers v1.9.3 — Chats card layout enhancement.
 *
 * Visual spec (docs/development/implemented/v1.9.3/phase-chats-card-layout.md):
 *   /chats renders session cards as a single full-width column (not a
 *   multi-column grid). Each card has three sections — icon | content |
 *   progress — with a last-message preview and a step "N/M" progress
 *   indicator.
 */

import { test, expect } from './helpers/base';

test.describe('Chat: Session card layout', () => {
  test('session cards render full-width with progress info', async ({ page, consoleLogs }) => {
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/chats-card-layout.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors on /chats:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);

    const sessionCard = page.locator('a[href^="/chats/"]').first();
    if (!(await sessionCard.isVisible().catch(() => false))) {
      test.skip(true, 'No sessions found — create a flow and session to enable this test');
      return;
    }

    // Step "N/M" progress indicator is part of the card's progress section.
    await expect(page.getByText(/step\s+\d+\s*\/\s*\d+/i).first()).toBeVisible();

    // Full-width: the first card should span most of the list container width.
    const cardBox = await sessionCard.boundingBox();
    const viewport = page.viewportSize();
    if (cardBox && viewport) {
      expect(cardBox.width).toBeGreaterThan(viewport.width * 0.5);
    }
  });
});
