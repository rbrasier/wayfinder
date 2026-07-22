/**
 * fix-prior-step-fields-stripped.spec.ts
 *
 * Regression guard for the bug where `documentTemplateFields` (and n8n
 * `responseFields`) were stripped from a conversational node's DB config on
 * every modal save, making prior-step field selectors always show empty.
 *
 * Root cause (fixed in this patch):
 *   1. `buildConfig()` for conversational nodes omitted `documentTemplateFields`
 *      and `documentTemplateStructuredContent`, wiping them from the DB on save.
 *   2. After a template upload the canvas `rfNodes` was never patched with the
 *      returned fields, so `priorStepFields` stayed empty until a page reload
 *      (which bug 1 would then undo on the next save anyway).
 *
 * What is tested:
 *   1. After a (mocked) template upload, a subsequent step's value-selector
 *      dropdown contains the document template fields from the prior step.
 *   2. After re-saving the conversational node (plain name change), opening the
 *      subsequent step still shows the same fields — the fields are not wiped.
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';

const MOCK_TEMPLATE_FIELDS = [
  { key: 'client_name', label: 'Client Name', type: 'text', optional: false, raw: 'Client Name (text)' },
  { key: 'project_scope', label: 'Project Scope', type: 'text', optional: false, raw: 'Project Scope (text)' },
];

const FLAG_KEY = 'auto_node';

async function enableAutoNodeFlag(page: Page): Promise<boolean> {
  await page.goto('/admin/flags');
  await page.waitForLoadState('networkidle');

  const heading = page.getByRole('heading', { name: /feature flags/i });
  if (!(await heading.isVisible().catch(() => false))) return false;

  const row = page.getByRole('row').filter({ hasText: FLAG_KEY });
  if (!(await row.first().isVisible().catch(() => false))) {
    await page.getByPlaceholder('new-flag-key').fill(FLAG_KEY);
    await page.getByRole('button', { name: /add flag/i }).click();
    await page.waitForTimeout(800);
  }

  const flagRow = page.getByRole('row').filter({ hasText: FLAG_KEY }).first();
  await expect(flagRow).toBeVisible({ timeout: 5_000 });

  const toggle = flagRow.getByRole('button').first();
  if ((await toggle.textContent())?.toLowerCase().includes('off')) {
    await toggle.click();
    await page.waitForTimeout(800);
  }
  await expect(flagRow.getByText(/^on$/i)).toBeVisible({ timeout: 5_000 });
  return true;
}

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
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_200);
}

/** Add a conversational step named `name` with "Generate document" output. */
async function addConversationalDocStep(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add step' }).first().click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

  await page.locator('#node-name').fill(name);
  await page.locator('#ai-instruction').fill('Gather the required document information.');

  // Switch to "Generate document" output type
  await page.locator('label', { hasText: 'Generate document' }).click();

  // Choose "Template complete" done-when mode so we don't need to type a condition
  const doneWhenSelect = page.locator('#done-when-mode');
  if (await doneWhenSelect.isVisible().catch(() => false)) {
    await doneWhenSelect.selectOption('template');
  }

  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

/**
 * Open the config for an existing node by clicking its card on the canvas,
 * intercept the template upload API to return the mock fields, then trigger
 * a file input upload.
 */
async function uploadMockTemplate(page: Page, stepName: string): Promise<void> {
  // Intercept the template upload endpoint for this one upload
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
        tagCount: 2,
        templateContentLength: 120,
        documentTemplateContent: 'Hello {{Client Name}} your project scope is {{Project Scope}}.',
        documentTemplateFields: MOCK_TEMPLATE_FIELDS,
        indexed: true,
        chunkCount: 1,
      }),
    });
  });

  // Click the step card to open its config modal
  await page.locator('.react-flow__node').filter({ hasText: stepName }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

  // The upload button is visible when outputType === "generate_document" and no
  // template has been uploaded yet. If it's already showing a filename, skip.
  const uploadButton = page.locator('button', { hasText: /click to upload a \.docx/i });
  if (!(await uploadButton.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.keyboard.press('Escape');
    return;
  }

  // Set a fake DOCX file directly on the hidden file input — route intercept
  // means the server never sees the actual bytes.
  const fakeDocx = Buffer.from('PK\x03\x04 fake docx content');
  await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
    name: 'mock-template.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: fakeDocx,
  });

  // Wait for the filename confirmation to appear
  await expect(page.locator('text=mock-template.docx').first()).toBeVisible({ timeout: 8_000 });

  // Unroute so subsequent saves don't accidentally intercept
  await page.unroute(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/);
}

