/**
 * phase-spreadsheet-templates.spec.ts
 *
 * End-to-end coverage for the Spreadsheet (xlsx) Templates phase (ADR-039):
 * a Template step accepts an .xlsx alongside .docx, the picker shows the
 * detected authoring mode, and an upload the server rejects surfaces its error
 * to the author rather than failing mid-session.
 *
 * The template upload endpoint is mocked at the network boundary — the real
 * xlsx parsing, mode detection, and in-place fill are covered by the
 * XlsxGenerator adapter unit tests. This spec exercises the UI surface: the
 * file input accepts .xlsx, the detected-mode hint renders, and a 422 rejection
 * is shown.
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Spreadsheet Expert');
  await page.getByRole('button', { name: /create flow/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

  const editLink = page.getByRole('link', { name: 'Configure Flow' }).first();
  await expect(editLink).toBeVisible({ timeout: 5_000 });
  await editLink.click();
  await page.waitForURL(/\/flows\/[^/]+/, { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

async function addGenerateDocumentStep(page: Page): Promise<void> {
  const addStepButtons = page.getByRole('button', { name: '+ Add step' });
  await expect(addStepButtons.first()).toBeVisible({ timeout: 10_000 });
  await addStepButtons.last().click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill('Asset Register');
  await page.locator('#ai-instruction').fill('Gather the asset details.');
  await page.locator('label', { hasText: 'Generate document' }).click();
  await expect(page.locator('#done-when-mode')).toHaveValue('template');
}

const fakeXlsx = Buffer.from('PK\x03\x04 fake xlsx content');

test.describe('phase: spreadsheet (xlsx) templates', () => {
  test('uploading a header-row .xlsx shows the detected header mode', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Xlsx Header ${Date.now()}`);
    await addGenerateDocumentStep(page);

    // The file input accepts spreadsheets alongside Word documents.
    await expect(page.locator('input[type="file"][accept=".docx,.xlsx"]')).toBeAttached();

    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: 'templates/mock-node-id/asset-register.xlsx',
          filename: 'asset-register.xlsx',
          tagCount: 0,
          templateContentLength: 30,
          documentTemplateContent: 'Asset Name  Serial  Owner',
          documentTemplateFields: [
            { key: 'asset_name', label: 'Asset Name', type: 'text', optional: false, raw: 'Asset Name' },
            { key: 'serial', label: 'Serial', type: 'text', optional: false, raw: 'Serial' },
          ],
          documentTemplateFormat: 'xlsx',
          spreadsheetTemplateMode: 'header',
          indexed: true,
          chunkCount: 1,
        }),
      });
    });

    await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
      name: 'asset-register.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fakeXlsx,
    });

    await expect(page.locator('text=asset-register.xlsx').first()).toBeVisible({ timeout: 8_000 });
    // The detected mode is shown so the author knows headings became the fields.
    await expect(page.getByText(/Header-row mode/i)).toBeVisible({ timeout: 5_000 });

    // The step still saves and closes the modal.
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  });

  test('a rejected .xlsx upload surfaces the server error to the author', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Xlsx Reject ${Date.now()}`);
    await addGenerateDocumentStep(page);

    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'This spreadsheet has no {{ tag }} placeholders and no header row. Add a header row of column names, or tags like {{ client_name }}, then re-upload.',
          code: 'INVALID_TEMPLATE_FIELDS',
        }),
      });
    });

    await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
      name: 'empty.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fakeXlsx,
    });

    await expect(page.getByText(/no header row/i)).toBeVisible({ timeout: 8_000 });
    // The rejected file never becomes the step's template.
    await expect(page.locator('text=empty.xlsx')).toHaveCount(0);
  });
});
