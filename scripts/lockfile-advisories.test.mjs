// Run with: node --test scripts/lockfile-advisories.test.mjs
//
// Regression guard for advisories fixed by an override instead of by a direct
// dependency bump. A lockfile regeneration that drops the override fails here.
// The advisory gates (pnpm audit, OSV) only block high/critical findings and can
// be skipped when their endpoints are unreachable, so they cannot do this job.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { compareVersions, parseLockfileVersions } from "./waiver-rules.mjs";

const rootDirectory = new URL("..", import.meta.url);

// minimatch below 7 has no globParts preprocessing, so GHSA-g3hv-75wg-m249 has
// nothing to amplify there, and eslint still needs minimatch 3's CommonJS default export.
const advisoryFloors = [
  { advisory: "GHSA-qr28-fpjm-wq7f", packageName: "decode-uri-component", from: "0.0.0", fixed: "0.5.1" },
  { advisory: "GHSA-g3hv-75wg-m249", packageName: "minimatch", from: "7.0.0", fixed: "11.0.1" },
  { advisory: "GHSA-3g3m-2fjr-6pw4", packageName: "glob", from: "9.0.0", fixed: "14.0.2" },
  { advisory: "GHSA-4m76-xfj5-7975", packageName: "hono", from: "0.0.0", fixed: "4.13.16" },
  { advisory: "GHSA-jpvv-r467-5p4w", packageName: "@hono/node-server", from: "2.0.0", fixed: "2.1.6" },
  { advisory: "GHSA-474x-hrwr-fgx4", packageName: "fast-xml-parser", from: "0.0.0", fixed: "5.12.0" },
];

const vulnerableVersions = (resolved) =>
  advisoryFloors.flatMap((floor) =>
    (resolved[floor.packageName] ?? [])
      .filter((version) => compareVersions(version, floor.from) >= 0 && compareVersions(version, floor.fixed) < 0)
      .map((version) => `${floor.packageName}@${version} (${floor.advisory}, fixed in ${floor.fixed})`),
  );

// Bundled copies (inBundle) are checked too: npm overrides cannot reach them, so
// the fix for one is a release of the bundling package, and this keeps that honest.
const npmLockfileVersions = (lockfile) => {
  const resolved = {};
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!path) continue;
    const packageName = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    (resolved[packageName] ??= []).push(entry.version);
  }
  return resolved;
};

describe("lockfile advisory floors", () => {
  it("pnpm-lock.yaml resolves no version below an advisory floor", () => {
    const lockfile = readFileSync(new URL("pnpm-lock.yaml", rootDirectory), "utf8");

    assert.deepEqual(vulnerableVersions(parseLockfileVersions(lockfile)), []);
  });

  it("deploy/lambda/package-lock.json resolves no version below an advisory floor, bundled copies included", () => {
    const lockfile = JSON.parse(readFileSync(new URL("deploy/lambda/package-lock.json", rootDirectory), "utf8"));

    assert.deepEqual(vulnerableVersions(npmLockfileVersions(lockfile)), []);
  });

  it("ignores minimatch lines that predate the vulnerable preprocessing", () => {
    assert.deepEqual(vulnerableVersions({ minimatch: ["3.1.5"] }), []);
  });
});
