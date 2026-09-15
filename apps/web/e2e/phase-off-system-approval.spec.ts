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
 * No `waitForLoadState('networkidle')`: the chat holds an open EventSource for
 * session events, so the network never goes idle there and the wait can only
 * time out. Every assertion below auto-waits on the element it is about.
 *
 * Visual spec (approver-picker.tsx + off-system-approval-dialog.tsx):
 *   The "Awaiting approval" panel carries an "Approved off system" button beside
 *   the other actions. It opens a dialog with a required file input, a required
 *   date defaulting to today, and an optional note. Recording advances the
 *   session to the next step.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

// CI serves the app from `next dev`, which compiles a route the first time it is
// visited. This spec is the first to reach three of them — the chat, the
// approvals queue and a decision page — plus a brand-new API route, so every
// first-touch assertion is sized for a cold compile rather than a warm one.
const ROUTE_COMPILE_TIMEOUT = 30_000;

const EVIDENCE = {
  name: 'signed-memo.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('A scan of the manager signing the purchase request.'),
};

test.describe.serial('Approvals: recording an approval given off system', () => {
  // The recording test walks three cold routes end to end, which does not fit
  // the default per-test budget on a cold server.
  test.slow();

  test('the awaiting-approval panel offers the action', async ({ page, consoleLogs }) => {
    const { offSystemApprovalSessionId } = requireSeedFixtures();

    await page.goto(`/chats/${offSystemApprovalSessionId}`);

    await expect(page.locator('[data-approval-gate]')).toBeVisible({
      timeout: ROUTE_COMPILE_TIMEOUT,
    });
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

    await expect(page.locator('[data-approval-off-system]')).toBeVisible({
      timeout: ROUTE_COMPILE_TIMEOUT,
    });
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

    await expect(page.locator('[data-approval-off-system]')).toBeVisible({
      timeout: ROUTE_COMPILE_TIMEOUT,
    });
    await page.locator('[data-approval-off-system]').click();
    await page.locator('[data-off-system-evidence]').setInputFiles(EVIDENCE);
    await page.locator('[data-off-system-submit]').click();

    // The gate is what the pending approval was holding the session on, so its
    // disappearance is the session having moved.
    await expect(page.locator('[data-approval-gate]')).toBeHidden({
      timeout: ROUTE_COMPILE_TIMEOUT,
    });
    await expect(page.getByText(offSystemApprovalNextStepName).first()).toBeVisible();
    await page.screenshot({
      path: 'screenshots/off-system-approval-recorded.png',
      fullPage: true,
    });

    // The decision now reads as off-system in the approver's own history.
    await page.goto('/approvals', { timeout: ROUTE_COMPILE_TIMEOUT * 2 });
    await page.getByRole('button', { name: 'Completed' }).click();

    const decided = page.locator('[data-approval-status="approved"]').first();
    await expect(decided).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });
    await expect(decided.locator('[data-approval-off-system-chip]')).toBeVisible();

    // Followed by href rather than clicked: the queue refetches on mount and on
    // the tab switch, so the row can be replaced under a click that has already
    // resolved its target, leaving the test on the list it started from. The
    // row is a plain link, and the decision page is what this is about.
    await page.goto((await decided.getAttribute('href'))!, {
      timeout: ROUTE_COMPILE_TIMEOUT * 2,
    });

    // The other half of group 3: the filed evidence comes back down as an
    // attachment, authorised through the approval's own session.
    const link = page.locator('[data-approval-evidence-link]');
    await expect(link).toBeVisible({ timeout: ROUTE_COMPILE_TIMEOUT });
    await expect(link).toHaveText(EVIDENCE.name);
    await page.screenshot({
      path: 'screenshots/off-system-approval-evidence.png',
      fullPage: true,
    });

    const href = await link.getAttribute('href');
    const evidence = await page.request.get(href!, {
      timeout: ROUTE_COMPILE_TIMEOUT * 2,
    });
    expect(evidence.status()).toBe(200);
    expect(evidence.headers()['content-disposition']).toContain(EVIDENCE.name);
    expect(Buffer.from(await evidence.body()).toString('utf8')).toBe(
      EVIDENCE.buffer.toString('utf8'),
    );
  });
});
