# Bug fix — validate.sh check 26 fails on gitignored local files

## Approved change summary

Check 26 fails on any developer machine that has an old, gitignored local file
mentioning the pre-rename package scope, even though the repo is clean. The scan
moves from `grep -r` over the working tree to `git grep --untracked`, which reads
tracked files and untracked-but-not-ignored files and skips anything gitignored.
Local and cloud runs then agree. A `node --test` script test pins the behaviour.

- **Rule as meant:** the old scope must not appear in any file that is in the
  repo or could be committed; `docs/development/implemented/` stays exempt.
- **Rule today:** gitignored local files (`.claude/settings.local.json`, `.env`,
  editor files) also fail the check.
- **Out of scope:** other `find`/`grep -r` based checks in `validate.sh`.
- **Version:** PATCH, 0.41.10 → 0.41.11 on `release/alpha-3`. No issue.

## Reproduction

1. Put a line containing the old scope in `.claude/settings.local.json`
   (ignored via the user's global gitignore, `~/.config/git/ignore`).
2. Run `./validate.sh`.
3. Check 26 fails, naming `./.claude/settings.local.json`. The same commit
   passes on Claude Code for the web, whose fresh clone has no such file.

## Root cause (verified)

`validate.sh` check 26 ran `grep -ral "$OLD_SCOPE_PATTERN" .` with a hand-kept
`--exclude-dir` list. That walks every file on disk, including files git ignores
and therefore can never commit. The maintainer's local settings file held a
permission entry saved before the rename
(`pnpm --filter "<old scope>/adapters" db:migrate`), so the check failed locally
while the committed tree was clean.

## Fix plan

1. Move the scan into `scripts/find-template-scope-leaks.sh`, which runs
   `git grep -l --untracked -a` from the repo root, excluding
   `docs/development/implemented/` by pathspec. `--untracked` keeps new,
   not-yet-added files in scope; standard excludes (`.gitignore`,
   `.git/info/exclude`, `core.excludesFile`) drop ignored ones. `node_modules`,
   `.next`, `dist` and the rest no longer need listing — they are ignored.
2. Check 26 calls the script.
3. Regression test `scripts/find-template-scope-leaks.test.mjs` builds a temp git
   repo and asserts: ignored file → no leak; untracked non-ignored file → leak;
   tracked file → leak; file under `docs/development/implemented/` → no leak.

## Implementation summary

- **Root cause:** check 26 scanned the whole working tree with `grep -r`, so a
  gitignored local file failed it on one machine while a fresh clone passed.
- **Fix applied:** the scan moved to `scripts/find-template-scope-leaks.sh`,
  which uses `git grep -l -a --untracked` with a pathspec exempting
  `docs/development/implemented/`. It exits non-zero only on a real git error
  (`git grep` exit above 1), which check 26 reports as a failure rather than a
  pass. Leak paths are now printed repo-relative, without the leading `./`.
- **Regression test:** `scripts/find-template-scope-leaks.test.mjs`, run by
  check 26. Its "ignores a gitignored local file" case failed against the old
  `grep -r` logic and passes against the new script.
- **E2E:** none — shell tooling, outside every `e2e-test-policy.md` group.
- **Version:** 0.41.10 → 0.41.11 (PATCH, no schema impact).
- **Deviations:** none.
