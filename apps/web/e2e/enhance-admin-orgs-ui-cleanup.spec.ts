import { test, expect } from "./helpers/base";

// E2E for the admin / organisations / groups UI cleanup (v2.10.0).
//
// Driven by the /e2e (Playwright MCP) skill against a running stack — excluded
// from the vitest unit run. Assumes a seeded admin session (the same auth
// bypass the other admin specs rely on).
//
// Covers the primary user-facing changes:
//   A. The admin sidebar — renamed + reordered groups (item 4).
//   B. The Configuration page — logically grouped collapsible sections (item 5)
//      with the organisations master toggle (item 1b).
//   C. Creating an organisation through a modal, not inline (item 1f).

test.describe("admin sidebar cleanup", () => {
  test("renames and reorders the admin navigation groups", async ({ page }) => {
    await page.goto("/admin/settings");

    // The "Users and Roles" group (renamed from "User Admin") is always present.
    await expect(page.getByText("Users and Roles", { exact: true })).toBeVisible();

    // The old group labels are gone ("Advanced Flow Settings" must not match the
    // old exact "Flow Settings").
    await expect(page.getByText("User Admin", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Flow Settings", { exact: true })).toHaveCount(0);

    // The main nav renames "Flows" to "All Flows".
    await expect(page.getByRole("link", { name: "All Flows" })).toBeVisible();
  });
});

test.describe("configuration page", () => {
  test("groups settings into collapsible sections with the organisations toggle", async ({
    page,
  }) => {
    await page.goto("/admin/settings");

    await expect(page.getByRole("heading", { name: "Configuration" })).toBeVisible();

    // Section headers are present.
    for (const section of ["General", "AI", "Integrations", "Storage & uploads"]) {
      await expect(page.getByRole("button", { name: new RegExp(section, "i") })).toBeVisible();
    }

    // The organisations master toggle lives in General and is off by default.
    const toggle = page.getByRole("switch", { name: /enable organisations/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

test.describe("organisations admin", () => {
  test("creates an organisation through a modal", async ({ page }) => {
    // The Organisations surface is reachable directly; enabling the feature is
    // not required to administer it.
    await page.goto("/admin/organisations");

    await page.getByRole("button", { name: /new organisation/i }).click();

    // The create form is a modal (dialog), not an inline header field.
    const dialog = page.getByRole("dialog");
    const name = `E2E Acme ${Date.now()}`;
    await dialog.getByLabel(/^name$/i).fill(name);
    await dialog.getByLabel(/email domain/i).fill("acme.example");
    await dialog.getByRole("button", { name: /create organisation/i }).click();

    // The new organisation appears as an editable row (its rename field carries
    // the name as an input value, not page text).
    await expect(page.getByLabel(new RegExp(`rename ${name}`, "i"))).toBeVisible();
  });
});
