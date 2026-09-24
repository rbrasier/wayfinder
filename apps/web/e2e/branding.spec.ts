/**
 * branding.spec.ts
 *
 * Install branding (ADR-060) — the file-upload half, which only a browser can
 * prove (e2e policy group 3: file upload). The contrast rule, palette and name
 * are covered by domain, application and route-handler tests.
 *
 * Visual spec:
 *   /admin/settings → "General" → "Branding" card: a logo preview with an
 *   Upload / Replace button and a Remove button. An uploaded logo replaces the
 *   "W" tile in the sidebar and above the sign-in form.
 *
 * Branding is install-wide, so this spec runs serially and always removes the
 * logo afterwards to keep other specs' screens unchanged.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';
import { openSettingsSection } from './helpers/settings';

// A real 1×1 PNG, so the browser can decode what the route serves.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const SVG_LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

async function openBrandingCard(page: Page): Promise<void> {
  await page.goto('/admin/settings');
  await openSettingsSection(page, 'General');
  await expect(page.getByText('Branding', { exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Admin: install branding logo', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/admin.json' });
    await context.request.delete('/api/branding/logo').catch(() => undefined);
    await context.close();
  });

  test('an uploaded logo replaces the W tile in the app and on the sign-in page', async ({
    page,
    browser,
  }) => {
    await openBrandingCard(page);

    await page.locator('[data-testid="branding-logo-input"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });

    await expect(page.getByText('Logo uploaded')).toBeVisible();
    await expect(page.locator('[data-testid="branding-logo-remove"]')).toBeVisible();
    const logo = page.locator('[data-testid="brand-logo"]').first();
    await expect(logo).toHaveAttribute('src', /^\/api\/branding\/logo\?v=\d+$/);
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);

    const signedOutContext = await browser.newContext();
    const signedOut = await signedOutContext.newPage();
    await signedOut.goto('/login');
    await expect(signedOut.locator('[data-testid="brand-logo"]')).toBeVisible();
    await expect(signedOut.locator('[data-testid="brand-tile"]')).toHaveCount(0);
    await signedOutContext.close();
  });

  test('an SVG is refused, whatever it is called', async ({ page }) => {
    await openBrandingCard(page);

    await page.locator('[data-testid="branding-logo-input"]').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: SVG_LOGO,
    });

    // The card's help text says the same thing, so look for the rejection toast.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: /SVG isn.t accepted/ }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="branding-logo-remove"]')).toBeVisible();
  });

  test('removing the logo brings back the W tile', async ({ page }) => {
    await openBrandingCard(page);

    await page.locator('[data-testid="branding-logo-remove"]').click();

    await expect(page.getByText('Logo removed')).toBeVisible();
    await expect(page.locator('[data-testid="branding-logo-remove"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="brand-logo"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="brand-tile"]').first()).toHaveText('W');
  });
});
