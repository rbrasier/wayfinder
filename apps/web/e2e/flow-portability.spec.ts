/**
 * flow-portability.spec.ts
 *
 * Covers v0.30.0 — Flow portability (export / import / duplicate).
 *
 * This is the *only* part of the feature that earns a browser: e2e policy
 * group 3, "file upload and download". The download stream and the file dialog
 * cross the browser boundary and cannot be asserted in-process. Everything else
 * — the manifest format, the ceilings, dependency resolution, the rewrite, the
 * publish gate — is covered at the layer that owns it:
 *   packages/domain/src/entities/flow-export-*.test.ts
 *   packages/adapters/src/flows/zip-flow-archive.test.ts
 *   packages/application/src/use-cases/flow/flow-portability.test.ts
 *   apps/web/src/app/api/flows/**\/route.test.ts
 *
 * The export tests depend on the seeded flows' template and context-document
 * objects actually existing in MinIO. They did not — the fixture files wrote
 * storage *paths* into node config and never wrote the objects, so export
 * returned NOT_FOUND. seedStorageObjects() now writes a placeholder at every
 * path any fixture file references.
 */

import { test, expect } from './helpers/base';
import { requireSeedFixtures } from './helpers/seed';

test.describe('Flow portability: export download', () => {
  test('the canvas Export control downloads a .zip named after the flow', async ({ page }) => {
    const { flowId } = requireSeedFixtures();

    await page.goto(`/flows/${flowId}/config`);
    await page.waitForLoadState('networkidle');

    const exportLink = page.getByRole('link', { name: 'Export' });
    await expect(exportLink).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportLink.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });

  test('the admin flow list offers an export download per row', async ({ page }) => {
    const { flowId } = requireSeedFixtures();

    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    // Targeted by href, not `.first()`: the admin list shows every seeded flow
    // and its order is not ours to rely on. Picking an arbitrary row made this
    // assert against whichever fixture happened to sort first.
    const exportLink = page.locator(`a[href="/api/flows/${flowId}/export"]`);
    await expect(exportLink).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportLink.click();
    const download = await downloadPromise;

    // A failed export still downloads — the browser saves the JSON error body
    // as `export.json`, named from the URL's last segment. Asserting the
    // extension is therefore asserting that the export actually succeeded.
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });
});

test.describe('Flow portability: import upload', () => {
  test('choosing an archive shows the inspection panel before anything is created', async ({ page }) => {
    // The archive itself is fabricated by the route mock: this spec is about the
    // file dialog and the panel it drives, not about zip parsing, which the
    // adapter tests cover against real bytes.
    await page.route('**/api/flows/import', async (route) => {
      const request = route.request();
      const body = request.postData() ?? '';

      if (body.includes('inspect')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            manifest: {
              formatVersion: 1,
              exportedAt: '2026-08-17T09:00:00.000Z',
              exportedFrom: { appVersion: '0.29.0' },
              snapshot: {
                flow: {
                  name: 'Imported Procurement Flow',
                  description: 'Came from staging.',
                  icon: null,
                  expertRole: null,
                  contextDocs: [],
                },
                nodes: [
                  { id: 'n1', type: 'conversational', name: 'Gather', colour: null, positionX: 0, positionY: 0, config: {} },
                  { id: 'n2', type: 'approval', name: 'Approve', colour: null, positionX: 0, positionY: 0, config: {} },
                ],
                edges: [],
              },
              dependencies: [],
              assets: [],
            },
            resolved: [],
            unresolved: [
              { kind: 'skill', sourceId: 's1', name: 'Procurement Policy', nodeIds: ['n1'] },
            ],
            assetCount: 0,
            warnings: [],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          flowId: '00000000-0000-0000-0000-0000000000ff',
          flowName: 'Imported Procurement Flow',
          unresolved: [],
          warnings: [],
        }),
      });
    });

    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Import Flow' }).click();

    const fileInput = page.getByLabel('Flow archive');
    await expect(fileInput).toBeVisible();

    await fileInput.setInputFiles({
      name: 'procurement-approval-2026-08-17.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('PK pretend archive'),
    });

    const panel = page.getByTestId('flow-import-inspection');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Imported Procurement Flow');
    await expect(page.getByTestId('inspection-node-count')).toHaveText('2');

    // The whole point of inspect-then-commit: the gap is stated before the
    // user agrees to anything.
    await expect(panel).toContainText('Procurement Policy');
    await expect(page.getByText(/cannot be published/i)).toBeVisible();
  });

  test('an unreadable archive is reported and no import is offered', async ({ page }) => {
    await page.route('**/api/flows/import', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The uploaded archive is not a readable zip file.' }),
      });
    });

    await page.goto('/admin/flows');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Import Flow' }).click();

    await page.getByLabel('Flow archive').setInputFiles({
      name: 'not-really.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('this is not a zip'),
    });

    await expect(page.getByRole('alert')).toContainText('not a readable zip file');
    await expect(page.getByTestId('confirm-flow-import')).toBeDisabled();
  });
});
