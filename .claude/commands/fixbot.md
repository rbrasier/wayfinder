# /fixbot — Fix Failing Dependency PRs

Use this skill when the user asks to fix, resolve or get green the pull requests
Dependabot (or the release-port workflow acting for it) has opened. It works on
**those PRs' own branches**: it never opens a new PR, and it never merges. It
stops once every fixed PR is green, leaving the review and merge to a maintainer.

Invoked bare (`/fixbot`) it sweeps every open dependency PR. Invoked with
numbers (`/fixbot 322 323`) it works only on those.

---

## Where dependency PRs come from

Read [`.github/dependabot.yml`](../../.github/dependabot.yml),
[`.github/workflows/dependabot-release-port.yml`](../../.github/workflows/dependabot-release-port.yml)
and [`.github/workflows/dependabot-version-bump.yml`](../../.github/workflows/dependabot-version-bump.yml)
before starting. Between them they decide which branch a dependency PR sits on
and give it its PATCH bump.

| Kind | Head branch | Base | Author | Where the fix goes |
|---|---|---|---|---|
| Release-port PR — a non-major npm security fix rebuilt on the release line | `dependabot-port/<release branch>/npm_and_yarn/…` | current release branch | `github-actions[bot]` | That PR's branch |
| Version update for Actions or the Docker base image | `dependabot/github_actions/…`, `dependabot/docker/…` | current release branch | `dependabot[bot]` | That PR's branch |
| Major npm bump the port workflow left on `main` (it commented "major version bump") | `dependabot/npm_and_yarn/…` | `main` | `dependabot[bot]` | That PR's branch — unless a same-line patch exists (see **When to ask**) |
| npm bump the port workflow **could not** rebuild (it commented "Could not port") | `dependabot/npm_and_yarn/…` | `main` | `dependabot[bot]` | Not this skill — offer `/bugfix` on the release branch, as the comment says |
| npm PR on `main` with no port-workflow comment (opened before the workflow existed) | `dependabot/npm_and_yarn/…` | `main` | `dependabot[bot]` | Not this skill — closing and reopening it runs the port workflow; ask before doing it (see **When to ask**) |

A PR is **superseded** when an open, non-bot PR already carries the same bump
(search open PRs for the package name — a `/bugfix` backport like
`fix(deps): patch …` is the usual case). Superseded PRs are reported, not
touched: fixing both would land the bump twice.

---

## Step 1 — Inventory (read-only)

- Read both pointers from **Release Branching** in `CLAUDE.md`: the
  `Current release branch:` and the `Next release line:` values.
- List open PRs with `mcp__github__list_pull_requests` and keep the ones whose
  head branch starts `dependabot/` or `dependabot-port/`, or only the numbers
  the user named.
- For each, gather: base and head branch, head SHA, `mergeable_state`, the check
  runs on the head (`mcp__github__pull_request_read` → `get_check_runs`), and
  the port workflow's comment if there is one (`get_comments`).
- Classify each as **green**, **pending**, **red**, **conflicted**,
  **superseded**, or **not this skill** (per the table above).
- **No check runs at all on the head is not green.** A commit pushed with a bot
  or App credential raises no `synchronize` event, so CI never starts — this is
  always the case for release-port PRs. Dispatch `ci.yml` and `e2e.yml` on the
  head branch with `mcp__github__actions_run_trigger` and count the PR as
  pending.

Output a triage table to chat: PR link, package and versions, base, status, and
the failing check names.

## When to ask

**Default: no questions.** Fix every red and conflicted PR in scope (all of
them on a bare `/fixbot`, only the named ones otherwise) and carry on to the
end. If nothing is red or conflicted, report the triage table and stop.

Use `AskUserQuestion` only when the problem has a genuine choice in it or stays
unclear after diagnosis. These are the cases:

- **A major bump on `main` with a same-line patch.** The current release line
  has a patch that fixes the same advisory, as Next 15.5.28 did for the 16.4.1
  major. Two sound routes exist: carry the patch with `/bugfix`
  (recommended), or fix the major on its own PR. Without such a patch there
  is no choice; fix the major.
- **More than one sound fix with a real trade-off.** For example, adapting the
  call sites versus changing a config default. When one fix is plainly the
  minimal one, take it without asking.
- **The root cause can't be pinned down** after Step 2: the logs and the local
  reproduction disagree, or the failure doesn't reproduce.
