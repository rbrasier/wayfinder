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

// minimatch below 8 has no globParts preprocessing, so GHSA-g3hv-75wg-m249 has
// nothing to amplify there, and eslint still needs minimatch 3's CommonJS default export.
const advisoryFloors = [
  { advisory: "GHSA-qr28-fpjm-wq7f", packageName: "decode-uri-component", from: "0.0.0", fixed: "0.5.1" },
  { advisory: "GHSA-g3hv-75wg-m249", packageName: "minimatch", from: "8.0.0", fixed: "11.0.1" },
];

const vulnerableVersions = (resolved) =>
  advisoryFloors.flatMap((floor) =>
    (resolved[floor.packageName] ?? [])
      .filter((version) => compareVersions(version, floor.from) >= 0 && compareVersions(version, floor.fixed) < 0)
      .map((version) => `${floor.packageName}@${version} (${floor.advisory}, fixed in ${floor.fixed})`),
  );

// glob 9 silently matches nothing on minimatch 11, so its copy cannot be
// overridden; it only runs at build time (@node-minify via @opennextjs/aws), on
// patterns from the build config rather than from user input.
const unoverridablePaths = new Set(["node_modules/glob/node_modules/minimatch"]);

// Copies shipped inside another package's tarball (inBundle) are out of reach of
// npm overrides, so they are left to the bundling package's next release.
const npmLockfileVersions = (lockfile) => {
  const resolved = {};
  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!path || entry.inBundle || unoverridablePaths.has(path)) continue;
    const packageName = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    (resolved[packageName] ??= []).push(entry.version);
  }
  return resolved;
};

describe("lockfile advisory floors", () => {
  it("pnpm-lock.yaml resolves no vulnerable decode-uri-component or minimatch", () => {
    const lockfile = readFileSync(new URL("pnpm-lock.yaml", rootDirectory), "utf8");

    assert.deepEqual(vulnerableVersions(parseLockfileVersions(lockfile)), []);
  });

  it("deploy/lambda/package-lock.json resolves no vulnerable minimatch outside bundled copies", () => {
    const lockfile = JSON.parse(readFileSync(new URL("deploy/lambda/package-lock.json", rootDirectory), "utf8"));

    assert.deepEqual(vulnerableVersions(npmLockfileVersions(lockfile)), []);
  });

  it("ignores minimatch lines that predate the vulnerable preprocessing", () => {
    assert.deepEqual(vulnerableVersions({ minimatch: ["3.1.5"] }), []);
  });
});
