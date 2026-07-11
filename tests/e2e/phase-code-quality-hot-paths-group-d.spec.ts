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
 * spec loads /admin/settings and asserts every extracted section's card title
 * still renders (each CardTitle is an <h3>, rendered unconditionally — unlike
 * the connectivity test buttons, some of which are gated on the section being
 * configured), plus the AI section anchor and header "Test all" button, with no
 * console errors.
 */

import { test, expect } from './helpers/base';

// One title per extracted card file — each an <h3> rendered unconditionally.
const CARD_TITLES = [
  'General',
  'User Registration',
  'Authentication',
  'Global AI Instructions',
  'AI Provider',
  'Document Generation',
  'n8n Integration',
  'RAG Embeddings',
  'Object Storage (S3 / MinIO)',
  'Session Uploads',
  'Email',
  'Notifications',
  'HR Directory Data',
  'Approver Directory (Microsoft Entra)',
];

test.describe('Code quality Group D: settings page decomposition', () => {
  test('every extracted settings section still renders', async ({ page, consoleLogs }) => {
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // AI section anchor (rendered by the page shell between the extracted cards).
    await expect(page.getByTestId('settings-section-ai')).toBeVisible();
    // Header control that fans out to every connectivity card.
    await expect(page.getByTestId('test-all-connectivity')).toBeVisible();

    // Each extracted card contributes its own <h3> title; all must be present,
    // proving no card was dropped in the split. Substring match tolerates any
    // inline status badge some card headers render alongside the title.
    for (const title of CARD_TITLES) {
      await expect(
        page.getByRole('heading', { level: 3, name: title }).first(),
      ).toBeVisible();
    }

    const errors = consoleLogs.filter((entry) => entry.type === 'error');
    expect(
      errors,
      `JS errors on /admin/settings:\n${errors.map((entry) => entry.text).join('\n')}`,
    ).toHaveLength(0);
  });
});
