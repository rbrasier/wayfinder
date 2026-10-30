/**
 * phase-flow-test-runs.spec.ts
 *
 * End-to-end coverage for the Flow Test Runs phase (ADR-048).
 *
 * Only the two behaviours the e2e policy reserves for a browser are here:
 *
 *   Group 2 — streaming into the DOM. The modal mounts the operator's own chat
 *   surface, so "the server sent the turn" and "the author saw it inside the
 *   modal" are genuinely different facts. Nothing below the browser can tell
 *   them apart.
 *
 * Group 3 — file download — is deliberately NOT covered here. Reaching a real
 * document generation needs a step with an uploaded template, a server-side AI
 * script returning field values complete enough to pass the readiness gate, and
 * the id of a session the modal creates and never exposes to the DOM. No spec
 * in this suite drives generation end to end for exactly that reason; the
 * spreadsheet-templates spec mocks the upload at the network boundary and
 * asserts UI hints only. A spec that cannot reach its assertion is worse than
 * no spec, so the coverage stays where it already is: DocxGenerator adapter
 * tests for generation, and GetTestRunReport's documentFilename test for a
 * seeded run surfacing the file. Revisit if a seeded-document fixture lands.
 *
 * Everything else about this feature is covered where it belongs: the seed
 * validator and nodesPrecedingNode in packages/domain, the materialisation and
 * report use-cases in packages/application, the five-repository isolation
 * predicate in packages/adapters, and the authorisation boundary in the
 * flow-test router test. None of that is repeated here.
 */

import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';
import { clearAiScript, incompleteTurn, scriptAiFor } from './helpers/ai-script';
import { createFlowAndOpenCanvas } from './helpers/flow-builder';

const TEST_BANNER = /This is a test run/i;

async function addConversationalStep(page: Page, name: string): Promise<void> {
  const addStepButtons = page.getByRole('button', { name: '+ Add step' });
  await expect(addStepButtons.first()).toBeVisible({ timeout: 10_000 });
  await addStepButtons.last().click();
  await page.getByRole('button', { name: 'Conversational' }).click();
  await expect(page.locator('#node-name')).toBeVisible({ timeout: 5_000 });
  await page.locator('#node-name').fill(name);
  await page.locator('#ai-instruction').fill('Find out what the buyer needs.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#node-name')).toBeHidden({ timeout: 10_000 });
}

async function openTestModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText(TEST_BANNER)).toBeVisible({ timeout: 10_000 });
}

test.describe('phase: flow test runs', () => {
  test('an unpublished draft streams a turn into the modal without leaving the canvas', async ({
    page,
  }) => {
    const flowName = `Test Runs ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName, { expertRole: 'E2E Procurement Expert' });
    await addConversationalStep(page, 'Gather requirements');

    const canvasUrl = page.url();

    await openTestModal(page);
    // The modal creates the session and never puts its id in the DOM; the chat
    // surface it mounts subscribes to that session's events, which carries it.
    const eventsRequest = page.waitForRequest(/\/api\/sessions\/[^/]+\/events/);
    await page.getByRole('button', { name: 'Start test run' }).click();
    const sessionId = new URL((await eventsRequest).url()).pathname.split('/')[3];

    // The base fixture answers the stream in the browser, and the chat surface
    // drops that reply when it resyncs with the stored history at the end of the
    // turn. Scripting the server's AI stores the reply, so it stays.
    const reply = 'How many laptops, and by when?';
    await scriptAiFor(page, sessionId, [incompleteTurn(reply)]);

    try {
      // The composer belongs to the operator's chat surface. Its presence inside
      // the modal is the evidence that the real surface mounted, not a copy.
      const composer = page.getByRole('textbox').last();
      await expect(composer).toBeVisible({ timeout: 20_000 });

      await composer.fill('We need 40 laptops for the finance team.');
      await composer.press('Enter');

      // The streamed assistant turn has to reach the DOM inside the modal — the
      // one fact no unit or adapter test can establish.
      await expect(
        page.locator('[data-chat-message="assistant"]').filter({ hasText: reply }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(TEST_BANNER)).toBeVisible();

      // The author never navigated away: same URL, canvas still behind the modal.
      expect(page.url()).toBe(canvasUrl);
    } finally {
      await clearAiScript(page, sessionId);
    }
  });

  test('closing the modal returns the author to the canvas', async ({ page }) => {
    const flowName = `Test Runs Close ${Date.now()}`;
    await createFlowAndOpenCanvas(page, flowName, { expertRole: 'E2E Procurement Expert' });
    await addConversationalStep(page, 'Gather requirements');

    const canvasUrl = page.url();
    await openTestModal(page);
    await page.keyboard.press('Escape');

    await expect(page.getByText(TEST_BANNER)).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '+ Add step' }).first()).toBeVisible();
    expect(page.url()).toBe(canvasUrl);
  });
});
