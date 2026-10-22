/**
 * unattended-automation.spec.ts
 *
 * Flows that run with nobody at the keyboard (ADR-063–065). Only the parts a
 * browser alone can prove live here (docs/guides/e2e-test-policy.md); the
 * rules themselves — baseline, fire-once, caps, pauses, token checks — are
 * covered in packages/domain and packages/application.
 *
 *   - Smoke (group 6): a webhook call goes through the real stack — token
 *     check, run start, the unattended driver — and the run shows up in the
 *     flow's run history, parked on the first person's step.
 *   - Navigation state across a page load (group 4): an Event Watch built from
 *     a fetched sample is saved, and after a reload the editor shows what was
 *     saved, with the token kept but never sent back.
 *
 * The automation flow and the allow-listed app host come from the seed
 * (lib/e2e-fixtures-automation.ts). The watch calls the test-only
 * /api/test/watch-source endpoint as its "external" API.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Unattended automation', () => {
  test('a webhook call starts an unattended run that appears in the flow run history', async ({
    page,
    request,
  }) => {
    const { automationFlowId } = requireSeedFixtures();
    await page.goto(`/flows/${automationFlowId}/config`);
    await page.getByRole('button', { name: 'Triggers' }).click();

    const dialog = page.getByRole('dialog', { name: 'Triggers' });
    // The box reflects the saved state, so it ticks once the server confirms.
    const webhookToggle = dialog.getByLabel('Let other systems start this flow');
    await webhookToggle.click();
    await expect(webhookToggle).toBeChecked();
    const secret = dialog.getByRole('status').filter({ hasText: 'shown only this once' });
    await expect(secret).toBeVisible();
    const token = (await secret.locator('code').textContent())?.trim() ?? '';
    expect(token).toMatch(/^wf_wh_/);
    await page.screenshot({ path: 'screenshots/automation-webhook-token.png', fullPage: true });

    const rejected = await request.post(`/api/triggers/${automationFlowId}`, {
      headers: { Authorization: 'Bearer wf_wh_not-the-token' },
      data: { inputs: { hearing_id: 'H-1' } },
    });
    expect(rejected.status()).toBe(401);

    const accepted = await request.post(`/api/triggers/${automationFlowId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { inputs: { hearing_id: 'H-1' } },
    });
    expect(accepted.status()).toBe(202);

    // The driver runs after the 202, so the run reaches the person's step a
    // moment later. Reopening the dialog re-reads the history.
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.getByRole('button', { name: 'Triggers' }).click();
          const history = page.getByRole('dialog', { name: 'Triggers' }).getByRole('listitem');
          return (await history.allTextContents()).join(' | ');
        },
        { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toContain('Waiting on a person');
    await page.screenshot({ path: 'screenshots/automation-webhook-run-history.png', fullPage: true });
  });

  test('an event watch built from a sample keeps its settings across a reload', async ({ page }) => {
    const watchName = `E2E watch ${Date.now()}`;
    await page.goto('/admin/event-watches/new');

    await page.getByLabel('Name').fill(watchName);
    await page.getByLabel('API address').fill(`${BASE_URL}/api/test/watch-source`);
    await page.getByLabel('Authentication').selectOption('bearer');
    await page.getByLabel('Token', { exact: true }).fill('e2e-watch-token');
    await page.getByRole('button', { name: 'Test' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The API answered 200.' })).toBeVisible();

    // Pick the list, then the ID and the condition field from the first item.
    await page.getByRole('button', { name: 'Pick' }).first().click();
    await page.getByRole('button', { name: /^hearings/ }).click();
    await expect(page.getByLabel('List of items')).toHaveValue('hearings');
    await page.getByRole('button', { name: 'Pick' }).nth(1).click();
    await page.getByRole('button', { name: /^id "H-1"/ }).click();
    await expect(page.getByLabel('Field that identifies each item')).toHaveValue('id');

    await page.getByLabel('Start a run when').selectOption('transition');
    await page.getByLabel('Field', { exact: true }).fill('status');
    await page.getByLabel('To', { exact: true }).fill('finished');
    await page.getByRole('button', { name: 'Would fire now?' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 of 2 items would start a run: H-1' })).toBeVisible();

    await page.getByLabel('Flow', { exact: true }).selectOption({ label: 'E2E SEED Automation Flow' });
    await page.getByLabel('Hearing').fill('id');
    await page.getByLabel('Choose a person').fill(ADMIN_EMAIL);
    await page.getByRole('button', { name: new RegExp(ADMIN_EMAIL) }).first().click();
    await page.screenshot({ path: 'screenshots/automation-watch-editor.png', fullPage: true });

    await page.getByRole('button', { name: 'Create watch' }).click();
    await expect(page).toHaveURL(/\/admin\/event-watches$/);
    const row = page.getByRole('row').filter({ hasText: watchName });
    await expect(row).toContainText('Active · learning current items');
    await expect(row).toContainText('when status changes to finished');
    await page.screenshot({ path: 'screenshots/automation-watch-list.png', fullPage: true });

    await row.getByRole('link', { name: watchName }).click();
    await expect(page.getByLabel('Name')).toHaveValue(watchName);
    await page.reload();

    await expect(page.getByLabel('Name')).toHaveValue(watchName);
    await expect(page.getByLabel('List of items')).toHaveValue('hearings');
    await expect(page.getByLabel('Field that identifies each item')).toHaveValue('id');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('finished');
    await expect(page.getByLabel('Hearing')).toHaveValue('id');
    // The saved token is kept on the server and never sent back to the page.
    const token = page.getByLabel('Token', { exact: true });
    await expect(token).toHaveValue('');
    await expect(token).toHaveAttribute('placeholder', 'Saved — leave blank to keep it');
  });
});
