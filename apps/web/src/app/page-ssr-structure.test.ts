import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pages that own tRPC queries must be async server components.
// They must NOT carry "use client" — that belongs in _content.tsx.
const serverPages = [
  "(admin)/admin/flows/page.tsx",
  "(admin)/admin/users/page.tsx",
  "(admin)/admin/dashboards/overview/page.tsx",
  "(admin)/admin/dashboards/flows/page.tsx",
  "(user)/flows/[id]/config/page.tsx",
];

describe("page SSR structure", () => {
  for (const relativePath of serverPages) {
    it(`${relativePath} must not be a client component`, () => {
      const absolutePath = resolve(__dirname, relativePath);
      const content = readFileSync(absolutePath, "utf-8");
      expect(content.startsWith('"use client"')).toBe(false);
    });
  }
});
