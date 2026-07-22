/**
 * phase-narrative-repeating-groups.spec.ts
 *
 * End-to-end coverage for the repeating / structured groups phase (v2.5.0,
 * ADR-032). A template author can declare a repeating group with an explicit
 * {{#Name (repeat)}} … {{/Name}} block; the AI extracts a list of records and
 * the document renders one block per item.
 *
 * What is tested through the running app UI:
 *   1. Happy path — the "Template tags & validation" help dialog documents the
 *      (repeat) marker and the repeating-groups rules, so an author discovers
 *      how to build one.
 *   2. Error path — uploading a template whose group is nested inside a section
 *      is rejected by the upload dry-run and the validation message is shown to
 *      the author (groups are single-level only in v1).
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';

async function createFlowAndOpenCanvas(page: Page, name: string): Promise<void> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E Groups Expert');
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
  await page.locator('#node-name').fill('Evaluation Summary');
  await page.locator('label', { hasText: 'Generate document' }).click();
}

test.describe('phase: repeating / structured groups', () => {
  test('the tags help dialog documents the (repeat) group marker', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Groups Help ${Date.now()}`);
    await addGenerateDocumentStep(page);

    await page.getByRole('button', { name: 'How template tags work' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Template tags & validation' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText('Repeating groups', { exact: false })).toBeVisible();
    await expect(dialog.getByText('{{#Name (repeat)}}', { exact: false }).first()).toBeVisible();
  });

  test('a group nested inside a section is rejected on upload with a clear message', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Groups Nesting ${Date.now()}`);
    await addGenerateDocumentStep(page);

    // The real upload dry-run (extractFields) raises this on a nested group; mock
    // the endpoint to return that same validation error so the UI surfacing is
    // exercised end-to-end.
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'Repeating group "{{#Findings (repeat)}}" is nested inside an optional section. A group cannot sit inside a section — move it out.',
          code: 'VALIDATION_FAILED',
        }),
      });
    });

    const fakeDocx = Buffer.from('PK\x03\x04 fake docx content');
    await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
      name: 'nested-group.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: fakeDocx,
    });

    await expect(page.getByText('nested inside an optional section', { exact: false })).toBeVisible({
      timeout: 8_000,
    });
  });
});
