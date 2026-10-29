#!/usr/bin/env bash
# audit-allowlist.sh — advisories exempt from every lockfile CVE gate.
#
# Sourced by scripts/audit-check.sh (pnpm audit), scripts/osv-check.sh
# (OSV-Scanner) and .github/workflows/dependency-review.yml, so the lockfile
# gates can never disagree on what is waived.
#
# GitHub advisory IDs that do NOT fail the build. Every entry must state what it
# is, why it cannot be fixed, and the condition that removes it again.
# scripts/waiver-check.mjs holds every entry to that condition: CI and a weekly
# review fail as soon as a fix is reachable within the release line already in
# use (the major, or the minor below 1.0), or the advisory no longer applies,
# naming the upgrade to take. Keep this
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
# GHSA-mrhx-c7xc-m3w5 (zod memory exhaustion) was waived while ai@4, the
# @ai-sdk 1.x providers and LangChain 0.3 held zod 3, which has no fix. The zod 4
# / AI SDK 5 / LangChain 1.x migration (v0.28.49) left no zod below 4.6.6, its
# stated REMOVE WHEN, so the waiver is gone.
#
# GHSA-vfj7-8cjw-p6xm — braces stack-exhaustion DoS on deeply nested patterns.
#   WHY: no patched release exists (advisory lists none; 3.0.3 is the latest),
#   and micromatch@4.0.8 / fast-glob@3.3.x — its only consumers — are also at
#   their latest. It reaches us solely through lint and release tooling:
#   eslint-config-next (@next/eslint-plugin-next's fast-glob, and the
#   @typescript-eslint v7 parser it pins) and @changesets/cli. Tailwind used
#   to be a third path; the move to Tailwind 4 removed it. All of them expand
#   globs the repository itself writes, never user input; no runtime code
#   imports it.
#   REMOVE WHEN: braces (or micromatch moving off it) publishes a patched
#   release — then pin it in the root package.json overrides instead — or
#   both eslint-config-next and @changesets/cli stop depending on micromatch@4.
#
# GHSA-qr28-fpjm-wq7f (CVE-2026-118664) — decode-uri-component denial of service
#   via quadratic decoding of crafted percent-encoded input. Also waived in
#   .trivyignore under its CVE id.
#   WHY: patched only in 0.5.1, a new release line that is ESM-only, while the
#   sole consumer, query-string@7, loads it with require(). query-string@7 comes
#   from minio@8.0.7, minio's latest, which pins query-string ^7. minio only ever
#   calls query-string's stringify(), never parse(), so the vulnerable decoder
#   is not reached; nothing else in the lockfile depends on it.
#   REMOVE WHEN: minio drops query-string@7 (or decode-uri-component publishes a
#   fix on the 0.2 line) — then take that upgrade instead.
# shellcheck disable=SC2034 # read by the scripts that source this file
ALLOWED_ADVISORIES=(
  "GHSA-vfj7-8cjw-p6xm"
  "GHSA-qr28-fpjm-wq7f"
)
