/**
 * enhance-site-banner.spec.ts
 *
 * Covers v2.17.0 — the site-wide notification banner.
 *
 * Visual spec:
 *   /admin/settings → "Notifications" section → "Site Banner" card, with an
 *   "Edit" button opening a modal carrying the text, point size, two colour
 *   pickers and an optional link. Once enabled, a single centred line renders
 *   at the very top of every page — including the signed-out sign-in screen.
 *
 * The banner is global state, so this spec always switches it back off, both
 * between tests and in an afterAll guard, to keep later specs' layouts stable.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './helpers/base';

const BANNER = {
  banner: '[data-testid="site-banner"]',
  link: '[data-testid="site-banner-link"]',
  enabled: '[data-testid="site-banner-enabled"]',
  edit: '[data-testid="site-banner-edit"]',
  save: '[data-testid="site-banner-save"]',
};

const BANNER_TEXT = 'Scheduled maintenance tonight from 8pm';
const LINK_URL = 'https://status.example.com/';
const LINK_LABEL = 'View status';

async function openSettings(page: Page): Promise<void> {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Site Banner')).toBeVisible();
}

async function setBannerEnabled(page: Page, enabled: boolean): Promise<void> {
  await openSettings(page);
  const toggle = page.locator(BANNER.enabled);
  if ((await toggle.isChecked()) === enabled) return;
  // The card's toggle is driven by the saved config, not local state, so it
  // only flips once the mutation lands. setChecked() asserts the change
  // synchronously and would fail — click, then wait for the round trip.
  await toggle.click();
  await expect(page.getByText(/site banner saved/i)).toBeVisible();
  await expect(toggle).toBeChecked({ checked: enabled });
}

test.describe.configure({ mode: 'serial' });

test.describe('Admin: site notification banner', () => {
  test.afterAll(async ({ browser }) => {
    // The banner is global — leaving it on would shift every other spec.
    const context = await browser.newContext({ storageState: 'playwright/.auth/admin.json' });
    const page = await context.newPage();
    await setBannerEnabled(page, false).catch(() => undefined);
    await context.close();
  });

  test('is off by default, so no banner renders', async ({ page }) => {
    await openSettings(page);

    await expect(page.locator(BANNER.enabled)).not.toBeChecked();
    await expect(page.locator(BANNER.banner)).toHaveCount(0);
  });

  test('an admin can configure text, size, colours and a link, and it renders site-wide', async ({
    page,
  }) => {
    await openSettings(page);
    await page.locator(BANNER.edit).click();

    await page.locator('[data-testid="site-banner-text"]').fill(BANNER_TEXT);
    await page.locator('[data-testid="site-banner-size"]').fill('16');
    await page.locator('#site-banner-text-colour').fill('#ffffff');
    await page.locator('#site-banner-background-colour').fill('#b91c1c');
    await page.locator('[data-testid="site-banner-link-url"]').fill(LINK_URL);
    await page.locator('[data-testid="site-banner-link-label"]').fill(LINK_LABEL);
    await page.locator('#site-banner-draft-enabled').setChecked(true);
    await page.locator(BANNER.save).click();

    await expect(page.getByText(/site banner saved/i)).toBeVisible();

    // Reload so the banner is fetched fresh at the top of the page tree.
    await page.reload();
    await page.waitForLoadState('networkidle');

    const banner = page.locator(BANNER.banner);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(BANNER_TEXT);
    await expect(banner).toHaveCSS('font-size', '21.3333px'); // 16pt
    await expect(banner).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(banner).toHaveCSS('background-color', 'rgb(185, 28, 28)');
    await expect(banner).toHaveCSS('text-align', 'center');

    const link = page.locator(BANNER.link);
    await expect(link).toHaveText(LINK_LABEL);
    await expect(link).toHaveAttribute('href', LINK_URL);
    await expect(link).toHaveAttribute('rel', /noopener/);

    await page.screenshot({ path: 'screenshots/site-banner-admin.png', fullPage: true });

    // A user page, not just the settings screen it was configured from.
    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER.banner)).toContainText(BANNER_TEXT);

    // Exactly one line: the banner must not grow the page past the viewport.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight + 1,
    );
    expect(overflows, 'the banner must not push the page past the viewport').toBe(false);
  });

  test('the banner is visible to a signed-out visitor on the sign-in page', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(BANNER.banner)).toContainText(BANNER_TEXT);
    await page.screenshot({ path: 'screenshots/site-banner-login.png', fullPage: true });

    await context.close();
  });

  test('clearing the link keeps the text and drops the call to action', async ({ page }) => {
    await openSettings(page);
    await page.locator(BANNER.edit).click();
    await page.locator('[data-testid="site-banner-link-url"]').fill('');
    await page.locator(BANNER.save).click();
    await expect(page.getByText(/site banner saved/i)).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator(BANNER.banner)).toContainText(BANNER_TEXT);
    await expect(page.locator(BANNER.link)).toHaveCount(0);
  });

  test('a link that could execute script is rejected', async ({ page }) => {
    await openSettings(page);
    await page.locator(BANNER.edit).click();
    await page.locator('[data-testid="site-banner-link-url"]').fill('javascript:alert(1)');
    await page.locator(BANNER.save).click();

    await expect(page.getByText(/must be a full https/i)).toBeVisible();
  });

  test('switching the banner off removes it everywhere', async ({ page, browser }) => {
    await setBannerEnabled(page, false);

    await page.goto('/chats');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(BANNER.banner)).toHaveCount(0);

    const context = await browser.newContext();
    const signedOut = await context.newPage();
    await signedOut.goto('/login');
    await signedOut.waitForLoadState('networkidle');
    await expect(signedOut.locator(BANNER.banner)).toHaveCount(0);
    await context.close();
  });
});
