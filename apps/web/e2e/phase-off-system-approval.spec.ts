/**
 * phase-off-system-approval.spec.ts
 *
 * Covers v0.33.0 — Off-system approval nomination (ADR-055).
 *
 * Qualifies under group 3 of docs/guides/e2e-test-policy.md: the evidence file
 * crosses the browser boundary on the way in (a file picker) and on the way back
 * out (a download stream), and neither half exists below the browser.
 *
 * Everything else about the feature — who may nominate, the date rules, what is
 * frozen into the record, how the signature block reads — is asserted at the
 * domain, application and component layers and is deliberately not re-tested
 * here.
 *
 * Serial, and the recording test is last: it advances the seeded session past
 * the approval, so the two read-only tests would have no gate to look at if they
 * ran after it.
 *
 * Visual spec (approver-picker.tsx + off-system-approval-dialog.tsx):
 *   The "Awaiting approval" panel carries an "Approved off system" button beside
 *   the other actions. It opens a dialog with a required file input, a required
 *   date defaulting to today, and an optional note. Recording advances the
 *   session to the next step.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

const EVIDENCE = {
  name: 'signed-memo.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('A scan of the manager signing the purchase request.'),
};

test.describe.serial('Approvals: recording an approval given off system', () => {
  test('the awaiting-approval panel offers the action', async ({ page, consoleLogs }) => {
    const { offSystemApprovalSessionId } = requireSeedFixtures();

    await page.goto(`/chats/${offSystemApprovalSessionId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-approval-gate]')).toBeVisible();
    await expect(page.locator('[data-approval-off-system]')).toBeVisible();
    await page.screenshot({
      path: 'screenshots/off-system-approval-gate.png',
      fullPage: true,
    });

    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(errors, `JS errors:\n${errors.map((e) => e.text).join('\n')}`).toHaveLength(0);
  });

  test('recording is blocked until evidence is attached', async ({ page }) => {
    const { offSystemApprovalSessionId } = requireSeedFixtures();

    await page.goto(`/chats/${offSystemApprovalSessionId}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-approval-off-system]').click();

    // The date arrives filled in, so the only thing still missing is the file —
    // which is exactly what has to keep the button disabled.
    await expect(page.locator('[data-off-system-date]')).not.toHaveValue('');
    await expect(page.locator('[data-off-system-submit]')).toBeDisabled();
    await page.screenshot({
      path: 'screenshots/off-system-approval-dialog-blocked.png',
      fullPage: true,
    });

    await page.locator('[data-off-system-evidence]').setInputFiles(EVIDENCE);
    await expect(page.locator('[data-off-system-submit]')).toBeEnabled();
  });

  test('recording it advances the session and files the evidence for download', async ({
    page,
  }) => {
    const { offSystemApprovalSessionId, offSystemApprovalNextStepName } = requireSeedFixtures();

    await page.goto(`/chats/${offSystemApprovalSessionId}`);
    await page.waitForLoadState('networkidle');

    await page.locator('[data-approval-off-system]').click();
    await page.locator('[data-off-system-evidence]').setInputFiles(EVIDENCE);
    await page.locator('[data-off-system-submit]').click();

    // The gate is what the pending approval was holding the session on, so its
    // disappearance is the session having moved.
    await expect(page.locator('[data-approval-gate]')).toBeHidden();
    await expect(page.getByText(offSystemApprovalNextStepName).first()).toBeVisible();
    await page.screenshot({
      path: 'screenshots/off-system-approval-recorded.png',
      fullPage: true,
    });

    // The decision now reads as off-system in the approver's own history.
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Completed' }).click();

    const decided = page.locator('[data-approval-status="approved"]').first();
    await expect(decided).toBeVisible();
    await expect(decided.locator('[data-approval-off-system-chip]')).toBeVisible();
    await decided.click();

    // The other half of group 3: the filed evidence comes back down as an
    // attachment, authorised through the approval's own session.
    const link = page.locator('[data-approval-evidence-link]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText(EVIDENCE.name);
    await page.screenshot({
      path: 'screenshots/off-system-approval-evidence.png',
      fullPage: true,
    });

    const href = await link.getAttribute('href');
    const evidence = await page.request.get(href!);
    expect(evidence.status()).toBe(200);
    expect(evidence.headers()['content-disposition']).toContain(EVIDENCE.name);
    expect(Buffer.from(await evidence.body()).toString('utf8')).toBe(
      EVIDENCE.buffer.toString('utf8'),
    );
  });
});
