/**
 * enhance-template-annotation.spec.ts
 *
 * Covers the guided annotation upload flow (v0.21.3): uploading a document into
 * a "Generate document" step opens a guided modal that lists the {{ placeholders }}
 * the author wrote in the document, lets them accept those or edit the names and
 * types, and only then persists the template.
 *
 * Since #347 the upload button first asks whether the author has a tagged
 * template or a filled example. The tagged path is the flow above, unchanged;
 * the example path drafts placeholders from one or more filled .docx copies
 * (ADR-067). The draft route is stubbed here — what it drafts is covered by the
 * use-case and route unit tests; this covers the files crossing the browser.
 *
 * What is tested:
 *   1. A document carrying placeholders lists them with their types and saves on
 *      "Accept these fields".
 *   2. A document with no placeholders shows the typing demo and links through to
 *      the complete annotation reference.
 *   3. The raw annotation string beneath each row updates live as the author
 *      edits the field name and type — the teaching surface for the Word
 *      round-trip.
 *   4. Re-uploading the document after adding placeholders in Word restarts the
 *      flow and picks up the new fields.
 *   5. The config icon renders in an accent colour when a non-default option is
 *      set, in the structured conversation editor as well (the retrofit).
 *   6. "I have a template with tags" opens the file picker into the flow above.
 *   7. "Use an existing example" uploads several examples, reviews the draft
 *      (evidence, a checking-pass field to confirm), compares the original and
 *      tagged text side by side, and saves.
 *   8. A file that is not a Word document is named and refused before drafting,
 *      and a failed draft offers Retry and "Tag it myself".
 */

import { test, expect } from './helpers/base';
import type { Page, Route } from '@playwright/test';
import { createFlowAndOpenCanvas } from './helpers/flow-builder';

const fakeDocx = () => Buffer.from('PK\x03\x04 fake docx content');


async function addDocumentStep(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: '+ Create your first step in your workflow' })
    .click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill('Draft the agreement');
  await page.locator('#ai-instruction').fill('Gather the agreement details.');
  await page.locator('label', { hasText: 'Generate document' }).click();
  // The step must exist before a template can be attached to it.
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await page.locator('.react-flow__node').first().dblclick();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
}

async function mockAnalyse(page: Page, body: Record<string, unknown>): Promise<void> {
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/analyse$/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mockSave(page: Page): Promise<{ saved: () => boolean }> {
  let saved = false;
  await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template$/, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    // The request body cannot be read back here — both postData() and
    // postDataBuffer() are null for a multipart body carrying binary file
    // content. What the payload contains is asserted by the unit tests for
    // buildAnnotationEdits; this only records that the flow reached the save.
    saved = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: 'templates/mock-node/agreement.docx',
        filename: 'agreement.docx',
        tagCount: 1,
        templateContentLength: 42,
        documentTemplateContent: 'Made with {{ Supplier Name (text) }}.',
        documentTemplateFields: [
          { key: 'supplier_name', label: 'Supplier Name', type: 'text', optional: false, raw: 'Supplier Name (text)' },
        ],
        documentTemplateFormat: 'docx',
        indexed: true,
        chunkCount: 1,
      }),
    });
  });
  return { saved: () => saved };
}

async function uploadTemplate(page: Page): Promise<void> {
  await page.locator('input[type="file"][accept=".docx,.xlsx"]').setInputFiles({
    name: 'agreement.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: fakeDocx(),
  });
}

