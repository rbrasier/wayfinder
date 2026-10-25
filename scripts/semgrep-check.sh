#!/usr/bin/env bash
# semgrep-check.sh — Semgrep static security scan, shared by validate.sh and CI.
#
# Replaces semgrep/semgrep-action@v1. That action ran Semgrep 1.36, which cannot
# parse the LOW/MEDIUM/HIGH/CRITICAL severities the registry packs now carry: it
# crashed loading the rules and the action still reported success, so the scan
# silently did not run. Here the exit code is the scanner's own, and a scan that
# did not complete is never read as a clean one.
#
# A false positive is waived inline with `// nosemgrep: <rule-id> — <reason>` on
# the flagged line, so the waiver sits next to the code it excuses.
#
# Exit codes: 0 = clean (or scanner unavailable outside CI),
#             1 = at least one finding, or scanner unavailable in CI.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

RULE_PACKS=(p/typescript p/owasp-top-ten)

# Locally a missing scanner or unreachable registry is a skip, matching the OSV
# gate. In CI this is the condition that went unnoticed, so it is an error.
unavailable() {
  if [ -n "${CI:-}" ]; then
    echo "Semgrep unavailable in CI: $1"
    exit 1
  fi
  echo "SKIP — $1; Semgrep scan not run."
  exit 0
}

if ! command -v semgrep > /dev/null 2>&1; then
  unavailable "semgrep is not installed (https://semgrep.dev/docs/getting-started/cli)"
fi

CONFIG_ARGS=()
for pack in "${RULE_PACKS[@]}"; do
  CONFIG_ARGS+=(--config "$pack")
done

semgrep scan ${CONFIG_ARGS[@]+"${CONFIG_ARGS[@]}"} --error --metrics=off --disable-version-check
SEMGREP_STATUS=$?

if [ "$SEMGREP_STATUS" -eq 0 ]; then
  echo "No Semgrep findings."
  exit 0
fi

# With --error, 1 means "findings reported"; every other code is the scanner
# failing — a rule it cannot parse, a registry it cannot reach, a crash.
if [ "$SEMGREP_STATUS" -ne 1 ]; then
  unavailable "semgrep exited $SEMGREP_STATUS (rule download, rule parsing or the scan itself failed)"
fi

echo "Semgrep reported findings — fix them, or waive a false positive inline with a nosemgrep comment and its reason."
exit 1
