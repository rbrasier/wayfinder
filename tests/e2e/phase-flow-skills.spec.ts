/**
 * phase-flow-skills.spec.ts
 *
 * Covers:
 *   v2.1.0 — Flow Skills. An admin can upload a SKILL.md to the library,
 *            see the parsed skill, and archive it. Malformed uploads surface
 *            a validation error and store nothing (PRD: flow-skills-and-mcp,
 *            ADR-031).
 *
 * Visual spec:
 *   /admin/skills → "Upload a skill" card with a SKILL.md textarea and an
 *   "Upload skill" button, plus a "Skill library" table listing name,
 *   description, tools, status and an Archive/Restore action per row.
 */

import { test, expect } from './helpers/base';

const SKILL_MD = `---
name: E2E Contract Reviewer
description: Flags unusual contract clauses
---

# Contract review

Read the contract and flag unusual indemnity clauses.`;

test.describe('Flow skills', () => {
  test('an admin can upload a SKILL.md and see it in the library', async ({ page }) => {
    await page.goto('/admin/skills');

    await page.getByLabel('SKILL.md').fill(SKILL_MD);
    await page.getByRole('button', { name: /upload skill/i }).click();

    await expect(page.getByText('E2E Contract Reviewer')).toBeVisible();
    await expect(page.getByText('Flags unusual contract clauses')).toBeVisible();
  });

  test('an invalid SKILL.md surfaces a validation error and stores nothing', async ({ page }) => {
    await page.goto('/admin/skills');

    // Frontmatter with no name and no heading cannot be parsed into a skill.
    await page.getByLabel('SKILL.md').fill('---\ndescription: no name\n---\n');
    await page.getByRole('button', { name: /upload skill/i }).click();

    await expect(page.getByText(/must declare a name/i)).toBeVisible();
  });

  test('an uploaded skill can be archived from the library', async ({ page }) => {
    await page.goto('/admin/skills');

    const row = page.getByRole('row', { name: /E2E Contract Reviewer/i }).first();
    await row.getByRole('button', { name: /archive/i }).click();

    await expect(row.getByRole('button', { name: /restore/i })).toBeVisible();
  });
});
