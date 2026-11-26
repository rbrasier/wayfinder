#!/usr/bin/env bash
# Prints every file outside docs/development/implemented/ that names the old
# template package scope, one repo-relative path per line. Used by validate.sh
# check 26.
#
# git grep rather than grep -r: only files that are, or could be, committed
# count. --untracked keeps new not-yet-added files in scope, while gitignored
# local files (a developer's .claude/settings.local.json, .env) stay out, so a
# local run agrees with a fresh clone. -a because two source files use a literal
# NUL as a delimiter in a template literal, which makes grep call them binary
# and skip them without saying so. The bracketed first letter stops this script
# matching its own search.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
# git grep exits 1 for "no match", which is the passing case; above 1 is a real error.
leaks=$(git grep -l -a --untracked '@[r]brasier' -- . ':!docs/development/implemented/') || [ $? -eq 1 ]
[ -n "$leaks" ] && printf '%s\n' "$leaks" | sort
exit 0
