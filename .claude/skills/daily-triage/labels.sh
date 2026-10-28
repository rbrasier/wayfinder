#!/usr/bin/env bash
#
# Create the status: labels the /daily-triage skill moves issues through.
# Triage uses status: labels only; nothing else is applied to an issue.
#
#   ./labels.sh              create or update the 8 labels (safe to re-run)
#   ./labels.sh --prune      also delete the 27 labels this scheme orphans
#
# Requires the `gh` CLI, authenticated with write access to the repo.
# `--force` makes creation idempotent: an existing label is updated in place,
# so re-running after a colour or description edit converges rather than fails.

set -euo pipefail

REPO="${REPO:-rbrasier/wayfinder}"
PRUNE=false
[[ "${1:-}" == "--prune" ]] && PRUNE=true

label() {
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force
}

echo "==> Creating labels on $REPO"

# ---------------------------------------------------------------------------
# status: — the state machine. Absence of any status: label means untriaged,
# which is what /daily-triage sweeps for.
# ---------------------------------------------------------------------------
label "status:queued"         "ededed" "Claimed by /daily-triage; waiting out its 30-minute grace period"
label "status:analysed"       "0e8a16" "Triaged by /daily-triage; analysis comment posted"
label "status:split"          "c5def5" "Split by /daily-triage into one sub-issue per request"
label "status:needs-info"     "fbca04" "Parked awaiting information from the reporter"
label "status:in-progress"    "1d76db" "Someone is working on it; a session has claimed the issue"
label "status:in-review"      "5319e7" "A pull request is open against it, awaiting review and merge"
label "status:triage-failed"  "b60205" "/daily-triage could not analyse it; needs a human look"
label "status:fixed"          "6f42c1" "Closed by /daily-triage; a linked pull request merged"

echo "==> Done. 8 labels created or updated."

# ---------------------------------------------------------------------------
# Orphans. The type:, area:, priority: and size: axes an earlier version of
# triage applied, plus the four GitHub defaults they superseded. Deleting a
# label removes it from every issue carrying it — which is the point. Kept
# deliberately: duplicate, invalid, wontfix (terminal states the sweep excludes
# by name), and good first issue / help wanted (contributor-facing).
# ---------------------------------------------------------------------------
ORPHANS=(
  "type:bug" "type:enhancement" "type:feature" "type:docs" "type:question" "type:chore"
  "area:web" "area:api" "area:domain" "area:application" "area:adapters"
  "area:shared" "area:e2e" "area:deploy" "area:docs"
  "priority:p0" "priority:p1" "priority:p2" "priority:p3"
  "size:xs" "size:s" "size:m" "size:l"
  "bug" "enhancement" "documentation" "question"
)

if [[ "$PRUNE" == true ]]; then
  echo "==> Pruning ${#ORPHANS[@]} orphaned labels"
  for orphan in "${ORPHANS[@]}"; do
    gh label delete "$orphan" --repo "$REPO" --yes || echo "    (skipped: $orphan)"
  done
  echo "==> Prune complete."
else
  echo
  echo "Orphaned by this scheme: ${ORPHANS[*]}"
  echo "Re-run with --prune to delete them."
fi
