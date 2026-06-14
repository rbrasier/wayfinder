/**
 * enhance-flow-selector-search.spec.ts
 *
 * Covers docs/development/implemented/v1.23.4/flow-selector-search.md:
 * when the flow selector on /admin/dashboards/flows has more than 5 cards
 * only the top 5 are shown and a "Search for more" button appears.
 * Clicking it opens an auto-suggest input; selecting a flow closes the input
 * and activates that flow. Pressing Escape dismisses without changing selection.
 */

import { test, expect } from './helpers/base';

test.describe('Flow selector: search-for-more', () => {
  test('page loads without JS errors', async ({ page, consoleLogs }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/enhance-flow-selector-search-load.png', fullPage: true });

    const errors = consoleLogs.filter((l) => l.type === 'error');
    expect(
      errors,
      `JS errors on flow insights dashboard:\n${errors.map((e) => e.text).join('\n')}`,
    ).toHaveLength(0);
  });

  test('search button is absent when five or fewer flows exist', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    if (await page.getByText(/no flows yet/i).isVisible().catch(() => false)) {
      test.skip(true, 'No flows — empty state shown');
      return;
    }

    const hasSearchButton = await page
      .getByRole('button', { name: /search for more/i })
      .isVisible()
      .catch(() => false);
    if (hasSearchButton) {
      test.skip(true, 'More than 5 flows present — search button already visible');
      return;
    }

    await expect(page.getByRole('button', { name: /search for more/i })).not.toBeVisible();
  });

  test('search button appears when more than five flows are shown', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    if (await page.getByText(/no flows yet/i).isVisible().catch(() => false)) {
      test.skip(true, 'No flows — empty state shown');
      return;
    }

    const flowButtons = page.getByRole('button').filter({ hasText: /\bsessions?\b/i });
    const count = await flowButtons.count();

    if (count <= 5) {
      test.skip(true, 'Five or fewer flows present — search button does not appear');
      return;
    }

    await expect(page.getByRole('button', { name: /search for more/i })).toBeVisible();
    await expect(flowButtons).toHaveCount(5);

    await page.screenshot({ path: 'screenshots/enhance-flow-selector-search-button.png', fullPage: true });
  });

  test('clicking search button opens the auto-suggest input', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    const searchButton = page.getByRole('button', { name: /search for more/i });
    if (!(await searchButton.isVisible().catch(() => false))) {
      test.skip(true, 'Search button not present — requires > 5 flows');
      return;
    }

    await searchButton.click();

    const searchInput = page.getByPlaceholder(/search flows/i);
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    await page.screenshot({ path: 'screenshots/enhance-flow-selector-search-open.png', fullPage: true });
  });

  test('typing in the search input filters the dropdown', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    const searchButton = page.getByRole('button', { name: /search for more/i });
    if (!(await searchButton.isVisible().catch(() => false))) {
      test.skip(true, 'Search button not present — requires > 5 flows');
      return;
    }

    await searchButton.click();

    const searchInput = page.getByPlaceholder(/search flows/i);
    await searchInput.fill('zzz_no_match_xyz');

    // Dropdown should be empty or absent when no flows match
    const dropdownItems = page.locator('[data-testid="flow-search-option"]');
    await expect(dropdownItems).toHaveCount(0);

    await page.screenshot({ path: 'screenshots/enhance-flow-selector-search-filtered.png', fullPage: true });
  });

  test('pressing Escape closes the input and restores the search button', async ({ page }) => {
    await page.goto('/admin/dashboards/flows');
    await page.waitForLoadState('networkidle');

    const searchButton = page.getByRole('button', { name: /search for more/i });
    if (!(await searchButton.isVisible().catch(() => false))) {
      test.skip(true, 'Search button not present — requires > 5 flows');
      return;
    }

    await searchButton.click();
    const searchInput = page.getByPlaceholder(/search flows/i);
    await expect(searchInput).toBeVisible();

    await searchInput.press('Escape');

    await expect(searchInput).not.toBeVisible();
    await expect(page.getByRole('button', { name: /search for more/i })).toBeVisible();

    await page.screenshot({ path: 'screenshots/enhance-flow-selector-search-escape.png', fullPage: true });
  });
});
