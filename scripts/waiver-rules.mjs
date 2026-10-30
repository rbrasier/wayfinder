// waiver-rules.mjs — the pure rules behind scripts/waiver-check.mjs.
//
// A waiver (scripts/audit-allowlist.sh, .trivyignore) holds a security gate open
// because a fix cannot be taken today. These rules decide, from the advisory's
// live fix data and the lockfile, whether that is still true — so a waiver ends
// the moment a fix becomes reachable, instead of outliving its reason.

const versionParts = (version) =>
  version
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);

export const compareVersions = (first, second) => {
  const left = versionParts(first);
  const right = versionParts(second);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

// Below 1.0 semver gives each minor its own breaking line (`^0.2.2` never
// reaches 0.3), so 0.2 → 0.5 is as much a breaking upgrade as 3 → 4.
const releaseLineOf = (version) => {
  const [major, minor] = versionParts(version);
  return major === 0 ? `0.${minor ?? 0}` : `${major}`;
};

const isWithin = (version, range) =>
  compareVersions(version, range.introduced) >= 0 && (!range.fixed || compareVersions(version, range.fixed) < 0);

// `ranges`: the advisory's affected npm ranges, { packageName, introduced, fixed }
// (fixed is null while no fix exists). `resolved`: package name → every version
// the lockfile resolves. Returns "needed" (no reachable fix), "fixable" (upgrade
// within the release line already in use, then drop the waiver) or "stale" (nothing
// vulnerable is left; drop the waiver). A fix on a later line only is not
// reachable: taking it is the breaking change the waiver exists to defer.
export const assessWaiver = ({ ranges, resolved }) => {
  const upgrades = [];
  let anyVulnerable = false;
  const packageNames = [...new Set(ranges.map((range) => range.packageName))];
  for (const packageName of packageNames) {
    const packageRanges = ranges.filter((range) => range.packageName === packageName);
    for (const version of resolved[packageName] ?? []) {
      const affecting = packageRanges.filter((range) => isWithin(version, range));
      if (affecting.length === 0) continue;
      anyVulnerable = true;
      const fix = affecting
        .map((range) => range.fixed)
        .filter((fixed) => fixed && releaseLineOf(fixed) === releaseLineOf(version))
        .sort(compareVersions)[0];
      if (fix) upgrades.push({ packageName, from: version, to: fix });
    }
  }
  if (!anyVulnerable) return { status: "stale", upgrades: [] };
  return upgrades.length > 0 ? { status: "fixable", upgrades } : { status: "needed", upgrades: [] };
};

export const parseAllowedAdvisories = (allowlistScript) => {
  const block = allowlistScript.match(/ALLOWED_ADVISORIES=\(([\s\S]*?)\)/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};

export const parseTrivyIgnoreIds = (trivyIgnore) =>
  trivyIgnore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

// Only the `packages:` section names each resolved version once; `snapshots:`
// repeats them with peer suffixes.
export const parseLockfileVersions = (lockfile) => {
  const section = lockfile.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const resolved = {};
  for (const match of section.matchAll(/^ {2}'?((?:@[^@\s'/]+\/)?[^@\s']+)@([0-9][^:'(\s]*)'?:/gm)) {
    const [, name, version] = match;
    (resolved[name] ??= []).push(version);
  }
  return resolved;
};

// The image gate (.trivyignore, keyed by CVE) may only waive an advisory the
// lockfile gates also waive, so removing that waiver retires both.
export const unlinkedTrivyIds = (trivyIds, advisories) => {
  const covered = new Set(advisories.flatMap((advisory) => [advisory.ghsaId, advisory.cveId].filter(Boolean)));
  return trivyIds.filter((id) => !covered.has(id));
};

// An OSV record (https://ossf.github.io/osv-schema/) as the rules read it: each
// npm package's affected ranges, and the CVE the image gate knows it by. A
// range's events run introduced → fixed; an introduced with no fixed after it is
// open-ended.
export const waiverAdvisoryFromOsv = (record) => {
  const ranges = [];
  for (const affected of record.affected ?? []) {
    if (affected.package?.ecosystem !== "npm") continue;
    const packageName = affected.package.name;
    for (const range of affected.ranges ?? []) {
      let introduced = null;
      for (const event of range.events ?? []) {
        if (event.introduced !== undefined) {
          if (introduced !== null) ranges.push({ packageName, introduced, fixed: null });
          introduced = event.introduced;
        }
        if (event.fixed !== undefined && introduced !== null) {
          ranges.push({ packageName, introduced, fixed: event.fixed });
          introduced = null;
        }
      }
      if (introduced !== null) ranges.push({ packageName, introduced, fixed: null });
    }
  }
  return {
    ghsaId: record.id,
    cveId: (record.aliases ?? []).find((alias) => alias.startsWith("CVE-")) ?? null,
    ranges,
  };
};
