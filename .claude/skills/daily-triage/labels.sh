#!/usr/bin/env bash
#
# Create the label taxonomy the /daily-triage skill classifies against.
#
#   ./labels.sh              create or update the 27 labels (safe to re-run)
#   ./labels.sh --prune      also delete the 4 labels this scheme orphans
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
# type: — one per issue. Maps 1:1 to the skill routing table in CLAUDE.md.
# ---------------------------------------------------------------------------
label "type:bug"          "d73a4a" "Built behaviour contradicts a stated rule, test or doc — routes to /bugfix"
label "type:enhancement"  "a2eeef" "Change or extension to behaviour that already ships — routes to /enhance"
label "type:feature"      "0e8a16" "Something that does not exist yet — routes to /new-feature"
label "type:docs"         "0075ca" "Documentation wrong, missing or misleading — routes to /doc-review"
label "type:question"     "d876e3" "A request for understanding, not for change"
label "type:chore"        "ededed" "Tooling, CI, dependencies, lint, build"

# ---------------------------------------------------------------------------
# area: — one or more per issue. Derived from pnpm-workspace.yaml plus the two
# code roots outside it (apps/web/e2e, deploy/lambda).
# ---------------------------------------------------------------------------
label "area:web"          "c5def5" "apps/web — UI, route groups, components, tRPC"
label "area:api"          "c5def5" "apps/api — the standalone API service"
label "area:domain"       "c5def5" "packages/domain — entities, ports, Result"
label "area:application"  "c5def5" "packages/application — use cases and services"
label "area:adapters"     "c5def5" "packages/adapters — Drizzle, AI SDKs, storage, auth, e-mail, MCP"
label "area:shared"       "c5def5" "packages/shared — schemas shared across boundaries"
label "area:e2e"          "c5def5" "apps/web/e2e, mocks, the e2e workflow"
label "area:deploy"       "c5def5" "Docker, deploy/lambda, publish workflow, scripts"
label "area:docs"         "c5def5" "docs/, README, CONTRIBUTING"

# ---------------------------------------------------------------------------
# priority: — one per issue. Severity to the product, not to the reporter.
# ---------------------------------------------------------------------------
label "priority:p0"       "b60205" "Data loss, corrupted audit log, governance bypass, cross-org leak, or will not boot"
label "priority:p1"       "d93f0b" "A core flow is blocked with no workaround"
label "priority:p2"       "fbca04" "Degraded but workable; an obvious workaround exists"
label "priority:p3"       "c2e0c6" "Cosmetic, copy, refactor, nice-to-have"

# ---------------------------------------------------------------------------
# size: — one per issue. Sized in /build's unit: sub-components of 3–4 files.
# ---------------------------------------------------------------------------
label "size:xs"           "bfd4f2" "One file, plus a case added to an existing test"
label "size:s"            "bfd4f2" "One sub-component — up to 4 files including its test"
label "size:m"            "bfd4f2" "Two or three sub-components within a single package or app"
label "size:l"            "bfd4f2" "Crosses package boundaries, needs a migration, or needs a phase doc first"

# ---------------------------------------------------------------------------
# status: — the state machine. Absence of any status: label means untriaged,
# which is what /daily-triage sweeps for.
# ---------------------------------------------------------------------------
label "status:analysed"       "0e8a16" "Triaged by /daily-triage; analysis comment posted"
label "status:needs-info"     "fbca04" "Parked awaiting information from the reporter"
label "status:in-progress"    "1d76db" "Someone is working on it"
label "status:triage-failed"  "b60205" "/daily-triage could not analyse it; needs a human look"

echo "==> Done. 27 labels created or updated."

# ---------------------------------------------------------------------------
# Orphans. These four are GitHub defaults superseded by the type: axis. Only
# issue #164 carries any (enhancement, question) and it is closed, so nothing
# in flight loses a label. Kept deliberately: duplicate, invalid, wontfix
# (terminal states the skill's sweep predicate excludes by name), and
# good first issue / help wanted (contributor-facing, orthogonal to triage).
# ---------------------------------------------------------------------------
if [[ "$PRUNE" == true ]]; then
  echo "==> Pruning 4 orphaned default labels"
  for orphan in "bug" "enhancement" "documentation" "question"; do
    gh label delete "$orphan" --repo "$REPO" --yes || echo "    (skipped: $orphan)"
  done
  echo "==> Prune complete."
else
  echo
  echo "Orphaned by this scheme: bug, enhancement, documentation, question"
  echo "Re-run with --prune to delete them."
fi
