/**
 * document-signatures.spec.ts
 *
 * Covers document signatures (ADR-067/068): an approval step set to "Convert to
 * PDF on signing" produces a PDF the approver can download once they approve.
 *
 * Qualifies under group 3 of docs/guides/e2e-test-policy.md: the signed PDF
 * leaves through a download stream, which does not exist below the browser.
 *
 * Everything else — the signature-method gate, drawn images in the .docx,
 * certificate signing, validation badges, the freeze — is asserted at the
 * domain, application and adapter layers, and the real PAdES chain by the
 * dss-integration CI job against the DSS sidecar.
 *
 * The seed points the PDF converter at the mocks server's Gotenberg stand-in,
 * which the e2e workflow already starts on :4001.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

const ROUTE_COMPILE_TIMEOUT = 30_000;

test.describe.serial('Document signatures: PDF on signing', () => {
  test.slow();

  test('approving a converting step offers the signed document as a PDF', async ({ page, consoleLogs }) => {
    const { signingSessionId } = requireSeedFixtures();

    await page.goto('/approvals');
    const row = page.locator('[data-approval-status="pending"]', { hasText: 'E2E SEED Signing Session' });
    await expect(row).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });
    await row.getByRole('button', { name: 'Approve' }).click();
    const confirm = page.getByRole('button', { name: 'Confirm approval' });
    await confirm.click();
    // Recorded once the button goes: the dialog may stay open to offer manual
    // notification when email is not configured, which is not this spec's concern.
    await expect(confirm).toBeHidden({ timeout: ROUTE_COMPILE_TIMEOUT });

    await page.goto(`/chats/${signingSessionId}`);
    // Approving completed the seeded session, which always asks for the
    // manual-time estimate first.
    const estimate = page.getByRole('dialog', { name: 'How long would this have taken the old way?' });
    await expect(estimate).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });
    await estimate.getByRole('button', { name: 'Skip' }).click();
    const pdfButton = page.getByTestId('document-download-pdf').first();
    await expect(pdfButton).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });

    const downloadPromise = page.waitForEvent('download');
    await pdfButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    await page.screenshot({ path: 'screenshots/document-signatures-pdf.png', fullPage: true });

    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(errors, `JS errors:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('a document no step converts offers no PDF', async ({ page }) => {
    const { approvalSubjectSessionId } = requireSeedFixtures();

    // The approval-subject seed never converts, so its card offers the .docx
    // alone — the PDF button is earned, never shown by default.
    await page.goto(`/chats/${approvalSubjectSessionId}`);
    await expect(page.getByRole('button', { name: /Download/ }).first()).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });
    await expect(page.getByTestId('document-download-pdf')).toHaveCount(0);
  });
});
