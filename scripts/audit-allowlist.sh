#!/usr/bin/env bash
# audit-allowlist.sh — advisories exempt from every lockfile CVE gate.
#
# Sourced by scripts/audit-check.sh (pnpm audit), scripts/osv-check.sh
# (OSV-Scanner) and .github/workflows/dependency-review.yml, so the lockfile
# gates can never disagree on what is waived.
#
# GitHub advisory IDs that do NOT fail the build. Every entry must state what it
# is, why it cannot be fixed, and the condition that removes it again. Keep this
# list as short as it can possibly be — an entry here is a security gate held
# open, and anything not listed still fails.
#
# History: GHSA-mh99-v99m-4gvg (brace-expansion DoS) was waived here because the
# advisory patched only >=5.0.8 and brace-expansion@5 exports an object rather
# than the callable minimatch@3 requires, so the 1.x chain under eslint had
# nowhere to go. Upstream has since backported to 1.1.17 and 2.1.3, which is the
# stated REMOVE WHEN condition, so the pins in the root package.json now carry
# every line to a patched release and the gate is closed again.
#
# GHSA-vfj7-8cjw-p6xm — braces stack-exhaustion DoS on deeply nested patterns.
#   WHY: no patched release exists (advisory lists none; 3.0.3 is the latest),
#   and micromatch@4.0.8 / fast-glob@3.3.3 — its only consumers — are also at
#   their latest. It reaches us solely through build and dev tooling
#   (tailwindcss, eslint-config-next, @changesets/cli), which expand globs the
#   repository itself writes, never user input; no runtime code imports it.
#   REMOVE WHEN: braces (or micromatch moving off it) publishes a patched
#   release — then pin it in the root package.json overrides instead.
# shellcheck disable=SC2034 # read by the scripts that source this file
ALLOWED_ADVISORIES=(
  "GHSA-vfj7-8cjw-p6xm"
)
