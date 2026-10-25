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

## First real scan — 58 findings, triaged

The first CI run of the working gate reported 58 blocking findings. Each is fixed or
waived inline with its reason:

| Finding | Where | Outcome |
|---|---|---|
| `gcm-no-tag-length` | `settings-encryption.ts` | **Fixed** — `authTagLength: 16` on cipher and decipher. A truncated envelope decrypted with a 4-byte tag before; regression test added |
| `run-shell-injection` | `publish.yml` | **Fixed** — the tag goes through `env:`, not `${{ }}` spliced into bash |
| `github-actions-mutable-action-tag` (×~48) | 7 workflows | **Fixed** — every action pinned to its commit SHA with a `# vX.Y.Z` comment, the convention the already-pinned actions use; Dependabot's github-actions entry keeps them current |
| `missing-user`, `missing-user-entrypoint` | `Dockerfile` | **Fixed** — runtime stage runs as `node`, `/app` copied `--chown=node:node`; guarded by `container-user.test.ts` |
| `dependabot-missing-cooldown` | `.github/dependabot.yml` | **Fixed** — `cooldown: default-days: 7` on each entry (security updates are not delayed) |
| `pull-request-target-code-checkout` | `dependabot-version-bump.yml` | **Waived** — job is limited to Dependabot's same-repo branches and runs only git and sed on the checkout |
| `pnpm-block-exotic-sub-dependencies`, `pnpm-minimum-release-age`, `pnpm-trust-policy` | `pnpm-workspace.yaml` | **Waived** — pnpm 10.16–10.26 settings; the repo pins pnpm 9.12, which does not read them. Remove when pnpm moves to 10.26+ |

## E2E shard 1: a different chat-turn spec failing each run

Not caused by this change — it reproduced on the head before the triage fixes and on
`release/alpha-2`'s own run — but it held this PR red, so it is fixed here.

- **Symptom:** `chat.spec › multi-turn conversation works` (bubble poll, 8s) failed one
  run; `code-quality-hot-paths › a committed turn keeps its … reply after reload`
  (`POST /api/test/ai-script`, 15s) the next. Other chat-turn specs flaked around them.
- **Root cause:** CI serves the app with `next dev`. `warm-routes.sh` compiles the heavy
  routes before the suite, but `next dev` disposes any built route idle for more than
  `onDemandEntries.maxInactiveAge` (60s — `disposeInactiveEntries` in
  `next/dist/server/dev/on-demand-entry-handler.js`). A route warmed at boot and first
  used minutes later recompiled mid-spec: the app log shows `/api/test/ai-script` built
  in the warm-up (10.5s) and again mid-suite (13.6s), `/api/chat/[sessionId]/stream`
  16.3s. Whichever spec arrived first after an idle spell paid it, so the failure moved.
- **Fix:** `next.config.ts` sets `onDemandEntries` to keep every entry (24h, 500 pages)
  when `E2E_KEEP_ROUTES_COMPILED=true`; both app starts in `e2e.yml` set it. Local
  `next dev` keeps Next's defaults.
- **Guard:** `apps/web/src/e2e-warm-routes.test.ts` — retention on with the flag, off
  without it, and the flag set on every app start in `e2e.yml`.
- **Watch:** retained entries hold more heap; the 12 GB / 10 GB `NODE_OPTIONS` ceilings
  stay. A `next dev` memory restart would show as "Unexpected end of JSON input" in the
  app log.
