# Security scanning

Wayfinder checks for known vulnerabilities (CVEs) in six places, and scans its
own source for insecure patterns in a seventh (Semgrep). Each one answers a
different question, so a finding one misses another can catch.

| Check | Where | Looks at | Blocks on |
|---|---|---|---|
| `pnpm audit` | CI `security` job, `validate.sh` §11 — `scripts/audit-check.sh` | `pnpm-lock.yaml`, npm's advisory database | HIGH / CRITICAL (GitHub label) |
| OSV-Scanner | CI `security` job, `validate.sh` §11b — `scripts/osv-check.sh` | Every lockfile git tracks, the OSV database | HIGH / CRITICAL (GitHub label; CVSS ≥ 7.0 when unlabelled) |
| `npm audit` | CI `deploy-lambda` job — `npm run audit` in `deploy/lambda` | `deploy/lambda/package-lock.json`, npm's advisory database | HIGH / CRITICAL |
| Semgrep | CI `security` job, `validate.sh` §11c — `scripts/semgrep-check.sh` | The source, with the `p/typescript` and `p/owasp-top-ten` rule packs | Any finding |
| Trivy | CI `docker-image` job, `publish.yml` before the push | The built container image — Debian packages, the Node runtime, everything in `node_modules` | Fixable HIGH / CRITICAL |
| Dependency review | `dependency-review.yml` on every PR | Only the dependencies the PR adds or changes | HIGH / CRITICAL |
| Dependabot | GitHub, continuously | `pnpm-lock.yaml`, against GitHub's advisory database | Nothing — opens security-fix PRs against `main` |

Moderate and low advisories never block. They still show in each tool's output.

## Why more than one lockfile check

`pnpm audit` uses npm's audit endpoint, which npm has been retiring. When it is
unreachable, `audit-check.sh` skips rather than fail the build. OSV-Scanner uses
an independent database and **never skips in CI**: an unreachable database fails
the job. That way an outage cannot quietly mean "no CVE check ran". Locally,
§11b skips if `osv-scanner` is not installed —
[install it](https://google.github.io/osv-scanner/installation/) to run it.

## Semgrep fails closed

Semgrep scans the source with the `p/typescript` and `p/owasp-top-ten` registry
packs and blocks on any finding. CI installs a pinned CLI and runs
`scripts/semgrep-check.sh`. It used to run `semgrep/semgrep-action@v1`, whose
Semgrep 1.36 crashed loading the current packs (`invalid rule severity value:
MEDIUM`) while the step still reported success, so the scan silently did not
run. The script treats any exit other than "clean" or "findings" as the scanner
failing, and in CI that fails the job. Locally, §11c skips when `semgrep` is not
installed or the registry is unreachable.

## Lockfiles outside the workspace

`deploy/lambda` (ADR-056 §2) and `apps/web/e2e` each resolve their own
dependencies with npm, outside the pnpm workspace, so `pnpm audit` cannot see
their lockfiles. OSV-Scanner is the gate that covers them: `osv-check.sh` scans
every lockfile git tracks, and prints each one it scanned — OSV reports nothing
for a clean lockfile, which would otherwise read the same as one never scanned.
Each finding names the lockfile it came from. `deploy/lambda` also has its own
`npm audit` in the CI job that installs it, on the same HIGH / CRITICAL bar,
which waives nothing. A vulnerable transitive is fixed with an `overrides`
entry in that directory's `package.json`, as the e2e one does for `wait-on`'s
`axios`, `form-data` and `joi`. Dependabot does not cover these lockfiles.

## Waiving a finding

A waiver holds a security gate open, so every waiver carries **what it is, why it
cannot be fixed, and the condition that removes it**.

- **Lockfile** (`pnpm audit`, OSV-Scanner, dependency review):
  `scripts/audit-allowlist.sh`. One list, read by all three, so they can never
  disagree. Use the GHSA ID; OSV findings match on any alias.
- **Source** (Semgrep): an inline `// nosemgrep: <rule-id> — <reason>` comment
  on the flagged line, so the waiver sits next to the code it excuses.
- **Image** (Trivy): `.trivyignore`. Unfixed CVEs need no entry — the gate
  already ignores what has no fix to upgrade to.

## The image gate and the base image

The runtime stage of the `Dockerfile` runs `apt-get upgrade` and removes the npm
CLI that ships in `node:20-bookworm-slim`. The upstream image lags Debian's
security fixes, and nothing in Wayfinder runs npm (the entrypoint uses pnpm). CI
passes the date as the `SECURITY_REFRESH` build arg, so that layer is rebuilt at
least once a day and a cached upgrade never outlives Debian's next fix. The
upgrade step uses `apt-get update --error-on=any`: if the Debian mirrors are
unreachable the build fails, rather than quietly shipping without the upgrade.

## SBOM

Every publish generates a CycloneDX SBOM of the image
(`wayfinder-<version>.cdx.json`). It is attached to the GitHub Release and kept
on the workflow run. The pushed image also carries BuildKit's SBOM as an
attestation, readable with
`docker buildx imagetools inspect ghcr.io/rbrasier/wayfinder:<version> --format '{{ json .SBOM }}'`.
