/**
 * flows.spec.ts
 *
 * Tests the Admin → Flows section: listing, creating, and opening flows.
 * Every meaningful state gets a screenshot so you can see exactly what
 * the UI looked like at each step.
 */

import { test, expect } from './helpers/base';

test.describe('Flows — List page', () => {
  test('flows list loads and shows heading', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /flows/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/flows-list.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors on flows list: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('create new flow button is visible and clickable', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /new flow|create flow|add flow/i });
    await expect(createBtn).toBeVisible();
    await page.screenshot({ path: 'screenshots/flows-create-button-visible.png' });
  });
});

test.describe('Flows — Create flow', () => {
  test('opening create dialog/modal — screenshot the result', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /new flow|create flow|add flow/i });
    await createBtn.click();

    // Wait briefly for any animation
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/flows-create-opened.png', fullPage: true });

    // Check for errors triggered by opening the dialog
    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors after clicking create: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('create a flow with a name — screenshot after save', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /new flow|create flow|add flow/i });
    await createBtn.click();
    await page.waitForTimeout(300);

    const nameInput = page.getByLabel(/name|title/i).first();
    const hasInput = await nameInput.isVisible().catch(() => false);

    if (!hasInput) {
      await page.screenshot({ path: 'screenshots/flows-create-no-input-found.png', fullPage: true });
      test.skip(true, 'Name input not found — UI structure may differ, see screenshot');
      return;
    }

    const flowName = `E2E Test Flow ${Date.now()}`;
    await nameInput.fill(flowName);

    const submitBtn = page.getByRole('button', { name: /create|save|submit/i });
    await submitBtn.click();

    // Wait for navigation or state change
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/flows-after-create.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors after creating flow: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Flows — Canvas editor', () => {
  test('opening a flow shows the canvas — screenshot the result', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const flowLinks = page.locator('table tbody tr a, [data-testid="flow-card"] a, [data-testid="flow-item"]');
    const count = await flowLinks.count();

    if (count === 0) {
      await page.screenshot({ path: 'screenshots/flows-canvas-no-flows.png', fullPage: true });
      test.skip(true, 'No flows in list to open — create one first');
      return;
    }

    await flowLinks.first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // allow canvas to render

    await page.screenshot({ path: 'screenshots/flows-canvas.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors on canvas: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
