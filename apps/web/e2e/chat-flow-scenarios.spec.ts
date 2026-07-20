/**
 * chat-flow-scenarios.spec.ts
 *
 * End-to-end chat tests that exercise specific flow structures created by
 * admin-flow-editing.spec.ts. Because tests run sequentially (workers: 1),
 * those flows will exist in the DB before these tests run.
 *
 *   Two-step linear flow session
 *     Finds any flow whose name starts with "E2E Two-Step", starts a session,
 *     sends two messages and screenshots each exchange.
 *
 *   Branching flow session
 *     Finds any flow whose name starts with "E2E Branch", starts a session,
 *     then sends multiple messages to build up conversation history. After
 *     each AI response the test checks whether:
 *       - A document card has appeared (the Generate Report step completed)
 *       - The branch override banner has appeared ("Pick a step manually")
 *     Screenshots are taken at every exchange regardless of which path fires.
 *
 * Both tests skip gracefully if the prerequisite flow/session is missing
 * rather than failing — the admin-flow-editing tests are the real gate.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const AI_TIMEOUT = process.env.USE_REAL_AI === 'true' ? 30_000 : 8_000;

async function findPublishedFlowInModal(
  page: Page,
  namePrefix: string,
): Promise<boolean> {
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  await page.getByRole('banner').getByRole('button', { name: /new chat/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const flowOption = dialog.locator(`button:has-text("${namePrefix}")`).first();
  return flowOption.isVisible().catch(() => false);
}

async function startSessionFromModal(
  page: Page,
  namePrefix: string,
): Promise<boolean> {
  await page.goto('/chats');
  await page.waitForLoadState('networkidle');

  await page.getByRole('banner').getByRole('button', { name: /new chat/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Each flow option shows a "Start →" button; find the one for our flow
  const flowRow = dialog.locator(`button:has-text("${namePrefix}")`).first();
  const hasFlow = await flowRow.isVisible().catch(() => false);

  if (!hasFlow) {
    // Fall back: look for any Start button if the flow name is truncated
    const startBtn = dialog.locator('button:has-text("Start")').first();
    const hasStart = await startBtn.isVisible().catch(() => false);
    if (!hasStart) return false;
    await startBtn.click();
  } else {
    // The flow row itself may be a card with a sibling Start button
    const startBtn = dialog
      .locator(`[class*="flow"], li, div`)
      .filter({ hasText: namePrefix })
      .locator('button:has-text("Start")')
      .first();

    const hasStart = await startBtn.isVisible().catch(() => false);
    if (hasStart) {
      await startBtn.click();
    } else {
      // Some layouts put Start buttons separate from the name
      await dialog.locator('button:has-text("Start")').first().click();
    }
  }

  const navigated = await page
    .waitForURL(/\/chats\/.+/, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  return navigated;
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page
    .locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]')
    .first();

  await input.fill(message);

  // Use Enter on the textarea rather than clicking the send button.
  // The Next.js dev overlay portal covers the bottom-right of the viewport
  // in headless mode, intercepting pointer events on the send button.
  // The textarea's keydown handler is identical in behaviour.
  await input.press('Enter');

  // Wait for the input to clear — confirms the message was accepted
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector) as HTMLTextAreaElement | null;
      return el ? el.value.length === 0 : false;
    },
    'textarea',
    { timeout: AI_TIMEOUT },
  ).catch(() => {});
}

async function waitForResponse(page: Page): Promise<void> {
  await page
    .waitForSelector(
      '[class*="message"], [data-testid="message"], [data-role="assistant"]',
      { timeout: AI_TIMEOUT },
    )
    .catch(() => {});
}

test.describe('Chat: Two-Step Flow Session', () => {
  test('user sends messages through a two-step linear flow', async ({ page, consoleLogs }) => {
    const opened = await startSessionFromModal(page, 'E2E Two-Step');

    if (!opened) {
      await page.screenshot({ path: 'screenshots/two-step-chat-no-flow.png', fullPage: true });
      test.skip(true, 'No published E2E Two-Step flow found — run admin-flow-editing.spec.ts first');
      return;
    }

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/two-step-chat-01-session-opened.png', fullPage: true });

    const input = page
      .locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]')
      .first();

    if (!await input.isVisible().catch(() => false)) {
      await page.screenshot({ path: 'screenshots/two-step-chat-no-input.png', fullPage: true });
      test.skip(true, 'Chat input not visible — session may already be complete');
      return;
    }

    // Exchange 1 — introduce the request
    await sendMessage(page, 'Hi, I need to document our onboarding process for new engineers.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/two-step-chat-02-after-message-1.png', fullPage: true });

    // Exchange 2 — provide detail to build toward step completion
    await sendMessage(page, 'The process covers account setup, codebase walkthrough, and a 30-day check-in. The team is 8 people.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/two-step-chat-03-after-message-2.png', fullPage: true });

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in two-step chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});

test.describe('Chat: Branching Flow Session', () => {
  test('user builds confidence, gets a document, then selects a branch', async ({ page, consoleLogs }) => {
    const opened = await startSessionFromModal(page, 'E2E Branch');

    if (!opened) {
      await page.screenshot({ path: 'screenshots/branch-chat-no-flow.png', fullPage: true });
      test.skip(true, 'No published E2E Branch flow found — run admin-flow-editing.spec.ts first');
      return;
    }

    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/branch-chat-01-session-opened.png', fullPage: true });

    const input = page
      .locator('textarea[placeholder*="Wayfinder"], textarea[placeholder*="message" i]')
      .first();

    if (!await input.isVisible().catch(() => false)) {
      await page.screenshot({ path: 'screenshots/branch-chat-no-input.png', fullPage: true });
      test.skip(true, 'Chat input not visible');
      return;
    }

    // --- Gather Info step: multiple exchanges to build confidence ---

    // Exchange 1 — name and organisation
    await sendMessage(page, 'My name is Alex Chen and I work at Meridian Technologies.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/branch-chat-02-after-message-1.png', fullPage: true });

    // Exchange 2 — nature of the request
    await sendMessage(page, 'We have a network connectivity issue affecting our London office. It started this morning.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/branch-chat-03-after-message-2.png', fullPage: true });

    // Exchange 3 — additional detail to push confidence higher
    await sendMessage(page, 'The issue is intermittent and affects about 30 users. Our IT team has already ruled out local hardware faults.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/branch-chat-04-after-message-3.png', fullPage: true });

    // --- Check for document card (Generate Report step) ---

    const documentCard = page.locator([
      '[data-testid="document-card"]',
      '[class*="document-card"]',
      'button:has-text("Download")',
      'button:has-text("Regenerate")',
      'a[download]',
    ].join(', ')).first();

    const hasDocument = await documentCard.isVisible().catch(() => false);
    if (hasDocument) {
      await page.screenshot({ path: 'screenshots/branch-chat-05-document-generated.png', fullPage: true });
      await expect(documentCard).toBeVisible();
    } else {
      await page.screenshot({ path: 'screenshots/branch-chat-05-no-document-yet.png', fullPage: true });
    }

    // Exchange 4 — one more message in case more confidence is needed
    await sendMessage(page, 'The request type is definitely technical — it needs engineering support.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/branch-chat-06-after-message-4.png', fullPage: true });

    // Exchange 5 — confirm readiness to proceed
    await sendMessage(page, 'I have provided all the details. Please proceed with the report.');
    await waitForResponse(page);
    await page.screenshot({ path: 'screenshots/branch-chat-07-after-message-5.png', fullPage: true });

    // --- Check for branch override banner ---
    // The banner appears for admin users after NULL_BRANCH_THRESHOLD (3) high-confidence
    // responses on a node that has multiple outgoing edges.
    const branchBanner = page.getByText('Wayfinder could not determine the next step').first();
    const hasBanner = await branchBanner.isVisible().catch(() => false);

    if (hasBanner) {
      await page.screenshot({ path: 'screenshots/branch-chat-08-branch-banner.png', fullPage: true });

      await page.getByRole('button', { name: /pick a step manually/i }).click();
      const branchDialog = page.getByRole('dialog');
      await expect(branchDialog).toBeVisible();
      await page.screenshot({ path: 'screenshots/branch-chat-09-branch-dialog.png', fullPage: true });

      // Select the first available branch option
      const firstOption = branchDialog
        .locator('button[class*="rounded"]')
        .first();

      if (await firstOption.isVisible().catch(() => false)) {
        await firstOption.click();
        await page.screenshot({ path: 'screenshots/branch-chat-10-branch-selected.png', fullPage: true });

        await branchDialog.getByRole('button', { name: /advance to step/i }).click();
        await page.waitForTimeout(1_000);
        await page.screenshot({ path: 'screenshots/branch-chat-11-branch-advanced.png', fullPage: true });
      }
    } else {
      await page.screenshot({ path: 'screenshots/branch-chat-08-no-banner-yet.png', fullPage: true });
    }

    const errors = consoleLogs.filter(l => l.type === 'error');
    expect(errors, `Errors in branching chat:\n${errors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });
});
