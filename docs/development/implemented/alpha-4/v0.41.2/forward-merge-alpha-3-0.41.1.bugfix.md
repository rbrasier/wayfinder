# Forward merge — `release/alpha-3` v0.41.1 into `main` (v0.41.2)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md). Shipped as a
patch bump (0.41.1 → 0.41.2) so the merge-back is traceable like any bugfix.

## What came across

One fix since the last merge, v0.41.1 (full record:
[`implemented/alpha-3/v0.41.1/dependabot-minimatch-decode-uri.bugfix.md`](../../alpha-3/v0.41.1/dependabot-minimatch-decode-uri.bugfix.md)):

- Overrides for the `decode-uri-component` and `minimatch` DoS advisories, with a
  `pnpm patch` of `query-string@7` (`patches/query-string@7.1.3.patch`).
- Lambda lockfile updated for `minimatch`.
- `Dockerfile` ships `patches/` in the image; `.trivyignore` and
  `scripts/audit-allowlist.sh` waivers retired; new `scripts/lockfile-advisories.test.mjs`
  and a `validate.sh` check.

## Deliberately not taken from alpha-3

The release branch's pointer changes (`CLAUDE.md`, `CONTRIBUTING.md`,
`AGENTS.md`, `README.md`, `docs/guides/*`, `.github/dependabot.yml`, daily-triage
skill docs) describe alpha-3 as current. `main` already carries the alpha-4
pointers, so the merge kept `main`'s versions; git resolved this without conflicts.

## Version

0.41.1 → **0.41.2** (patch; no schema impact). `VERSION` and `package.json` match.
