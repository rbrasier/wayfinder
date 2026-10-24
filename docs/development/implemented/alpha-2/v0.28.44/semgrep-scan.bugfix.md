# Bug fix — the Semgrep scan crashes on startup and CI reports it green

Source: reported by the maintainer. No issue.
Severity: major — the static security scan has not been running, and nothing said so.

## Symptom

The `Static security scan (Semgrep)` step of the CI `security` job ends, on every run, with:

```
File ".../semgrep/constants.py", line 61, in _missing_
  raise ValueError(f"invalid rule severity value: {value}")
ValueError: invalid rule severity value: MEDIUM
```

and the step, and the job, conclude `success` (verified on `release/alpha-2`, CI run
40089298254, job 120858505820).

## Root cause

- The step used `semgrep/semgrep-action@v1`, a deprecated action that pulls the
  `returntocorp/semgrep-agent:v1` image — Semgrep 1.36.
- The registry packs `p/typescript` and `p/owasp-top-ten` now label rules with the
  `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` severities. Semgrep 1.36 only knows
  `INFO` / `WARNING` / `ERROR`, so it raises while loading the rules — before scanning a file.
- The action's wrapper does not pass that crash through as a failing exit code, so the
  step goes green. A scanner that never ran is indistinguishable from a clean scan.

## Reproduction

Open the `Security scan` job of any CI run and expand the Semgrep step: the traceback
above, then a green tick. (Not reproducible in the sandbox — its network policy blocks
`semgrep.dev`, where the packs are downloaded.)

## Fix plan

- `scripts/semgrep-check.sh`, shaped like `scripts/osv-check.sh`: runs
  `semgrep scan --error` against the two packs and maps the exit code — 0 clean,
  1 findings (fail), anything else the scanner failing. In CI a failing or missing
  scanner fails the job; locally it is a SKIP, the same contract as the OSV gate.
- `ci.yml`: drop the action; install the pinned CLI (`semgrep==1.182.1`) from PyPI and
  run the script.
- `validate.sh` §11d runs the same script with `CI` cleared.
- Findings the newly working scan reports are triaged in this PR: real ones fixed,
  false positives waived inline with `nosemgrep: <rule-id>` and a reason.

## Regression guard

`packages/adapters/src/ci/semgrep-check.test.ts` runs the script against a stub
`semgrep` on `PATH` that reproduces the crash (exit 2, the `MEDIUM` traceback) and
asserts the CI run fails; it also covers findings, clean, missing-binary (CI and local),
and that `ci.yml` runs the script rather than the action.

**E2E:** none — CI tooling falls in no group of `e2e-test-policy.md`.

## Implementation summary — v0.28.44

- **Root cause:** `semgrep/semgrep-action@v1` runs Semgrep 1.36, which raises
  `invalid rule severity value: MEDIUM` loading the current packs; the action exits 0 anyway.
- **Fix applied:** new `scripts/semgrep-check.sh` (exit 0 clean, 1 findings, anything else
  = scanner failed → fail in CI, SKIP locally); `ci.yml` installs `semgrep==1.182.1` with
  pipx and runs the script; `validate.sh` §11d; `docs/guides/security-scanning.md` updated.
  Exit codes and the `MEDIUM` severity verified against the real 1.182.1 CLI with a local rule.
- **Regression test:** `packages/adapters/src/ci/semgrep-check.test.ts` — 9 cases, all
  failing before the fix, passing after.
- **E2E:** none — CI tooling, no group of `e2e-test-policy.md`.
- **Not verified locally:** the scan's findings on this codebase — the sandbox network
  blocks `semgrep.dev`. The PR's CI run is the first real scan.
