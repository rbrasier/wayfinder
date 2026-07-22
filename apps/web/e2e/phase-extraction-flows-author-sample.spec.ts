/**
 * phase-extraction-flows-author-sample.spec.ts
 *
 * Phase: Extraction Flows 1 — Synthesise Information surface, Authoring + Sample.
 *
 * Exercises the externally observable surface of the new extraction-flow
 * paradigm (ADR-033): the gated "Synthesise Information" route, and — when the
 * extraction_flows flag resolves for the signed-in user — the create → two-card
 * editor happy path. Both are skip-guarded so the spec is inert in an
 * environment without a seeded session or with the flag off (its default),
 * matching the other phase specs in this suite.
 */

import { test, expect } from './helpers/base';

const atLogin = (url: string): boolean => url.includes('/login');

test.describe('Synthesise Information — author + sample', () => {
  test('the /synthesise route renders its gated surface (or the disabled state)', async ({
    page,
  }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }
    await page.waitForLoadState('networkidle');

    // Enabled → the list heading (a real <h1>); disabled → the EmptyState body
    // ("… is not available"). Exactly one of the two must render.
    const listHeading = page.getByRole('heading', { name: /^Synthesise Information$/ });
    const disabledState = page.getByText(/not (available|enabled)/i);
    await expect(listHeading.or(disabledState).first()).toBeVisible();
  });

  test('an author can create a synthesis and land in the two-card editor', async ({ page }) => {
    await page.goto('/synthesise');
    if (atLogin(page.url())) {
      test.skip(true, 'No authenticated session available');
      return;
    }

    // Wait for the gated query to settle before deciding — the list heading (a
    // real <h1>) means enabled; the EmptyState body means disabled. This avoids
    // acting during the loading window.
    const listHeading = page.getByRole('heading', { name: /^Synthesise Information$/ });
    const disabledState = page.getByText(/not (available|enabled)/i);
    await expect(listHeading.or(disabledState).first()).toBeVisible();

    if (await disabledState.isVisible().catch(() => false)) {
      test.skip(true, 'extraction_flows flag not enabled for this user');
      return;
    }

    await page.getByRole('button', { name: /New synthesis/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('E2E synthesis');
    await dialog.getByRole('button', { name: /^Create$/ }).click();

    // The editor renders the two cards (input → output) with the field editor
    // and the run control.
    await expect(page.getByRole('heading', { name: /Input — documents/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Output — records/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Run sample/i })).toBeVisible();
  });
});
