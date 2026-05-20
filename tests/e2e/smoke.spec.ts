/**
 * smoke.spec.ts
 *
 * Fast, broad checks: is the app running? Do the main pages load?
 * Are there any JS errors? Every test takes a full-page screenshot.
 * Console logs are captured automatically via the base fixture.
 */

import { test, expect } from './helpers/base';

test.describe('Smoke — App health', () => {
  test('homepage loads without JS errors', async ({ page, consoleLogs }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/smoke-homepage.png', fullPage: true });

    const jsErrors = consoleLogs.filter(l => l.type === 'error');
    expect(jsErrors, `JS errors on homepage:\n${jsErrors.map(e => e.text).join('\n')}`).toHaveLength(0);
  });

  test('authenticated user does not land on login page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login/);
  });

  test('page has a valid title', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.trim().length, 'Page title should not be empty').toBeGreaterThan(0);
  });

  test('no failed network requests (4xx/5xx)', async ({ page }) => {
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      // Ignore known non-critical endpoints
      if (status >= 400 && !url.includes('favicon') && !url.includes('hot-update')) {
        failedRequests.push(`${status} ${url}`);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(
      failedRequests,
      `Failed network requests:\n${failedRequests.join('\n')}`
    ).toHaveLength(0);
  });
});

test.describe('Smoke — Key pages', () => {
  const PAGES = [
    { name: 'Admin Flows', path: '/admin/flows', screenshot: 'smoke-admin-flows.png' },
    { name: 'Dashboard / Home', path: '/', screenshot: 'smoke-dashboard.png' },
  ];

  for (const { name, path: pagePath, screenshot } of PAGES) {
    test(`${name} renders without errors`, async ({ page, consoleLogs }) => {
      await page.goto(pagePath);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `screenshots/${screenshot}`, fullPage: true });

      const jsErrors = consoleLogs.filter(l => l.type === 'error');
      expect(
        jsErrors,
        `JS errors on ${name}:\n${jsErrors.map(e => e.text).join('\n')}`
      ).toHaveLength(0);
    });
  }
});
