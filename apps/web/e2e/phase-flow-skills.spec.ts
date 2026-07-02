import { expect, test } from "@playwright/test";

// E2E for Flow Skills — uploading a SKILL.md to the library and attaching it to a
// conversational step (PRD: flow-skills-and-mcp, ADR-031).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — it is
// excluded from the vitest unit run. Assumes an authenticated admin storageState
// (the same global setup the other admin specs rely on).

const SKILL_MD = `---
name: E2E Contract Reviewer
description: Flags unusual contract clauses
---

# Contract review

Read the contract and flag unusual indemnity clauses.`;

test.describe("flow skills", () => {
  test("an admin can upload a SKILL.md and see it in the library", async ({ page }) => {
    await page.goto("/admin/skills");

    await page.getByLabel("SKILL.md").fill(SKILL_MD);
    await page.getByRole("button", { name: /upload skill/i }).click();

    // The parsed name appears in the library table.
    await expect(page.getByText("E2E Contract Reviewer")).toBeVisible();
    await expect(page.getByText("Flags unusual contract clauses")).toBeVisible();
  });

  test("an invalid SKILL.md surfaces a validation error and stores nothing", async ({ page }) => {
    await page.goto("/admin/skills");

    // Frontmatter with no name and no heading cannot be parsed into a skill.
    await page.getByLabel("SKILL.md").fill("---\ndescription: no name\n---\n");
    await page.getByRole("button", { name: /upload skill/i }).click();

    await expect(page.getByText(/must declare a name/i)).toBeVisible();
  });

  test("an uploaded skill can be archived from the library", async ({ page }) => {
    await page.goto("/admin/skills");

    const row = page.getByRole("row", { name: /E2E Contract Reviewer/i }).first();
    await row.getByRole("button", { name: /archive/i }).click();

    await expect(row.getByRole("button", { name: /restore/i })).toBeVisible();
  });
});
