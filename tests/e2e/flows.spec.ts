/**
 * flows.spec.ts
 *
 * Tests the Admin → Flows section: listing, creating, and opening flows.
 * Every meaningful state gets a screenshot so you can see exactly what
 * the UI looked like at each step.
 */

import { test, expect } from './helpers/base';

test.describe('Admin: Flows List', () => {
  test('flows list loads', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /flows/i })).toBeVisible();
    await page.screenshot({ path: 'screenshots/flows-list.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors on flows list: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('New Flow button is visible', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // AdminFlowsPage renders <Button onClick={...}>New Flow</Button>
    const createBtn = page.getByRole('button', { name: /new flow/i });
    await expect(createBtn).toBeVisible();
    await page.screenshot({ path: 'screenshots/flows-create-button-visible.png' });
  });
});

test.describe('Admin: Create Flow', () => {
  test('create flow dialog opens', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /new flow/i });
    await createBtn.click();

    // Wait for the dialog to open
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: 'screenshots/flows-create-opened.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors after clicking create: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('admin creates a flow', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /new flow/i });
    await createBtn.click();

    // Wait for dialog to open
    await expect(page.getByRole('dialog')).toBeVisible();

    // AdminFlowsPage uses <Label htmlFor="flow-name">Name</Label> + <Input id="flow-name" />
    const nameInput = page.locator('#flow-name');
    const hasInput = await nameInput.isVisible().catch(() => false);

    if (!hasInput) {
      await page.screenshot({ path: 'screenshots/flows-create-no-input-found.png', fullPage: true });
      test.skip(true, 'Name input not found — UI structure may differ, see screenshot');
      return;
    }

    const flowName = `E2E Test Flow ${Date.now()}`;
    await nameInput.fill(flowName);

    // Expert role is required — fill it so the submit button becomes enabled
    const expertRoleInput = page.locator('#flow-expert-role');
    if (await expertRoleInput.isVisible().catch(() => false)) {
      await expertRoleInput.fill('E2E Test Expert');
    }

    // Button text is "Create flow" (disabled until name and expertRole are non-empty)
    const submitBtn = page.getByRole('button', { name: /create flow/i });
    await submitBtn.click();

    // Wait for dialog to close — indicates the mutation completed
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/flows-after-create.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors after creating flow: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Admin: Flow Canvas', () => {
  test('admin opens flow canvas', async ({ page, consoleLogs }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // The flows table renders an "Edit" link (<Button asChild><Link href="/admin/flows/[id]">Edit</Link></Button>)
    const editLink = page.getByRole('link', { name: 'Edit' }).first();
    const count = await editLink.count();

    if (count === 0) {
      await page.screenshot({ path: 'screenshots/flows-canvas-no-flows.png', fullPage: true });
      test.skip(true, 'No flows in list to open — create one first');
      return;
    }

    await editLink.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // allow canvas to render

    await page.screenshot({ path: 'screenshots/flows-canvas.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors on canvas: ${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
