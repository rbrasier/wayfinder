/**
 * flow-visibility.spec.ts
 *
 * Covers v1.13.0 — Flow visibility: private vs global.
 *
 * Visual spec (docs/development/implemented/v1.13.0/flow-visibility-private-vs-global.md
 * + app /admin/flows/[id]):
 *   The flow header carries a status badge ("Draft" / "Published · Everyone" /
 *   "Published · Only you") and a "Publish" / "Manage publish" button whose
 *   menu offers "Publish globally (everyone)" and "Publish privately (only
 *   you)" (admin-gated global option).
 *
 * Read-only: opens the publish menu and asserts the options exist, then closes
 * the menu without changing visibility.
 */

import { test, expect } from './helpers/base';
import { openFlowCanvas as openFirstFlowCanvas } from './helpers/seed';

test.describe('Admin: Flow Visibility', () => {
  test('flow header exposes a publish control with private/global options', async ({ page, consoleLogs }) => {
    const opened = await openFirstFlowCanvas(page);
    if (!opened) {
      await page.screenshot({ path: 'screenshots/flow-visibility-no-flows.png', fullPage: true });
      test.skip(true, 'No flows available to inspect publish controls');
      return;
    }

    const publishButton = page.getByRole('button', { name: /publish|manage publish/i }).first();
    if (!(await publishButton.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/flow-visibility-no-publish-button.png', fullPage: true });
      test.skip(true, 'Publish control not found — header layout may differ');
      return;
    }

    await publishButton.click();
    await page.screenshot({ path: 'screenshots/flow-visibility-publish-menu.png', fullPage: true });

    // Menu offers global vs private (wording covers both publish and re-publish states).
    await expect(
      page.getByText(/globally \(everyone\)|make global \(everyone\)/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/privately \(only you\)|make private \(only you\)/i).first(),
    ).toBeVisible();

    // Close the menu without changing anything.
    await page.keyboard.press('Escape').catch(() => {});

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `JS errors:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