- **The fix outgrows a dependency fix:** a multi-package refactor, a schema
  change, or new behaviour. Ask whether to hand it to `/enhance` or `/build`
  on its own branch, or to leave the PR.
- **An outward-facing action** that this skill doesn't otherwise take, such as
  closing and reopening a pre-workflow PR to run the port workflow.

Collect every question across all PRs into one `AskUserQuestion` call, made
after diagnosis. Keep working on the PRs that need no answer.

---

## Step 2 — Diagnose each selected PR (read-only)

Diagnose before writing any code. A root cause is a mechanism, verified in the
logs and reproduced locally; "flake" and "the bump broke it" are not root
causes.

- Pull the failing jobs' logs with `mcp__github__get_job_logs` (`run_id` plus
  `failed_only: true`, `return_content: true`). The final lines often only say
  `pnpm build … exit code: 1` — raise `tail_lines` until the first real error is
  in view.
- **Rule out a failure that isn't this PR's.** If the same check is red on the
  base branch's head, the dependency bump didn't cause it: say so in the PR
  comment (Step 7), port a fix only if one already exists, and never widen the
  dependency PR to repair unrelated code.
- Reproduce locally on the PR's head:
  `git fetch origin <head ref> && git switch -c <head ref> FETCH_HEAD`, then
  `pnpm install --frozen-lockfile` and the command behind the failing check:

  | Failing check | Run locally |
  |---|---|
  | Typecheck / Lint / Test / Validate | `./validate.sh` |
  | Test coverage | `pnpm test` with coverage, as `ci.yml` runs it |
  | Build container image | `pnpm build` (the Dockerfile step that failed) |
  | Security scan | `scripts/audit-check.sh` |
  | Playwright E2E | Do not run it. Read the job log and the uploaded report; the fix is proven by CI |

- Read the bumped package's changelog or release notes **from
  `node_modules/<package>`** (or its release tag) — never from memory. The usual
  causes are a removed or renamed API, a new peer-dependency range, a default
  that changed, an ESM-only release, or a root `pnpm.overrides` range that
  contradicts the bump (e.g. `"next": ">=15.5.27 <16"` pins Next below a
  16.x bump).
- Write the diagnosis to
  `docs/development/to-be-implemented/<slug>.dependabot.md`: the failing checks,
  the root cause with the log line that shows it, how it was reproduced, and the
  fix plan. `<slug>` names the package, e.g. `next-16-build-failure`.

## Change Summary

Output one summary to chat per PR as regular markdown, then go straight on to
the fix. It is a record, not an approval gate. **Headline first:** 2–3 lines of
plain prose naming what fails and what the fix does. Then these `###` sections,
at most 5 bullets each, omitting any that do not apply:

| Section | What it covers |
|---|---|
| Failing checks | Each red check and the first real error from its log |
| Root cause | The verified mechanism, citing the changelog entry or log line |
| Fix | The minimal change, and why it keeps the dependency at the bumped version |
| Files & packages touched | Paths grouped under `domain` / `application` / `adapters` / `apps` / root |
| Tests | The test written or changed first, or "the failing CI check is the reproduction" when no logic changes |
| Version & branch | The PR's PATCH bump (already present, or added by this fix), and the head branch the fix is pushed to |
| Risks | What else the bump or the fix could break |
| Out of scope | Failures diagnosed as not this PR's, and anything deferred |

---

## Workflow

### Step 3 — Fix on the PR's own branch

- Commit to the PR's head branch, checked out in Step 2. Never open a new PR,
  and never rebase, amend or force-push: if the branch is conflicted, merge the
  base branch in and resolve.
- **Keep the bump.** Never revert the dependency, lower its range, or add an
  override that resolves below the version the PR raised it to — that undoes the
  security fix the PR exists for. Raise a contradicting `pnpm.overrides` range
  instead.
- Regenerate `pnpm-lock.yaml` with `pnpm install --lockfile-only` — never edit it
  by hand, and never `pnpm update`, which re-resolves unrelated packages.
- When the fix changes logic (an adapted call site, a new option), write or
  update the unit test at the layer that owns that logic first. Never skip,
  disable or quarantine a test to get green.
- The architecture and code-writing rules in `CLAUDE.md` apply unchanged.
- **Every dependency update is a PATCH increment.** That holds whatever the
  base branch and however big the bump, including a major on `main`. Never
  MINOR or MAJOR.
