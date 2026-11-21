// Run with: node --test scripts/e2e-playwright-platform.test.mjs
//
// Regression guard: the e2e workflow runs on `ubuntu-latest`, which is Ubuntu
// 26.04. Playwright below 1.62 ships no browser build for ubuntu26.04-x64, so
// `playwright install --with-deps` exits 1 and every e2e job dies before a spec runs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compareVersions } from "./waiver-rules.mjs";

const rootDirectory = new URL("..", import.meta.url);
const firstVersionSupportingUbuntu2604 = "1.62.0";

const resolvedPlaywrightCoreVersions = (lockfile) =>
  Object.entries(lockfile.packages ?? {})
    .filter(([path]) => path.endsWith("node_modules/playwright-core"))
    .map(([, entry]) => entry.version);

describe("e2e Playwright supports the CI runner OS", () => {
  it("apps/web/e2e/package-lock.json resolves playwright-core with Ubuntu 26.04 support", () => {
    const lockfile = JSON.parse(readFileSync(new URL("apps/web/e2e/package-lock.json", rootDirectory), "utf8"));
    const versions = resolvedPlaywrightCoreVersions(lockfile);

    assert.notEqual(versions.length, 0, "the e2e lockfile resolves no playwright-core");
    const unsupported = versions.filter((version) => compareVersions(version, firstVersionSupportingUbuntu2604) < 0);
    assert.deepEqual(unsupported, [], `playwright-core below ${firstVersionSupportingUbuntu2604} cannot install browsers on ubuntu26.04-x64`);
  });
});
