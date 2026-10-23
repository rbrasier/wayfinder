/**
 * unattended-automation.spec.ts
 *
 * Flows that run with nobody at the keyboard (ADR-063–065). Only the parts a
 * browser alone can prove live here (docs/guides/e2e-test-policy.md); the
 * rules themselves — baseline, fire-once, caps, pauses, token checks — are
 * covered in packages/domain and packages/application.
 *
 *   - Smoke (group 6): a webhook call goes through the real stack — token
 *     check, run start, the unattended driver, an AI task step — and the run
 *     shows up in the flow's run history, parked on the first person's step.
 *     Its chat shows the AI task's result as an output card whose info toggle
 *     reveals the confidence.
 *   - Navigation state across a page load (group 4): an Event Watch built from
 *     a fetched sample's dropdowns is saved, and after a reload the editor shows
 *     what was saved, with the token kept but never sent back.
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
  // Each test crosses several routes that a dev-mode server may compile on
  // first use, on top of a run that finishes after its 202.
  test.describe.configure({ timeout: 120_000 });

  test('a webhook call starts an unattended run that appears in the flow run history', async ({
    page,
    request,
  }) => {
    const { automationFlowId } = requireSeedFixtures();
    await page.goto(`/flows/${automationFlowId}/config`);
    await page.getByRole('button', { name: 'Triggers' }).click();

    const dialog = page.getByRole('dialog', { name: 'Triggers' });
    const webhookToggle = dialog.getByLabel('Let other systems start this flow');
    // A retry finds the webhook already on from the first attempt, and its
    // one-time token gone. Turning it on (when off) and then rotating gives a
    // fresh token from either state. The dialog renders only once its data has
    // loaded, so the box shows the saved state by the time it is visible.
    await expect(webhookToggle).toBeVisible({ timeout: 30_000 });
    if (!(await webhookToggle.isChecked())) {
      await webhookToggle.click();
      // The box reflects the saved state, so it ticks once the server confirms.
      await expect(webhookToggle).toBeChecked({ timeout: 15_000 });
    }
    await dialog.getByRole('button', { name: 'Rotate token' }).click();
    const secret = dialog.getByRole('status').filter({ hasText: 'New webhook token' });
    await expect(secret).toBeVisible({ timeout: 15_000 });
    const token = (await secret.locator('code').textContent())?.trim() ?? '';
    expect(token).toMatch(/^wf_wh_/);
    await page.screenshot({ path: 'screenshots/automation-webhook-token.png', fullPage: true });

    // The first call to the trigger route can pay a dev-mode compile.
    const rejected = await request.post(`/api/triggers/${automationFlowId}`, {
      headers: { Authorization: 'Bearer wf_wh_not-the-token' },
      data: { inputs: { hearing_id: 'H-1' } },
      timeout: 30_000,
    });
    expect(rejected.status()).toBe(401);

    const accepted = await request.post(`/api/triggers/${automationFlowId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { inputs: { hearing_id: 'H-1' } },
    });
    expect(accepted.status()).toBe(202);

    // The driver runs after the 202, so the run reaches the person's step a
    // moment later. Reopening the dialog refetches the history.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Triggers' }).click();
      await expect(dialog.getByText('Waiting on a person').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.screenshot({ path: 'screenshots/automation-webhook-run-history.png', fullPage: true });

    // Open the run where it is parked; the AI task before it shows as a card.
    await dialog.getByRole('link', { name: 'Open chat' }).first().click();
    await expect(page).toHaveURL(/\/chats\//, { timeout: 30_000 });
    const outputCard = page.getByTestId('ai-task-output-card');
    await expect(outputCard).toBeVisible({ timeout: 30_000 });
    await expect(outputCard).toContainText('Summarise the hearing output');
    await outputCard.getByRole('button', { name: 'Confidence and rationale' }).click();
    // The scripted model's default confidence; the seeded step passes at 50.
    await expect(outputCard).toContainText('Confidence: 75%');
    await page.screenshot({ path: 'screenshots/automation-ai-task-output-card.png', fullPage: true });
  });

  test('an event watch built from a sample keeps its settings across a reload', async ({ page }) => {
    const watchName = `E2E watch ${Date.now()}`;
    await page.goto('/admin/event-watches/new');

    await page.getByLabel('Name').fill(watchName);
    await page.getByLabel('API address').fill(`${BASE_URL}/api/test/watch-source`);
    await page.getByLabel('Authentication').selectOption('bearer');
    await page.getByLabel('Token', { exact: true }).fill('e2e-watch-token');
    await page.getByRole('button', { name: 'Test' }).click();
    // The server's call to the watch source can pay a dev-mode compile.
    await expect(page.getByRole('status').filter({ hasText: 'The API answered 200.' })).toBeVisible({
      timeout: 30_000,
    });

    // Choose the list, then the ID and the condition field from the sample's
    // first item — each a dropdown of the sample's paths.
    await page.getByLabel('List of items', { exact: true }).selectOption('hearings');
    await page.getByLabel('Field that identifies each item', { exact: true }).selectOption('id');
    await page.getByLabel('Start a run when').selectOption('transition');
    await page.getByLabel('Field', { exact: true }).selectOption('status');
    await page.getByLabel('To', { exact: true }).fill('finished');
    await page.getByRole('button', { name: 'Would fire now?' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 of 2 items would start a run: H-1' })).toBeVisible();

    await page.getByLabel('Flow', { exact: true }).selectOption({ label: 'E2E SEED Automation Flow' });
    await page.getByLabel('Hearing', { exact: true }).selectOption('id');
    await page.getByLabel('Choose a person').fill(ADMIN_EMAIL);
    await page.getByRole('button', { name: new RegExp(ADMIN_EMAIL) }).first().click();
    await page.screenshot({ path: 'screenshots/automation-watch-editor.png', fullPage: true });

    await page.getByRole('button', { name: 'Create watch' }).click();
    // The URL changes once the list page has compiled and loaded.
    await expect(page).toHaveURL(/\/admin\/event-watches$/, { timeout: 30_000 });
    const row = page.getByRole('row').filter({ hasText: watchName });
    await expect(row).toContainText('Active · learning current items');
    await expect(row).toContainText('when status changes to finished');
    await page.screenshot({ path: 'screenshots/automation-watch-list.png', fullPage: true });

    await row.getByRole('link', { name: watchName }).click();
    await expect(page.getByLabel('Name')).toHaveValue(watchName, { timeout: 30_000 });
    await page.reload();

    await expect(page.getByLabel('Name')).toHaveValue(watchName);
    // Without a sample after the reload, saved paths open as typed values.
    await expect(page.getByLabel('List of items (typed path)')).toHaveValue('hearings');
    await expect(page.getByLabel('Field that identifies each item (typed path)')).toHaveValue('id');
    await expect(page.getByLabel('Field (typed path)')).toHaveValue('status');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('finished');
    await expect(page.getByLabel('Hearing (typed path)')).toHaveValue('id');
    // The saved token is kept on the server and never sent back to the page.
    const token = page.getByLabel('Token', { exact: true });
    await expect(token).toHaveValue('');
    await expect(token).toHaveAttribute('placeholder', 'Saved — leave blank to keep it');
  });
});
