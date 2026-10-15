# Implementation Summary — `/dependabot` renamed to `/fixbot`, fewer questions

- **Version**: 0.28.34 (bump: **PATCH**: skill instructions and documentation
  only; no product code, no schema impact)
- **Base branch**: `release/alpha-2`

## What changed

- **Renamed** `.claude/commands/dependabot.md` → `.claude/commands/fixbot.md`.
  The routing tables in `CLAUDE.md` and `AGENTS.md`, `docs/guides/skills.md`,
  and the comments in `.github/dependabot.yml` and
  `dependabot-version-bump.yml` now point at `/fixbot`. The PR-comment marker
  is now `<!-- wayfinder-fixbot:v1 -->`.
- **Questions only when there is a genuine choice.** The upfront "which PRs?"
  question and the Approve / Amend gate are gone. The skill fixes every red or
  conflicted PR in scope and posts its change summary as a record, not as an
  approval gate. It asks, in one batched call, only when one of these comes up:
  - a major bump on `main` that also has a same-line patch;
  - more than one sound fix with a real trade-off;
  - a root cause that stays unclear after diagnosis;
  - a fix that outgrows a dependency fix;
  - an outward-facing action such as closing and reopening a PR.
- **Every dependency update is a PATCH increment**, stated as a rule. It holds
  whatever the base branch and however big the bump, including majors on
  `main`. It matches what `dependabot-release-port.yml` and
  `dependabot-version-bump.yml` already do.

## Known limitations

- None beyond those recorded in v0.28.33.
