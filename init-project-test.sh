#!/usr/bin/env bash
# init-project-test.sh — test the create-ai-app-template CLI from a local build.
#
# Builds the create package, packs it into a tarball, then runs it from a
# target directory — equivalent to running:
#   pnpm create ai-app-template
# ...but using your local source instead of the published npm package.
#
# Usage:
#   ./init-project-test.sh               # creates /tmp/create-test-<timestamp>/
#   ./init-project-test.sh --keep        # keeps the output dir after the run
#   ./init-project-test.sh ~/dev/myapp   # uses the specified directory

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREATE_PKG="$ROOT/packages/create"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}▸${NC}  $1"; }
warning() { echo -e "${YELLOW}!${NC}  $1"; }

# ── flags ─────────────────────────────────────────────────────────────────────

KEEP=false
POSITIONAL_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--keep" ]; then
    KEEP=true
  else
    POSITIONAL_ARGS+=("$arg")
  fi
done

# ── clean up previous runs ────────────────────────────────────────────────────

info "Cleaning up previous test runs..."
rm -rf /tmp/create-ai-app-template-*

# ── new temp dir ──────────────────────────────────────────────────────────────

TMP_DIR="$(mktemp -d /tmp/create-ai-app-template-XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR"
}
if [ "$KEEP" = false ]; then
  trap cleanup EXIT
fi

# ── local snapshot ───────────────────────────────────────────────────────────
# Snapshot the current working tree (including uncommitted changes) into a
# temporary git repo so the scaffold clones local source without requiring
# a push to GitHub first.
SNAPSHOT_DIR="$TMP_DIR/snapshot"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.turbo' \
  --exclude='.next' \
  "$ROOT/" "$SNAPSHOT_DIR/"
git -C "$SNAPSHOT_DIR" init -q
git -C "$SNAPSHOT_DIR" config user.email "test@test.com"
git -C "$SNAPSHOT_DIR" config user.name "Test"
git -C "$SNAPSHOT_DIR" add -A
git -C "$SNAPSHOT_DIR" commit -q -m "local snapshot for testing"
export TEMPLATE_REPO_OVERRIDE="$SNAPSHOT_DIR"

# ── target directory ─────────────────────────────────────────────────────────

if [ "${#POSITIONAL_ARGS[@]}" -gt 0 ]; then
  TARGET="${POSITIONAL_ARGS[0]}"
  mkdir -p "$TARGET"
else
  TARGET="$TMP_DIR/project"
  mkdir -p "$TARGET"
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  create-ai-app-template — local test run"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Target : $TARGET"
if [ "$KEEP" = true ]; then
  echo "  Mode   : --keep (output preserved on exit)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# ── build framework packages + pack for local testing ────────────────────────
# The scaffold normally installs @rbrasier/* from npm. To test local changes
# without publishing, we build and pack each framework package into tarballs
# and set PACKS_DIR so the scaffold uses file: references instead of npm ranges.

info "Building framework packages..."
pnpm --filter "@rbrasier/domain" build
pnpm --filter "@rbrasier/shared" build
pnpm --filter "@rbrasier/application" build
pnpm --filter "@rbrasier/adapters" build

PACK_DIR="$TMP_DIR/packs"
mkdir -p "$PACK_DIR"
info "Packing framework packages into $PACK_DIR..."
for pkg in domain shared application adapters; do
  (cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$PACK_DIR" --silent)
done
export PACKS_DIR="$PACK_DIR"

info "Building create package..."
pnpm --filter create-ai-app-template build

# ── run ──────────────────────────────────────────────────────────────────────

info "Running from $TARGET..."
echo

cd "$TARGET"
node "$CREATE_PKG/dist/index.js"

if [ "$KEEP" = true ]; then
  echo
  info "Output kept at: $TMP_DIR"
fi
