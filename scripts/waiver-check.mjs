#!/usr/bin/env node
// waiver-check.mjs — fails while a security waiver has outlived its reason.
//
// Every advisory waived in scripts/audit-allowlist.sh is looked up in OSV (the
// database the OSV-Scanner gate already uses) and checked against the lockfile:
//   - a fix now reachable within the release line already in use (the major, or
//     the minor below 1.0) → fail, naming the upgrade: take it and remove the
//     waiver;
//   - nothing in the lockfile is vulnerable any more → fail: remove the waiver;
//   - otherwise the waiver still stands.
// .trivyignore may only waive an advisory the allowlist waives (by GHSA or CVE),
// so the image gate's waiver retires with it.
//
// Runs in validate.sh and CI on every change, and weekly (waiver-review.yml) so a
// fix published upstream is noticed even when nothing is being changed here.
//
// Exit codes: 0 = every waiver still needed (or OSV unreachable without --strict),
//             1 = a waiver must go, or OSV unreachable with --strict.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessWaiver,
  parseAllowedAdvisories,
  parseLockfileVersions,
  parseTrivyIgnoreIds,
  unlinkedTrivyIds,
  waiverAdvisoryFromOsv,
} from "./waiver-rules.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

const read = (path) => readFileSync(join(ROOT, path), "utf8");

const fetchAdvisory = async (id) => {
  const response = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OSV answered ${response.status} for ${id}`);
  return waiverAdvisoryFromOsv(await response.json());
};

const allowedIds = parseAllowedAdvisories(read("scripts/audit-allowlist.sh"));
const trivyIds = parseTrivyIgnoreIds(read(".trivyignore"));
const resolved = parseLockfileVersions(read("pnpm-lock.yaml"));

let advisories;
try {
  advisories = await Promise.all(allowedIds.map(fetchAdvisory));
} catch (cause) {
  console.log(`SKIP — could not reach OSV to re-check the waivers (${cause.message}).`);
  process.exit(strict ? 1 : 0);
}

const problems = [];
for (const advisory of advisories) {
  const assessment = assessWaiver({ ranges: advisory.ranges, resolved });
  if (assessment.status === "needed") {
    console.log(`still needed: ${advisory.ghsaId} — no fix within the version line in use`);
    continue;
  }
  if (assessment.status === "stale") {
    problems.push(
      `${advisory.ghsaId} no longer applies to any resolved package — remove it from scripts/audit-allowlist.sh` +
        (advisory.cveId ? ` (and ${advisory.cveId} from .trivyignore, if listed)` : ""),
    );
    continue;
  }
  const steps = assessment.upgrades.map((upgrade) => `${upgrade.packageName} ${upgrade.from} → ${upgrade.to}`);
  problems.push(`${advisory.ghsaId} now has a fix within reach: update ${steps.join(", ")}, then remove the waiver`);
}

// OSV does not always list an alias on both records, so an id the GHSA records
// do not name is looked up itself before it counts as unlinked.
for (const id of unlinkedTrivyIds(trivyIds, advisories)) {
  const record = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { signal: AbortSignal.timeout(15_000) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const aliases = [record?.id, ...(record?.aliases ?? [])];
  if (aliases.some((alias) => allowedIds.includes(alias))) continue;
  problems.push(`${id} is waived in .trivyignore but not in scripts/audit-allowlist.sh — waive it in both or neither`);
}

if (problems.length > 0) {
  console.log("Security waivers to act on:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}

console.log("Every security waiver is still needed.");
