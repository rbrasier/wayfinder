#!/usr/bin/env bash
# osv-check.sh — OSV-Scanner gate on every lockfile, shared by validate.sh and CI.
#
# A second, independent advisory source next to scripts/audit-check.sh: when the
# npm audit endpoint is down that gate skips, and this one is what still runs.
# It applies the same rule — fail on any high or critical advisory not waived in
# scripts/audit-allowlist.sh — so the two gates only differ in their database.
#
# Severity comes from the GitHub advisory label OSV carries, not from the CVSS
# score, because that label is what pnpm audit gates on; OSV's CVSS scores often
# rate the same advisory a band higher. The CVSS score (>= 7.0) is the fallback
# only for an advisory with no label.
#
# Exit codes: 0 = clean (or every finding allowlisted, or scanner unavailable
#                 outside CI),
#             1 = at least one blocking advisory, or scanner unavailable in CI.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# shellcheck source=scripts/audit-allowlist.sh
source "$ROOT/scripts/audit-allowlist.sh"

# Locally a missing scanner or network is a skip, matching the audit gate. In CI
# this is the check that must not fail open, so the same condition is an error.
unavailable() {
  if [ -n "${CI:-}" ]; then
    echo "OSV-Scanner unavailable in CI: $1"
    exit 1
  fi
  echo "SKIP — $1; OSV scan not run."
  exit 0
}

if ! command -v osv-scanner > /dev/null 2>&1; then
  unavailable "osv-scanner is not installed (https://google.github.io/osv-scanner/installation/)"
fi

# Every lockfile git tracks, not just the workspace's. apps/web/e2e resolves its
# own dependencies with npm outside the pnpm workspace, and went unscanned while
# this named pnpm-lock.yaml alone; listing them here means the next one is
# covered the day it lands. OSV reports nothing for a clean lockfile, which reads
# the same as one never scanned, so the list is printed.
LOCKFILE_ARGS=()
while IFS= read -r lockfile; do
  [ -n "$lockfile" ] || continue
  LOCKFILE_ARGS+=(--lockfile "$lockfile")
  echo "Scanning $lockfile"
done < <(git ls-files 2> /dev/null | grep -E '(^|/)(pnpm-lock\.yaml|package-lock\.json)$')

if [ "${#LOCKFILE_ARGS[@]}" -eq 0 ]; then
  echo "No lockfiles found to scan — run from a git checkout of the repository."
  exit 1
fi

# Offline mode downloads the npm advisory database as one archive rather than
# querying api.osv.dev per package, so it works behind proxies that allow plain
# HTTPS downloads but not the API.
OSV_JSON=$(osv-scanner scan source \
  ${LOCKFILE_ARGS[@]+"${LOCKFILE_ARGS[@]}"} \
  --offline-vulnerabilities \
  --download-offline-databases \
  --format json 2> /dev/null)
OSV_STATUS=$?

if [ "$OSV_STATUS" -eq 0 ]; then
  echo "No advisories found by OSV-Scanner."
  exit 0
fi

# Exit 1 means "vulnerabilities found"; anything else is the scanner failing.
if [ "$OSV_STATUS" -ne 1 ]; then
  unavailable "osv-scanner exited $OSV_STATUS (advisory database download or scan failed)"
fi

# Guarded expansion: the allowlist can be empty, and on bash 3.2 (macOS) expanding
# an empty array under `set -u` aborts the script rather than yielding nothing.
ALLOWED_CSV=$(IFS=,; echo "${ALLOWED_ADVISORIES[@]+${ALLOWED_ADVISORIES[*]}}")

REPORT=$(ALLOWED="$ALLOWED_CSV" ROOT="$ROOT" node -e '
const allowed = new Set((process.env.ALLOWED || "").split(",").filter(Boolean));

let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    console.log("UNPARSEABLE");
    process.exit(0);
  }

  const severityOf = (vulnerability, groups) => {
    const label = String(vulnerability.database_specific?.severity || "").toLowerCase();
    if (label) return label;
    const group = groups.find((candidate) => (candidate.ids || []).includes(vulnerability.id));
    return parseFloat(group?.max_severity || "0") >= 7 ? "high" : "unrated";
  };

  const root = process.env.ROOT + "/";
  const findings = (parsed.results || []).flatMap((result) => {
    const lockfile = String(result.source?.path || "").replace(root, "");
    return (result.packages || []).flatMap(({ package: pkg, vulnerabilities = [], groups = [] }) =>
      vulnerabilities.map((vulnerability) => ({ lockfile, pkg, vulnerability, severity: severityOf(vulnerability, groups) })),
    );
  });

  const lines = new Set();
  for (const { lockfile, pkg, vulnerability, severity } of findings) {
    if (!["high", "critical"].includes(severity)) continue;
    const ids = [vulnerability.id, ...(vulnerability.aliases || [])];
    const verdict = ids.some((id) => allowed.has(id)) ? "WAIVED" : "BLOCK";
    lines.add(`${verdict} ${severity} — ${lockfile}: ${pkg.name}@${pkg.version} — ${vulnerability.id} — ${vulnerability.summary || ""}`);
  }
  for (const line of lines) console.log(line);
});
' <<< "$OSV_JSON")

if echo "$REPORT" | grep -q "^UNPARSEABLE$"; then
  echo "Could not parse the OSV-Scanner output:"
  echo "$OSV_JSON" | head -50
  exit 1
fi

echo "$REPORT" | grep "^WAIVED " | sed 's/^WAIVED /allowlisted: /'

BLOCKING=$(echo "$REPORT" | grep "^BLOCK " | sed 's/^BLOCK //')
if [ -n "$BLOCKING" ]; then
  echo "Blocking advisories:"
  echo "$BLOCKING"
  exit 1
fi

echo "No blocking advisories (allowlisted findings above are exempt)."
exit 0
