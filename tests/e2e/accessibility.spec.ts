/**
 * accessibility.spec.ts
 *
 * Runtime WCAG 2.2 AA checks — the "visual" criteria that the static
 * jsx-a11y lint layer (apps/web/.eslintrc.a11y.cjs, validate.sh check 15)
 * cannot see because they only exist once the page is rendered in a browser:
 *
 *   - 1.4.3 Contrast (Minimum)         → axe-core color-contrast rule
 *   - 1.4.11 Non-text Contrast         → axe-core
 *   - 4.1.2 Name, Role, Value (computed) → axe-core
 *   - 2.5.8 Target Size (Minimum) (2.2) → axe-core target-size rule
 *   - 2.4.7 Focus Visible              → custom focus-indicator probe
 *   - 1.4.10 Reflow                    → custom 320px no-horizontal-scroll probe
 *
 * axe-core is the engine behind most automated a11y audits; it computes the
 * rendered accessibility tree and real colour values, so it catches contrast
 * and computed name/role issues a linter never can.
 *
 * Runs under the authenticated `chromium` project (see playwright.config.ts),
 * so every page below is reached with the seeded admin session.
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './helpers/base';
import type { Page } from '@playwright/test';

// WCAG 2.0/2.1/2.2 A + AA. Including the wcag22aa tag enables axe's
// target-size rule (2.5.8), which honours the standard's spacing/inline
// exceptions instead of naively measuring every element.
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Pages with no React Flow canvas — the third-party canvas renders SVG controls
// we do not own, so the editor route is audited with that subtree excluded.
const PAGES: { name: string; path: string }[] = [
  { name: 'admin flows list', path: '/admin/flows' },
  { name: 'admin roles', path: '/admin/roles' },
  { name: 'admin users', path: '/admin/users' },
  { name: 'admin settings', path: '/admin/settings' },
  { name: 'user settings', path: '/settings' },
  { name: 'approvals', path: '/approvals' },
];

async function runAxe(page: Page, excludeReactFlow = false) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA_TAGS);
  if (excludeReactFlow) builder = builder.exclude('.react-flow');
  return builder.analyze();
}

function formatViolations(violations: Awaited<ReturnType<typeof runAxe>>['violations']) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .slice(0, 5)
        .map((node) => `      • ${node.target.join(' ')}`)
        .join('\n');
      return `  [${violation.impact}] ${violation.id} — ${violation.help}\n${targets}\n    ${violation.helpUrl}`;
    })
    .join('\n\n');
}

test.describe('Accessibility: WCAG 2.2 AA runtime audit', () => {
  for (const { name, path } of PAGES) {
    test(`${name} has no axe violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await runAxe(page);
      await page.screenshot({ path: `screenshots/a11y-${path.replace(/\W+/g, '-')}.png`, fullPage: true });

      expect(
        results.violations,
        `axe found ${results.violations.length} WCAG 2.2 AA violation(s) on ${name} (${path}):\n\n${formatViolations(results.violations)}`,
      ).toEqual([]);
    });
  }

  test('flow editor canvas (excluding third-party React Flow) has no axe violations', async ({
    page,
  }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // Open the first flow in the list, if any, to reach the editor route.
    const firstFlow = page.getByRole('link', { name: /open|edit|flow/i }).first();
    const editButton = page.getByRole('button', { name: /open|edit/i }).first();
    if (await firstFlow.count()) {
      await firstFlow.click();
    } else if (await editButton.count()) {
      await editButton.click();
    } else {
      test.skip(true, 'No seeded flow to open');
      return;
    }
    await page.waitForLoadState('networkidle');

    const results = await runAxe(page, true);
    expect(
      results.violations,
      `axe found violations on the flow editor:\n\n${formatViolations(results.violations)}`,
    ).toEqual([]);
  });
});

test.describe('Accessibility: focus visible (2.4.7)', () => {
  test('keyboard focus produces a visible indicator', async ({ page }) => {
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // Tab onto the first interactive control and confirm the browser/Tailwind
    // renders a non-empty focus indicator (outline or ring/box-shadow). A
    // missing indicator (outline:none with no replacement) fails 2.4.7.
    await page.keyboard.press('Tab');

    const indicator = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return null;
      const style = getComputedStyle(active);
      const outlineWidth = parseFloat(style.outlineWidth) || 0;
      const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
      const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';
      const hasRing = style.getPropertyValue('--tw-ring-shadow').trim() !== '';
      return {
        tag: active.tagName,
        visible: hasOutline || hasBoxShadow || hasRing,
      };
    });

    expect(indicator, 'Tab did not move focus to any interactive element').not.toBeNull();
    expect(
      indicator?.visible,
      `Focused <${indicator?.tag}> has no visible focus indicator (outline/ring/box-shadow)`,
    ).toBe(true);
  });
});

test.describe('Accessibility: reflow at 320px (1.4.10)', () => {
  test('content reflows without horizontal scrolling', async ({ page }) => {
    // 320 CSS px is the WCAG 1.4.10 reflow target (≈ 1280px at 400% zoom).
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      // A few px of tolerance for sub-pixel rounding and scrollbar gutters.
      return doc.scrollWidth - doc.clientWidth;
    });
    await page.screenshot({ path: 'screenshots/a11y-reflow-320.png', fullPage: true });

    expect(
      overflow,
      `Page scrolls horizontally by ${overflow}px at 320px width (WCAG 1.4.10 Reflow)`,
    ).toBeLessThanOrEqual(2);
  });
});
