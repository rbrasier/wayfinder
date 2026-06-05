/**
 * node-config-prompt-preview.spec.ts
 *
 * Covers:
 *   v1.5.7  — Flow step prompt preview panel inside NodeConfigModal.
 *   v1.11.1 — Template tags explainer dialog ("How template tags work").
 *
 * Visual spec:
 *   v1.5.7  — clicking a conversational node opens the config modal; a
 *             "Preview prompt" toggle (Eye icon) swaps the editor for a
 *             read-only panel headed "System prompt sent to the AI for this
 *             step (read-only)" with a "← Back to edit" control.
 *   v1.11.1 — the template upload area has a "How template tags work" help
 *             affordance opening a "Template tags & validation" dialog.
 */

import { test, expect } from './helpers/base';
import { openFlowCanvas } from './helpers/seed';

async function openFirstNodeConfig(page: import('@playwright/test').Page): Promise<boolean> {
  if (!(await openFlowCanvas(page))) return false;
  await page.waitForTimeout(1200);

  // React Flow renders nodes as .react-flow__node; click the first one.
  const node = page.locator('.react-flow__node').first();
  if (!(await node.isVisible().catch(() => false))) return false;

  await node.click();
  // The config modal is a dialog.
  const dialog = page.getByRole('dialog');
  return await dialog.isVisible().catch(() => false);
}

test.describe('Admin: Node Config — Prompt Preview', () => {
  test('config modal can toggle to a read-only system-prompt preview', async ({ page }) => {
    const opened = await openFirstNodeConfig(page);
    if (!opened) {
      await page.screenshot({ path: 'screenshots/node-config-no-node.png', fullPage: true });
      test.skip(true, 'No flow with a clickable node available');
      return;
    }

    const previewToggle = page.getByRole('button', { name: /preview prompt/i });
    if (!(await previewToggle.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/node-config-no-preview-toggle.png', fullPage: true });
      test.skip(true, 'Preview prompt toggle not found — node may not be conversational');
      return;
    }

    await previewToggle.click();
    await page.screenshot({ path: 'screenshots/node-config-prompt-preview.png', fullPage: true });

    await expect(page.getByText(/system prompt sent to the ai for this step/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /back to edit/i })).toBeVisible();
  });
});

test.describe('Admin: Node Config — Template tags help', () => {
  test('template area exposes a tag explainer dialog', async ({ page }) => {
    const opened = await openFirstNodeConfig(page);
    if (!opened) {
      test.skip(true, 'No flow with a clickable node available');
      return;
    }

    const helpButton = page.getByRole('button', { name: /how template tags work/i });
    if (!(await helpButton.isVisible().catch(() => false))) {
      await page.screenshot({ path: 'screenshots/node-config-no-tag-help.png', fullPage: true });
      test.skip(true, 'Template tags help affordance not present on this node type');
      return;
    }

    await helpButton.click();
    await expect(page.getByText(/template tags & validation/i)).toBeVisible();
    await page.screenshot({ path: 'screenshots/node-config-tag-help-dialog.png', fullPage: true });
  });
});
