# Implementation Summary — `/dependabot` skill and PATCH bumps on Dependabot PRs

- **Version**: 0.28.33 (bump: **PATCH**: skill instructions, CI workflows and
  documentation only; no product code, no schema impact)
- **Base branch**: `release/alpha-2`

## What was built

### `/dependabot` — fix failing dependency PRs on demand

`.claude/commands/dependabot.md` adds an on-demand skill shaped like `/bugfix`,
but it works on PRs that already exist instead of opening a new one:

1. **Inventory (read-only):** lists open `dependabot/*` and `dependabot-port/*`
   PRs, reads the check runs on each head, and classifies each as green,
   pending, red, conflicted, superseded (an open human PR already carries the
   same bump), or a case for another route. Majors the port workflow left on
   `main` and bumps it could not port go to `/bugfix`. PRs opened before the
   port workflow existed get a close-and-reopen, but only after the user agrees.
   A head with no check runs gets `ci.yml`/`e2e.yml` dispatched, because a
   bot-credential push raises no `synchronize`.
2. **Questions:** which red PRs to fix. For a major on `main`, whether a
   same-line patch exists, which goes to `/bugfix` on the release branch.
3. **Diagnose:** pulls the failing job logs, rules out failures that are red on
   the base too, reproduces locally, and reads the bumped package's changelog
   from `node_modules`. Writes a `<slug>.dependabot.md` diagnosis doc.
4. **Change summary + approval gate:** the same three routes as `/bugfix`.
5. **Fix on the PR's own branch:** never reverts the bump or pins below it,
   never edits the lockfile by hand, and never rebases or force-pushes.
6. **Validate, push, and dispatch CI** if the push started none.
7. **Comment on the PR** explaining what failed, why, what changed and how it
   was verified. The comment carries a `<!-- wayfinder-dependabot-fix:v1 -->`
   marker; each later round adds a new comment instead of editing that one.
8. **Wait for green:** `subscribe_pr_activity` in cloud sessions,
   `gh pr checks --watch` locally. It handles new failures, merge conflicts and
   review comments, and stops after three fix rounds without green.
9. **Hand over:** never merges, approves or enables auto-merge. It reports
   each green PR as ready for the maintainer's review and merge.

Routed from `CLAUDE.md` / `AGENTS.md` and listed in `docs/guides/skills.md`.

### PATCH bump on every Dependabot change

- `dependabot-release-port.yml`: the port commit now also bumps `VERSION` and
  root `package.json` `version` to the release branch's version plus one PATCH.
- New `dependabot-version-bump.yml` (`pull_request_target`, opened/reopened)
  adds a `chore(release): bump version to x.y.z` commit to every Dependabot PR
  that keeps its branch: Actions and Docker updates on the release branch, and
  majors on `main`. It skips non-major npm PRs on `main`, which the port
  workflow replaces, and skips any PR whose `VERSION` already differs from its
  base. It only rewrites two strings with `sed` and never runs PR code. It
  dispatches CI and E2E afterwards, because a `GITHUB_TOKEN` push starts no
  `pull_request` runs.

## Known limitations

- Each Dependabot PR bumps from its base independently, so when two are open
  together, the second to merge conflicts on `VERSION`. Dependabot no longer
  rebases a branch that carries the bump commit. Merge the base branch in and
  take the next PATCH: `/dependabot` does this as part of its conflict
  handling.
- Both workflows read `dependabot.yml` and run from the default branch (`main`).
  They take effect once this is forward-merged.