/** Add an auto-step with the Mock executor and one request field. */
async function addMockAutoStep(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add step' }).first().click();
  await page.getByRole('button', { name: /Automated \(n8n\)/ }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

  await page.locator('#node-name').fill(name);
  await page.locator('#auto-instruction').fill('Run the automated task.');

  // Use Mock executor so no live n8n needed
  await page.locator('label', { hasText: /Mock \(testing\)/ }).click();

  // Add one request field so the "Field values" section renders
  const requestEditor = page
    .locator('div.space-y-1')
    .filter({ hasText: 'Fields sent with the request' })
    .last();
  await requestEditor.getByRole('button', { name: /Add field/i }).click();
  await requestEditor.getByPlaceholder(/Preferred Vendor/i).last().fill('Input Data (text)');

  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

test.describe('fix: prior-step document template fields survive conversational node saves', () => {
  test('template fields from a prior conversational step appear in the auto-step value selector after upload and after re-save', async ({ page }) => {
    // Requires the auto_node flag to get a step with a "Field values" dropdown
    const enabled = await enableAutoNodeFlag(page);
    test.skip(!enabled, 'Cannot enable auto_node flag in this environment');

    const flowName = `Fix Prior Fields ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName);

    // Step 1: conversational "Generate document" step
    await addConversationalDocStep(page, 'Requirements Doc');

    // Upload a (mocked) template so documentTemplateFields are stored
    await uploadMockTemplate(page, 'Requirements Doc');

    // Save the modal (closes it) — the fields should now be in rfNodes
    const saveButton = page.getByRole('button', { name: /^Save$/i });
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(400);
    }

    await page.screenshot({ path: 'screenshots/fix-prior-fields-step1-saved.png', fullPage: true });

    // Step 2: auto step with a request field whose value source we can inspect
    await addMockAutoStep(page, 'Process Data');

    // Open Step 2's config — the value selector for "Input Data" should offer
    // the template fields from Step 1 in an optgroup.
    await page.locator('.react-flow__node').filter({ hasText: 'Process Data' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Wait for the "Field values" section to be present
    const fieldValuesSection = page.locator('text=Field values').first();
    await expect(fieldValuesSection).toBeVisible({ timeout: 5_000 });

    // The select for "Input Data" should contain the Step 1 optgroup with the
    // two mock template fields.
    const valueSelect = page.locator('select').filter({ hasText: /AI decides/i }).last();
    await expect(valueSelect).toBeVisible({ timeout: 5_000 });

    const optgroup = valueSelect.locator('optgroup');
    const optgroupCount = await optgroup.count();

    await page.screenshot({ path: 'screenshots/fix-prior-fields-step2-selector.png', fullPage: true });

    // There should be at least one optgroup (the prior step's fields)
    expect(optgroupCount).toBeGreaterThan(0);

    // Verify the Client Name option is present
    const clientNameOption = valueSelect.locator('option', { hasText: /Client Name/i });
    await expect(clientNameOption.first()).toBeAttached({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ── Regression: re-save Step 1 (simulate a name change) and check fields survive ──

    await page.locator('.react-flow__node').filter({ hasText: 'Requirements Doc' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // Change the step name to trigger a save with the fixed buildConfig
    const nameInput = page.locator('#node-name');
    await nameInput.clear();
    await nameInput.fill('Requirements Doc Updated');

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);

    // Open Step 2 again — fields must still be offered (bug 1 regression guard)
    await page.locator('.react-flow__node').filter({ hasText: 'Process Data' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const valueSelectAfterResave = page.locator('select').filter({ hasText: /AI decides/i }).last();
    await expect(valueSelectAfterResave).toBeVisible({ timeout: 5_000 });

    const optgroupAfterResave = valueSelectAfterResave.locator('optgroup');
    const optgroupCountAfterResave = await optgroupAfterResave.count();

    await page.screenshot({ path: 'screenshots/fix-prior-fields-step2-after-resave.png', fullPage: true });

    // Fields must still be present after re-saving Step 1
    expect(optgroupCountAfterResave).toBeGreaterThan(0);

    const clientNameAfterResave = valueSelectAfterResave.locator('option', { hasText: /Client Name/i });
    await expect(clientNameAfterResave.first()).toBeAttached({ timeout: 3_000 });

    await page.keyboard.press('Escape');
  });
});
