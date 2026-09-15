/**
 * welcome-tour.spec.ts
 *
 * First-login welcome tour (ADR-056). Policy group 4 — navigation state across
 * a page load: the tour hands off between /chats, /flows and the configure
 * canvas through a URL stage, and each page must open the right thing on load.
 *
 * Runs as its own user so the shared admin session — which the test-session
 * endpoint marks as already toured — never meets the modal.
 */

import { test, expect } from './helpers/base';

const TOUR_EMAIL = 'welcome-tour@example.com';

// CI serves the app with `next dev` (.github/workflows/e2e.yml), so every route
// is compiled on its first request. This spec is the first to visit /flows, the
// flow config canvas — the heaviest route in the app — and /settings, so each of
// its hand-offs can pay a cold compile on top of a server render before the App
// Router changes the URL. That, not anything in the tour, is what made this spec
// flaky: the first attempt paid the compile and the retry found the route warm.
const NAV_TIMEOUT = 45_000;

// Three cold navigations and a mutation do not fit the 45s default from
// playwright.config.ts. Matches the allowance fix-entra-admin-recovery.spec.ts
// already makes for its own slow path.
const COLD_ROUTE_BUDGET = 120_000;

// `load` waits on every subresource and has timed out at 30s here under CI load.
// Each step after a navigation is a retrying assertion, so the document being
// parsed is a sufficient starting point — but anything that *clicks* must first
// wait for a client-rendered element, or it races hydration and the click is
// swallowed.
const untilDom = { waitUntil: 'domcontentloaded' } as const;

test.describe('Welcome tour', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, request }) => {
    const response = await request.post('/api/auth/test-session', {
      data: { email: TOUR_EMAIL, tour: 'pending' },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const { token } = await response.json();
    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  });

  test('walks a first-time user from the welcome modal to the flow explainer across two page loads', async ({
    page,
  }) => {
    test.setTimeout(COLD_ROUTE_BUDGET);
    await page.goto('/chats', untilDom);
    const welcome = page.getByTestId('welcome-tour');
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('heading', { name: 'Start a chat' })).toBeVisible();
    await expect(welcome.getByRole('heading', { name: 'Build a flow' })).toBeVisible();

    await welcome.getByRole('button', { name: /build a flow/i }).click();

    // First hand-off: the flows page opens the dialog and its callout on load.
    await expect(page).toHaveURL(/\/flows\?tour=new-flow$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('new-flow-step-callout')).toBeVisible();
    await expect(page.getByText('Step 1 of 2')).toBeVisible();
    await page.locator('#flow-name').fill('Tour leave request');
    await page.locator('#flow-expert-role').fill('HR advisor');
    await page.getByRole('button', { name: 'Create flow' }).click();

    // Second hand-off: the canvas opens the explainer on load.
    await expect(page).toHaveURL(/\/flows\/[^/]+\/config\?tour=flow-explainer$/, {
      timeout: NAV_TIMEOUT,
    });
    const explainer = page.getByTestId('flow-explainer');
    await expect(explainer).toBeVisible();
    await expect(
      explainer.getByRole('heading', { name: 'A flow is a guided conversation, not a form' }),
    ).toBeVisible();

    for (let card = 1; card < 6; card += 1) {
      await explainer.getByRole('button', { name: 'Next card' }).click();
    }
    await expect(explainer.getByRole('heading', { name: 'Publish it' })).toBeVisible();
    await expect(explainer.getByRole('button', { name: 'Next card' })).toBeDisabled();

    // The closing call to action hands off to the first-step button.
    await explainer.getByTestId('flow-explainer-finish').click();
    await expect(explainer).toBeHidden();
    await expect(page).toHaveURL(/\/flows\/[^/]+\/config$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('first-step-pointer')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /create your first step/i }),
    ).toBeVisible();

    // Choosing a path completed the tour: it does not come back on the next load.
    await page.goto('/chats', untilDom);
    // Anchor on the sidebar account button rather than the page heading: it
    // renders only once `user.me` has resolved, which is the same query the
    // gate reads. The heading is server-rendered, so asserting absence against
    // it could pass before the gate had the data to show anything.
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await expect(page.getByTestId('welcome-tour')).toHaveCount(0);
  });

  test('skipping the tour keeps it hidden after a reload, and Settings brings it back', async ({
    page,
  }) => {
    test.setTimeout(COLD_ROUTE_BUDGET);
    await page.goto('/chats', untilDom);
    const welcome = page.getByTestId('welcome-tour');
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: 'Skip for now' }).click();
    await expect(welcome).toBeHidden();

    await page.reload(untilDom);
    // Anchor on the sidebar account button rather than the page heading: it
    // renders only once `user.me` has resolved, which is the same query the
    // gate reads. The heading is server-rendered, so asserting absence against
    // it could pass before the gate had the data to show anything.
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await expect(page.getByTestId('welcome-tour')).toHaveCount(0);

    await page.goto('/settings', untilDom);
    // The restart button is server-rendered, so it is clickable before React
    // has hydrated — and a click that lands then is swallowed, with no handler
    // attached yet. The sidebar's account button comes from a client
    // `user.me` query, so waiting for it proves hydration has happened.
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Restart the welcome tour' }).click();
    await expect(page).toHaveURL(/\/chats$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId('welcome-tour')).toBeVisible();
  });

  // Regression: the gate once held a "dismissed here" flag in React state. It
  // lives in the (user) layout, which stays mounted across client-side
  // navigation, so the flag outlived the tour it closed and every restart after
  // the first silently showed nothing. Restarting twice without a reload is the
  // reproduction, so this spec never touches page.reload() between the rounds.
  test('restarts from Settings repeatedly within one page load', async ({ page }) => {
    test.setTimeout(COLD_ROUTE_BUDGET);
    await page.goto('/chats', untilDom);
    await expect(page.getByTestId('welcome-tour')).toBeVisible();

    for (let round = 0; round < 3; round += 1) {
      await page.getByTestId('welcome-tour').getByRole('button', { name: 'Skip for now' }).click();
      await expect(page.getByTestId('welcome-tour')).toBeHidden();

      // Client-side navigation on purpose: page.goto would reload the document
      // and remount the layout, which is exactly what used to mask this bug.
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await expect(page).toHaveURL(/\/settings$/, { timeout: NAV_TIMEOUT });
      await page.getByRole('button', { name: 'Restart the welcome tour' }).click();

      await expect(page).toHaveURL(/\/chats$/, { timeout: NAV_TIMEOUT });
      await expect(page.getByTestId('welcome-tour')).toBeVisible();
    }
  });
});
