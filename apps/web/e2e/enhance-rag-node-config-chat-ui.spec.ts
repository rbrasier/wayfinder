/**
 * enhance-rag-node-config-chat-ui.spec.ts
 *
 * Covers v1.36.0 — RAG-era node config & chat UI improvements:
 *   1. The context-doc strip no longer shows a usage/budget progress bar.
 *   2. "+ Add step" opens a node-type picker first; choosing a type opens the
 *      config modal (with a blank step name and no in-modal type selector) for an
 *      already-persisted node.
 *   3. Every node config offers a "Notify chat participants when step complete"
 *      toggle.
 *   4. The chat 3-dot menu labels the abandon action "Abandon" and offers a
 *      "Show data" entry.
 *
 * Blocks skip cleanly when their prerequisites are unavailable in the
 * environment.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

async function createFlowReturningId(page: Page, name: string): Promise<string | null> {
  await page.goto('/admin/flows');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new flow/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#flow-name').fill(name);
  await page.locator('#flow-expert-role').fill('E2E RAG Config Expert');
  await page.getByRole('button', { name: /create flow/i }).click();

  // Creating a flow lands on the canvas editor directly (v0.21.0).
  await page.waitForURL(/\/flows\/[^/]+\/config$/, { timeout: 30_000 }).catch(() => undefined);

  const match = /\/flows\/([0-9a-f-]{36})/.exec(page.url());
  return match?.[1] ?? null;
}

// Secondary step controls sit behind a collapsed "Advanced" disclosure
// (v0.27.5). It expands itself for some step types, so only click when closed.
async function openAdvanced(page: Page): Promise<void> {
  const section = page.locator('[data-advanced-section="section"]');
  await expect(section).toBeAttached({ timeout: 5_000 });
  if (await section.evaluate((element: HTMLDetailsElement) => element.open)) return;
  await section.locator('summary').click();
}

test.describe('RAG node config & chat UI improvements', () => {
  test('Add step opens a type picker, then a blank config with a notify toggle', async ({ page }) => {
    const flowId = await createFlowReturningId(page, `RAG Config ${Date.now()}`);
    test.skip(!flowId, 'Could not create a flow / resolve its id');

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);

    // The context-doc usage/budget progress bar is gone.
    await expect(page.getByText(/chars \//)).toHaveCount(0);

    // "+ Add step" opens the type picker first — not the config modal.
    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add a step' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#node-name')).toHaveCount(0);

    // Choosing a type opens the config modal for an already-persisted node.
    await page.getByRole('button', { name: 'Conversational' }).click();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });

    // The step name starts blank (no "New step" prefill), and the in-modal step
    // type selector has been removed.
    await expect(page.locator('#node-name')).toHaveValue('');
    await expect(page.getByText('Step type', { exact: true })).toHaveCount(0);

    // Every node type offers the notify-on-complete toggle. It moved behind the
    // collapsed "Advanced" disclosure in v0.27.5, so open that first.
    await openAdvanced(page);
    await expect(
      page.getByText('Notify chat participants when step complete'),
    ).toBeVisible();
  });

  test('the chat 3-dot menu offers Abandon and Show data', async ({ page }) => {
    const flowId = await createFlowReturningId(page, `RAG Chat ${Date.now()}`);
    test.skip(!flowId, 'Could not create a flow / resolve its id');

    // Add and configure one conversational step so the flow can be started.
    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: '+ Add step' }).first().click();
    await page.getByRole('button', { name: 'Conversational' }).click();
    await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
    await page.locator('#node-name').fill('Gather details');
    await page.locator('#ai-instruction').fill('Ask the user for their details.');
    // The default output type is "generate document" (v0.21.0); this spec drives
    // a real chat with no template, so it needs a plain conversation.
    await page.locator('label', { hasText: 'Unstructured conversation' }).click();
    await openAdvanced(page);
    await page.locator('#done-when-mode').selectOption('condition');
    await page.locator('#done-when').fill('The user has provided their details.');
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });

    // Publish so a chat session can be started.
    await page.getByRole('button', { name: 'Flow actions' }).click();
    const publishPrivately = page.getByRole('button', { name: /Publish privately/i });
    test.skip(
      !(await publishPrivately.isVisible().catch(() => false)),
      'Publish action not available in this environment',
    );
    await publishPrivately.click();
    await page.waitForTimeout(800);

    // Start a chat for the flow.
    await page.goto(`/chats?flow=${flowId}&start=1`);
    await page.waitForURL(/\/chats\/[0-9a-f-]{36}/, { timeout: 15_000 }).catch(() => undefined);
    test.skip(!/\/chats\/[0-9a-f-]{36}/.test(page.url()), 'Could not start a chat session');

    await page.getByRole('button', { name: 'Chat actions' }).click();
    await expect(page.getByRole('button', { name: 'Abandon' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Show data' })).toBeVisible();

    // Show data opens a modal listing completed steps (none yet for a fresh chat).
    await page.getByRole('button', { name: 'Show data' }).click();
    await expect(page.getByRole('heading', { name: 'Session data' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No steps have been completed yet.')).toBeVisible();
  });
});
