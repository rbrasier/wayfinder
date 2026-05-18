#!/usr/bin/env bash
# scripts/update-framework.sh — update @rbrasier/* framework packages.
#
# Framework packages are published under @rbrasier on GitHub Package Registry.
# Flags:
#   --dry-run        Show what would update; make no changes
#   --interactive    Confirm every step, even MINOR/PATCH bumps
#   --skip-migrations  Skip db:migrate after updating adapters

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── flags ─────────────────────────────────────────────────────────────────────
DRY_RUN=false
INTERACTIVE=false
SKIP_MIGRATIONS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)          DRY_RUN=true ;;
    --interactive)      INTERACTIVE=true ;;
    --skip-migrations)  SKIP_MIGRATIONS=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}✓${NC}  $1"; }
warn()    { echo -e "${YELLOW}!${NC}  $1"; }
section() { echo; echo -e "${BOLD}── $1 ──${NC}"; }

# ── read framework scope ──────────────────────────────────────────────────────
FRAMEWORK_SCOPE=$(cat .framework-scope 2>/dev/null || echo "@rbrasier")

FRAMEWORK_PKGS=(
  "${FRAMEWORK_SCOPE}/domain"
  "${FRAMEWORK_SCOPE}/shared"
  "${FRAMEWORK_SCOPE}/application"
  "${FRAMEWORK_SCOPE}/adapters"
)

TEMPLATE_VERSION=$(cat .template-version 2>/dev/null || echo "unknown")

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Framework Update"
echo "  Scope   : $FRAMEWORK_SCOPE"
echo "  Current : $TEMPLATE_VERSION"
if [ "$DRY_RUN" = "true" ]; then
  echo -e "  Mode    : ${YELLOW}DRY RUN (no changes will be made)${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── check for available updates ───────────────────────────────────────────────
section "Checking for available updates"

OUTDATED_OUTPUT=""
for pkg in "${FRAMEWORK_PKGS[@]}"; do
  pkg_outdated=$(pnpm outdated "$pkg" --no-color 2>/dev/null || true)
  if [ -n "$pkg_outdated" ]; then
    OUTDATED_OUTPUT+="$pkg_outdated"$'\n'
  fi
done

if [ -z "$(echo "$OUTDATED_OUTPUT" | tr -d '[:space:]')" ]; then
  info "Already on the latest framework version ($TEMPLATE_VERSION)."
  exit 0
fi

echo "$OUTDATED_OUTPUT"

if [ "$DRY_RUN" = "true" ]; then
  echo
  warn "DRY RUN — no changes made. Run without --dry-run to apply the update."
  exit 0
fi

# ── detect MAJOR bump ─────────────────────────────────────────────────────────
CURRENT_ADAPTERS_VERSION=""
LATEST_ADAPTERS_VERSION=""

if command -v node &>/dev/null; then
  CURRENT_ADAPTERS_VERSION=$(node -e "
    try {
      const p = require('./node_modules/${FRAMEWORK_SCOPE}/adapters/package.json');
      process.stdout.write(p.version || '');
    } catch { process.stdout.write(''); }
  " 2>/dev/null || echo "")
  LATEST_ADAPTERS_VERSION=$(pnpm info "${FRAMEWORK_SCOPE}/adapters" version 2>/dev/null || echo "")
fi

MAJOR_BUMP=false
if [ -n "$CURRENT_ADAPTERS_VERSION" ] && [ -n "$LATEST_ADAPTERS_VERSION" ]; then
  CURRENT_MAJOR=$(echo "$CURRENT_ADAPTERS_VERSION" | cut -d. -f1)
  LATEST_MAJOR=$(echo "$LATEST_ADAPTERS_VERSION" | cut -d. -f1)
  if [ "$LATEST_MAJOR" -gt "$CURRENT_MAJOR" ] 2>/dev/null; then
    MAJOR_BUMP=true
  fi
fi

# ── confirm MAJOR bumps (always) or all bumps if --interactive ────────────────
if [ "$MAJOR_BUMP" = "true" ]; then
  echo
  echo -e "${RED}⚠  MAJOR version bump detected.${NC}"
  echo "   This may include breaking changes to port interfaces or entity types."
  echo "   Review the changelogs above before continuing."
  echo
  read -r -p "   Proceed with MAJOR update? [y/N]: " MAJOR_CONFIRM
  case "${MAJOR_CONFIRM:-n}" in
    [Yy]*) ;;
    *)
      echo "Aborted."
      exit 0
      ;;
  esac
elif [ "$INTERACTIVE" = "true" ]; then
  echo
  read -r -p "   Proceed with update? [y/N]: " CONFIRM
  case "${CONFIRM:-n}" in
    [Yy]*) ;;
    *)
      echo "Aborted."
      exit 0
      ;;
  esac
fi

# ── update packages ───────────────────────────────────────────────────────────
section "Updating packages"
pnpm update "${FRAMEWORK_PKGS[@]}"
info "Packages updated."

# ── run migrations if adapters changed ───────────────────────────────────────
if [ "$SKIP_MIGRATIONS" = "false" ]; then
  section "Running database migrations"
  if pnpm run db:migrate 2>&1; then
    info "Migrations complete."
  else
    echo
    echo -e "${RED}✗ Migrations failed.${NC}"
    echo "  Check that DATABASE_URL is set correctly in .env and that"
    echo "  the database is running. Fix the issue, then run:"
    echo "    pnpm run db:migrate"
    exit 1
  fi
else
  warn "Skipping migrations (--skip-migrations). Run 'pnpm run db:migrate' manually."
fi

# ── validate ──────────────────────────────────────────────────────────────────
section "Validating"
if [ "$MAJOR_BUMP" = "true" ]; then
  # For MAJOR bumps, only typecheck — application code may need fixes first
  if pnpm typecheck 2>&1; then
    info "Typecheck passed."
  else
    echo
    echo -e "${YELLOW}!  TypeScript errors detected after MAJOR update.${NC}"
    echo "   Review the errors above, update your application code, then run"
    echo "   './validate.sh' when ready."
  fi
else
  if ./validate.sh; then
    info "Validation passed."
  else
    echo
    echo -e "${YELLOW}!  Validation failed after update.${NC}"
    echo "   The update has been applied but something needs attention."
    echo "   Fix the failures above, then commit."
  fi
fi

# ── update .template-version ──────────────────────────────────────────────────
section "Updating .template-version"
NEW_VERSION=$(node -e "
  try {
    const p = require('./node_modules/${FRAMEWORK_SCOPE}/adapters/package.json');
    process.stdout.write(p.version || '');
  } catch { process.stdout.write('${TEMPLATE_VERSION}'); }
" 2>/dev/null || echo "$TEMPLATE_VERSION")

if [ -n "$NEW_VERSION" ] && [ "$NEW_VERSION" != "$TEMPLATE_VERSION" ]; then
  echo "$NEW_VERSION" > .template-version
  info "Updated .template-version: $TEMPLATE_VERSION → $NEW_VERSION"
else
  warn "Could not determine new version; .template-version unchanged."
  NEW_VERSION="$TEMPLATE_VERSION"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓ Framework updated to ${NEW_VERSION}.${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "  Review the changes:"
echo "    git diff"
echo
echo "  Then commit:"
echo "    git add package.json pnpm-lock.yaml .template-version"
echo "    git commit -m \"chore: update framework to ${NEW_VERSION}\""
echo
