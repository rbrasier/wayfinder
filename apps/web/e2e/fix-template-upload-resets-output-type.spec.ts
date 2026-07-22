/**
 * fix-template-upload-resets-output-type.spec.ts
 *
 * Regression guard for the bug where uploading a .docx template into a
 * conversational step reset the step's "Output type" back to "Conversation
 * only" and discarded other unsaved edits.
 *
 * Root cause (fixed in this patch):
 *   The config modal re-seeded its local form state on every `initialValues`
 *   identity change. A successful upload writes the template back into the
 *   canvas nodes, which changed `initialValues` while the modal was open and
 *   wiped the author's in-progress edits (output type, name, instruction).
 *
 * What is tested:
 *   1. An empty canvas shows a large "+ Add step" overlay button that opens the
 *      node-type picker.
 *   2. Selecting "Generate document" defaults "Done when…" to "Template complete".
 *   3. After a (mocked) template upload, "Generate document" stays selected and
 *      the previously entered name / instruction / done-when are preserved.
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Fix Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  await expect(editLink).toBeVisible({ timeout: 5_000 });
  await editLink.click();
  // The flow editor lives at the single canonical /flows/[id]/config route; the
  // admin path redirects there.
  await page.waitForURL(/\/flows\/[^/]+/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

test.describe('fix: template upload preserves output type and pre-filled fields', () => {
  test('empty canvas overlay adds a step; output type and fields survive template upload', async ({ page }) => {
    const flowName = `Fix Output Type ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);

    // 1. Empty canvas shows the large "+ Add step" overlay button (the toolbar
    //    button plus the overlay make two — the overlay is the last one).
    const addStepButtons = page.getByRole('button', { name: '+ Add step' });
    await expect(addStepButtons).toHaveCount(2, { timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/fix-output-type-empty-canvas.png', fullPage: true });

    // Adding the first step via the overlay opens the node-type picker.
    await addStepButtons.last().click();
    await page.getByRole('button', { name: 'Conversational' }).click();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

    // Pre-fill the step fields BEFORE switching output type / uploading.
    await page.locator('#node-name').fill('Requirements Doc');
    await page.locator('#ai-instruction').fill('Gather the required document information.');

    // 2. Selecting "Generate document" defaults "Done when…" to "Template complete".
    await page.locator('label', { hasText: 'Generate document' }).click();
    await expect(page.locator('#done-when-mode')).toHaveValue('template');

    // Intercept the template upload endpoint and return mock fields.
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: 'templates/mock-node-id/mock-template.docx',
          filename: 'mock-template.docx',
          tagCount: 1,
          templateContentLength: 42,
          documentTemplateContent: 'Hello {{Client Name}}.',
          documentTemplateFields: [
            { key: 'client_name', label: 'Client Name', type: 'text', optional: false, raw: 'Client Name (text)' },
          ],
          indexed: true,
          chunkCount: 1,
        }),
      });
    });

    // Upload the (mocked) template.
    const fakeDocx = Buffer.from('PK\x03\x04 fake docx content');
    await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
      name: 'mock-template.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: fakeDocx,
    });
    await expect(page.locator('text=mock-template.docx').first()).toBeVisible({ timeout: 8_000 });

    // 3. The core regression: output type stays "Generate document" and the
    //    pre-filled fields are preserved after the upload.
    await expect(page.locator('input[type="radio"][value="generate_document"]')).toBeChecked();
    await expect(page.locator('input[type="radio"][value="unstructured"]')).not.toBeChecked();
    await expect(page.locator('#node-name')).toHaveValue('Requirements Doc');
    await expect(page.locator('#ai-instruction')).toHaveValue('Gather the required document information.');
    await expect(page.locator('#done-when-mode')).toHaveValue('template');

    await page.screenshot({ path: 'screenshots/fix-output-type-after-upload.png', fullPage: true });

    // Saving succeeds and closes the modal.
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // After the first step exists, the empty-canvas overlay is gone — only the
    // toolbar "+ Add step" button remains.
    await expect(page.getByRole('button', { name: '+ Add step' })).toHaveCount(1, { timeout: 5_000 });
  });
});