test.describe('enhance: guided annotation upload', () => {
  test('the placeholders in the document are listed and accepted as they are', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Annotation ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'annotated',
      documentText: 'Made with {{ Supplier Name }} for {{ Contract Value (currency) }}.',
      rows: [
        {
          key: 'supplier_name',
          line: 'Supplier Name',
          occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
          locked: false,
        },
        {
          key: 'contract_value',
          line: 'Contract Value (currency)',
          occurrences: [{ sourceText: '{{ Contract Value (currency) }}', occurrence: 0 }],
          locked: false,
        },
      ],
    });
    const save = await mockSave(page);

    await uploadTemplate(page);

    // 1. The fields the author wrote are listed with the type each one carries,
    //    so accepting them is an informed decision rather than a blind one.
    await expect(page.getByText('2 data fields found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Supplier Name')).toBeVisible();
    await expect(page.getByText('(Text)')).toBeVisible();
    await expect(page.getByText('Contract Value')).toBeVisible();
    await expect(page.getByText('(Currency)')).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-found.png', fullPage: true });

    // 2. Accepting saves straight from the list — no trip through the editor.
    await page.getByRole('button', { name: 'Accept these fields' }).click();

    await expect(page.getByText('agreement.docx').first()).toBeVisible({ timeout: 10_000 });
    expect(save.saved()).toBe(true);
    // The output type survives the round-trip through the guided modal.
    await expect(page.locator('input[type="radio"][value="generate_document"]')).toBeChecked();
  });

  test('a document with no placeholders is shown how to add them', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template No Fields ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'empty',
      documentText: 'Supplier Agreement\nSupplier Name:\nStart Date:',
      rows: [],
    });
    await mockSave(page);

    await uploadTemplate(page);

    // 1. No inference is offered — the author is shown the syntax being typed
    //    into a mock document, which is the only way fields get added.
    await expect(page.getByText('No data fields yet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('your-template.docx')).toBeVisible();
    // The demo types the tag out a character at a time, so this settles rather
    // than matching immediately.
    await expect(page.getByText('{{ Supplier Name }}')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-demo.png', fullPage: true });

    // 2. The complete list of annotations is one click away.
    await page.getByRole('button', { name: 'complete list of annotations' }).click();
    await expect(page.getByText('Kinds of value')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('{{ Equipment (multi-options: Laptop, Phone) }}')).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-reference.png', fullPage: true });

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('No data fields yet')).toBeVisible();
  });

  test('the raw annotation string updates live as the field is edited', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Live Line ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);

    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'annotated',
      documentText: 'Made with {{ Supplier Name }}.',
      rows: [
        {
          key: 'supplier_name',
          line: 'Supplier Name',
          occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
          locked: false,
        },
      ],
    });
    await mockSave(page);

    await uploadTemplate(page);

    // The detected step lists the data fields it found, with their type, before
    // asking the author to decide.
    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Supplier Name')).toBeVisible();
    await expect(page.getByText('(Text)')).toBeVisible();
    await page.getByRole('button', { name: 'Edit fields' }).click();

    await expect(page.getByText('{{ Supplier Name }}').first()).toBeVisible({ timeout: 5_000 });

    // Changing the type rewrites the raw line immediately, not on blur or save.
    await page.getByLabel('Field 1 type').selectOption('currency');
    await expect(page.getByText('{{ Supplier Name (currency) }}')).toBeVisible();

    // Renaming does the same.
    await page.getByLabel('Field 1 label').fill('Contract Value');
    await expect(page.getByText('{{ Contract Value (currency) }}')).toBeVisible();

    // Switching to a select type sticks even before any choices are added — the
    // type is held in state, not re-derived from a line that cannot carry an
    // empty options list (the reported regression).
    await page.getByLabel('Field 1 type').selectOption('multiselect');
    await expect(page.getByLabel('Field 1 type')).toHaveValue('multiselect');

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByText('agreement.docx').first()).toBeVisible({ timeout: 10_000 });
  });

  test('re-uploading the edited document restarts the flow with the new fields', async ({
    page,
  }) => {
    await createFlowAndOpenCanvas(page, `Template Reupload ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);

    // The author adds placeholders in Word between the two uploads, so the same
    // filename comes back carrying a field the first pass did not have.
    let uploads = 0;
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/analyse$/, async (route: Route) => {
      uploads += 1;
      const annotated = uploads > 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          filename: 'agreement.docx',
          format: 'docx',
          classification: annotated ? 'annotated' : 'empty',
          documentText: annotated ? 'Made with {{ Supplier Name }}.' : 'Supplier Name:',
          rows: annotated
            ? [
                {
                  key: 'supplier_name',
                  line: 'Supplier Name',
                  occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
                  locked: false,
                },
              ]
            : [],
        }),
      });
    });
    await mockSave(page);

    await uploadTemplate(page);
    await expect(page.getByText('No data fields yet')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: "I've added them" }).click();
    await expect(page.getByText(/upload the document here/i)).toBeVisible({ timeout: 5_000 });

    // Re-uploading restarts the flow from detection, now finding the field.
    await page
      .locator('input[type="file"][accept=".docx,.xlsx"]')
      .last()
      .setInputFiles({
        name: 'agreement.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: fakeDocx(),
      });
    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
  });

  test('the config icon takes an accent colour when a non-default option is set', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Field Cog Accent ${Date.now()}`, { expertRole: 'E2E Template Expert' });

    await page
      .getByRole('button', { name: '+ Create your first step in your workflow' })
      .click();
    await page.getByRole('button', { name: 'Conversational' }).click();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

    // The retrofit applies to the structured conversation editor too, because
    // both editors render the same row component.
    // Selected by its radio value: "Structured conversation" is a substring of
    // "Unstructured conversation", so a text filter matches both.
    await page.locator('label:has(input[value="structured"])').click();
    await page.getByLabel('Field 1 label').fill('Supplier Name');

    const cog = page.getByRole('button', { name: 'Configure field 1' });
    await expect(cog).toHaveAttribute('data-configured', 'false');

    await cog.click();
    await page.getByRole('switch', { name: /required/i }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(cog).toHaveAttribute('data-configured', 'true');
    await page.screenshot({ path: 'screenshots/enhance-template-annotation-cog-accent.png', fullPage: true });
  });
});

const examplesFile = (name: string) => ({
  name,
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: fakeDocx(),
});

async function openUploadChoice(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Click to upload a \.docx or \.xlsx template/ }).click();
  await expect(page.getByRole('button', { name: /I have a template with tags/ })).toBeVisible({ timeout: 5_000 });
}