- The PR should already carry one **PATCH** bump over its base:
  `dependabot-release-port.yml` puts it in the port commit, and
  `dependabot-version-bump.yml` adds it to every other Dependabot PR. Compare
  `VERSION` with the base branch's; bump `VERSION` and root `package.json`
  `version` yourself only when they are still equal. Never bump twice on one PR.
- Move the diagnosis doc to
  `docs/development/implemented/<release line>/v<version>/<slug>.dependabot.md`
  and append the fix applied and how it was verified. The release line is the
  current release branch's name when the PR's base is a release branch, and
  the `Next release line` value when the base is `main`.

### Step 4 — Validate

Run `./validate.sh` and the local command from Step 2's table for every check
that failed. Push only when all pass; one validated push beats three
speculative ones.

### Step 5 — Commit and push

- Commit message: `fix(deps): <what was fixed> for <package> <new version>`.
- Push to the head branch: `git push origin HEAD:<head ref>`.
- Once a hand-made commit lands on a `dependabot/*` branch, Dependabot stops
  rebasing it. Never comment `@dependabot rebase` or `@dependabot recreate`
  afterwards — both discard the fix.
- On a release-port PR, never close and reopen the original `main` PR: the port
  workflow would force-push its branch and wipe the fix.

### Step 6 — Make sure CI runs on the new head

Read the check runs on the pushed SHA. If none are queued — always the case on
release-port branches and for pushes made with an App credential — dispatch
`ci.yml` and `e2e.yml` on the head branch with
`mcp__github__actions_run_trigger`. Their runs report on the head commit, so
they appear on the PR.

### Step 7 — Comment on the PR

Post one comment per fix round with `mcp__github__add_issue_comment`. Look for
the marker first: a later round posts a new comment headed **Follow-up fix**
rather than editing the earlier one, so the history of what was tried stays on
the PR.

```markdown
<!-- wayfinder-fixbot:v1 -->
## Fix for the failing checks

**What failed:** `<check name>` — <the first real error, in one line>.

**Why:** <verified root cause — the breaking change in <package> <old> → <new>,
linking its changelog or release note>.

**What changed** (`<short sha>`):
- `<path>` — <what changed and why>

**How it was checked:** <local commands that passed, and which checks only CI
can confirm — e2e, the image build>.

**Version:** PATCH <old> → <new> (the PR's existing bump, or this commit's).

This branch now carries a hand-made commit, so Dependabot will no longer rebase
it. If it falls behind, merge the base branch in — asking Dependabot to rebase
or recreate it would discard this fix.

Waiting for CI to go green; the merge is left to a maintainer.

---
_Generated by [Claude Code](https://claude.ai/code)_
```

When a failure was diagnosed as not this PR's, say so in the same comment —
the check, why it isn't the bump's doing, and the fix ported or that none
exists yet.

### Step 8 — Wait for green

- With `subscribe_pr_activity` available (cloud sessions): subscribe to every
  PR fixed in this run and end the turn. CI results, reviews and merge
  conflicts wake the session; do not poll with `sleep`.
- Without it (local CLI): watch with `gh pr checks <number> --watch` as a
  background command and act when it exits.
- On each event, look at the whole PR on its current head:
  - **New red check** → back to Step 2 for that check: diagnose, summarise,
    fix, validate, push, dispatch, comment. A re-run is allowed only to confirm
    a failure that died before any test ran (checkout, install, runner loss),
    and at most once.
  - **Merge conflict** → merge the base branch in; resolve `VERSION` and
    `package.json` to the next PATCH above the base's version and rebuild the
    lockfile with `pnpm install --lockfile-only`; validate and push. This is
    the usual result of a sibling dependency PR merging first, since each one
    carries its own PATCH bump.
  - **Review comment** → answer it, and push small asks; anything larger goes
    to the user.
- After **three fix rounds** on one PR without green, stop pushing and report
  what is known, what was tried, and what you need.

A PR is **green** when every check run on its current head has completed as
`success`, `skipped` or `neutral` — with nothing skipped only because an
upstream job failed — and it has no merge conflict.

### Step 9 — Hand over

- **Never merge, approve, or enable auto-merge.** The merge is the user's.
- Unsubscribe from each PR that went green, and cancel any pending check-in.
- Report a table to the user: PR link, what failed, the fix commit, the
  version, and **green — ready for your review and merge**. List any PR left
  red with its blocker, every superseded or not-this-skill PR with the route
  recommended for it, and note that a fix merged to the release branch reaches
  `main` through the `/release` forward-merge.
