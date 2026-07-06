/**
 * phase-code-quality-hot-paths-group-d.spec.ts
 *
 * Covers Group D (frontend decomposition) of the code-quality phase
 * (docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md).
 *
 * Item 9: the 2,183-line admin settings page was split into one file per
 * settings section under components/settings/, with the shared connectivity
 * hook/badge/test extracted alongside. The decomposition is meant to be
 * byte-for-byte behaviour, so the risk it introduces is a *dropped* card. This
 * spec loads /admin/settings and asserts every extracted section still renders
 * (the AI section anchor, the header "Test all" button, and each of the six
 * connectivity cards' own test button) with no console errors.
 */

import { test, expect } from './helpers/base';

// The six connectivity-bearing cards, each rendering a ConnectivityTest with a
// `test-connectivity-<target>` button — one per extracted card file.
const CONNECTIVITY_TARGETS = ['ai', 'n8n', 'embeddings', 'storage', 'email', 'entra'] as const;

test.describe('Code quality Group D: settings page decomposition', () => {
  test('every extracted settings section still renders', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // AI section anchor (rendered by the page shell between the extracted cards).
    await expect(page.getByTestId('settings-section-ai')).toBeVisible();
    // Header control that fans out to every connectivity card.
    await expect(page.getByTestId('test-all-connectivity')).toBeVisible();

    // Each connectivity card contributes its own test button; all six must be
    // present, proving no card was dropped in the split.
    for (const target of CONNECTIVITY_TARGETS) {
      await expect(page.getByTestId(`test-connectivity-${target}`)).toBeVisible();
    }

    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(
      errors,
      `JS errors on /admin/settings:\n${errors.map((entry) => entry.text).join('\n')}`,
    ).toHaveLength(0);
  });
});