async function chooseExamples(page: Page, files: ReturnType<typeof examplesFile>[]): Promise<void> {
  await page.getByRole('button', { name: /Use an existing example/ }).click();
  await expect(page.getByText(/Your\s+original files are not changed, and they are not saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Choose examples' }).click();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(files);
}

const DRAFT = {
  filename: 'contract-2024.docx',
  exampleCount: 2,
  rows: [
    {
      key: 'supplier_name',
      line: 'Supplier Name',
      occurrences: [{ sourceText: 'Acme Pty Ltd', occurrence: 0 }],
      locked: false,
      draft: {
        replacedValue: 'Acme Pty Ltd',
        context: 'Supplier: Acme Pty Ltd',
        insertAfter: false,
        evidence: { kind: 'varies', differsIn: 1, of: 1 },
        confirmed: true,
      },
    },
    {
      key: 'reference',
      line: 'Reference',
      occurrences: [{ sourceText: 'PO-42', occurrence: 0 }],
      locked: false,
      draft: {
        replacedValue: 'PO-42',
        context: 'Ref: PO-42',
        insertAfter: false,
        evidence: { kind: 'checking-pass' },
        confirmed: false,
      },
    },
  ],
  sameInEveryExample: [],
  unplaced: [],
  comparison: {
    originalText: 'Supplier: Acme Pty Ltd\nRef: PO-42',
    taggedText: 'Supplier: {{ Supplier Name }}\nRef: {{ Reference }}',
    links: [
      { fieldKey: 'supplier_name', originalStart: 10, originalEnd: 22, taggedStart: 10, taggedEnd: 29 },
      { fieldKey: 'reference', originalStart: 28, originalEnd: 33, taggedStart: 35, taggedEnd: 50 },
    ],
  },
  taggedDocument: fakeDocx().toString('base64'),
};

test.describe('enhance: draft a template from examples', () => {
  test('a tagged template goes through the file picker into the existing flow', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Choice ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);
    await mockAnalyse(page, {
      filename: 'agreement.docx',
      format: 'docx',
      classification: 'annotated',
      documentText: 'Made with {{ Supplier Name }}.',
      rows: [
        {
          key: 'supplier_name',
          line: 'Supplier Name',
          occurrences: [{ sourceText: '{{ Supplier Name }}', occurrence: 0 }],
          locked: false,
        },
      ],
    });

    await openUploadChoice(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /I have a template with tags/ }).click();
    await (await chooser).setFiles(examplesFile('agreement.docx'));

    await expect(page.getByText('1 data field found')).toBeVisible({ timeout: 10_000 });
  });

  test('examples are drafted, reviewed, compared side by side and saved', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Draft ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/draft$/, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRAFT) });
    });
    const save = await mockSave(page);

    await openUploadChoice(page);
    await chooseExamples(page, [examplesFile('contract-2024.docx'), examplesFile('contract-2023.docx')]);
    await expect(page.getByLabel('contract-2024.docx', { exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Draft template' }).click();

    // The review shows what each field replaces and the evidence behind it.
    await expect(page.getByText('2 data fields drafted')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Replaces “Acme Pty Ltd”')).toBeVisible();
    await expect(page.getByText('Differs in 1 of 1 other example')).toBeVisible();
    await expect(page.getByText('Added by the checking pass')).toBeVisible();

    // A field the checking pass added must be confirmed before saving.
    const compareAndSave = page.getByRole('button', { name: 'Compare and save' });
    await expect(compareAndSave).toBeDisabled();
    await page.getByRole('button', { name: 'Looks right' }).click();
    await compareAndSave.click();

    await expect(page.getByRole('button', { name: '{{ Supplier Name }}' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Acme Pty Ltd' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/enhance-template-draft-compare.png', fullPage: true });

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect.poll(save.saved, { timeout: 10_000 }).toBe(true);
    await expect(page.getByText('agreement.docx').first()).toBeVisible({ timeout: 10_000 });
  });

  test('a file that is not a Word document is named, and a failed draft can be retried', async ({ page }) => {
    await createFlowAndOpenCanvas(page, `Template Draft Errors ${Date.now()}`, { expertRole: 'E2E Template Expert' });
    await addDocumentStep(page);
    await page.route(/\/api\/flows\/[^/]+\/nodes\/[^/]+\/template\/draft$/, async (route: Route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: "Couldn't draft fields from these examples." }),
      });
    });

    await openUploadChoice(page);
    await chooseExamples(page, [{ ...examplesFile('prices.pdf'), mimeType: 'application/pdf' }]);
    await expect(page.getByText('Only Word (.docx) files can be used as examples.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft template' })).toBeDisabled();

    await page.getByRole('button', { name: 'Remove prices.pdf' }).click();
    await page.locator('input[type="file"][accept=".docx"]').setInputFiles([examplesFile('contract.docx')]);
    await page.getByRole('button', { name: 'Draft template' }).click();

    await expect(page.getByText("Couldn't draft fields from these examples.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Tag it myself' }).click();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  });
});
