#!/usr/bin/env bash
# scripts/init-project.sh — bootstrap a new project from this template.
# Run once from the repo root after cloning. Renames app-level packages,
# wires @rbrasier/* as versioned npm deps, removes framework source,
# and resets git history.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── guard: already initialised ───────────────────────────────────────────────
if [ -f .framework-scope ]; then
  echo "Already initialised — nothing to do."
  exit 0
fi

# ── colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}✓${NC}  $1"; }
prompt()  { echo -e "${YELLOW}?${NC}  $1"; }
warning() { echo -e "${YELLOW}!${NC}  $1"; }
error()   { echo -e "${RED}✗${NC}  $1" >&2; }

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ai-app-template — Project Initialisation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

FRAMEWORK_SCOPE="@rbrasier"
FRAMEWORK_VERSION=$(tr -d '[:space:]' < VERSION)
FRAMEWORK_PKGS=("domain" "shared" "application" "adapters")

# ── helpers ───────────────────────────────────────────────────────────────────

sed_inplace() {
  local pattern="$1"
  local file="$2"
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i'' "$pattern" "$file"
  else
    sed -i '.bak' "$pattern" "$file"
    rm -f "${file}.bak"
  fi
}

read_input() {
  local var_name="$1"
  local question="$2"
  local default_val="${3:-}"
  local value=""

  while [ -z "$value" ]; do
    if [ -n "$default_val" ]; then
      prompt "$question [$default_val]: "
    else
      prompt "$question: "
    fi
    read -r value
    value="${value:-$default_val}"
    if [ -z "$value" ]; then
      warning "Value required. Please try again."
    fi
  done

  printf -v "$var_name" '%s' "$value"
}

validate_project_name() {
  local name="$1"
  if [[ ! "$name" =~ ^[a-z][a-z0-9-]*$ ]]; then
    error "Project name must be lowercase letters, numbers, and hyphens only (e.g. my-saas-app)"
    return 1
  fi
  return 0
}

# ── collect inputs ────────────────────────────────────────────────────────────

# Project name
while true; do
  read_input PROJECT_NAME "Project name (lowercase, hyphens only)" ""
  if validate_project_name "$PROJECT_NAME"; then break; fi
done

# App package scope (only for apps/web and apps/api — framework stays @rbrasier)
DEFAULT_APP_SCOPE="@${PROJECT_NAME}"
read_input APP_SCOPE "Package scope for your app packages" "$DEFAULT_APP_SCOPE"

if [[ ! "$APP_SCOPE" =~ ^@ ]]; then
  APP_SCOPE="@${APP_SCOPE}"
  warning "Scope must start with @, using: $APP_SCOPE"
fi

# AI provider
echo
echo "  Default AI provider:"
echo "    1) anthropic (Claude)"
echo "    2) openai    (GPT-4o)"
echo "    3) mistral   (Mistral Large)"
prompt "Choice [1]: "
read -r AI_CHOICE
case "${AI_CHOICE:-1}" in
  2) AI_PROVIDER="openai" ;;
  3) AI_PROVIDER="mistral" ;;
  *) AI_PROVIDER="anthropic" ;;
esac

# Auth method
echo
echo "  Authentication method:"
echo "    1) magic-link         (email magic link — no password)"
echo "    2) pki                (client certificate via reverse proxy)"
echo "    3) pki-and-magic-link (PKI primary, magic link fallback)"
echo "    4) google-oauth       (Google OAuth — requires additional setup)"
echo "    5) other              (configure manually)"
prompt "Choice [1]: "
read -r AUTH_CHOICE
case "${AUTH_CHOICE:-1}" in
  2) AUTH_METHOD="pki" ;;
  3) AUTH_METHOD="pki-and-magic-link" ;;
  4) AUTH_METHOD="google-oauth" ;;
  5) AUTH_METHOD="other" ;;
  *) AUTH_METHOD="magic-link" ;;
esac

# Langfuse
echo
prompt "Enable Langfuse observability? [y/N]: "
read -r LANGFUSE_ANSWER
case "${LANGFUSE_ANSWER:-n}" in
  [Yy]*) LANGFUSE_ENABLED="y" ;;
  *)     LANGFUSE_ENABLED="n" ;;
esac

# ── confirm ───────────────────────────────────────────────────────────────────

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project name     : $PROJECT_NAME"
echo "  App scope        : $APP_SCOPE"
echo "  Framework scope  : $FRAMEWORK_SCOPE (published npm packages — unchanged)"
echo "  Framework ver    : $FRAMEWORK_VERSION"
echo "  AI provider      : $AI_PROVIDER"
echo "  Auth method      : $AUTH_METHOD"
echo "  Langfuse         : $LANGFUSE_ENABLED"
echo
prompt "Proceed? [y/N]: "
read -r CONFIRM
case "${CONFIRM:-n}" in
  [Yy]*) ;;
  *)
    echo "Aborted — no changes made."
    exit 0
    ;;
esac

echo

# ── remove framework source packages (they become npm deps) ──────────────────

info "Removing framework source packages (packages/ → npm deps)…"
rm -rf packages/

# ── update pnpm-workspace.yaml to only list apps/ ────────────────────────────

info "Updating pnpm-workspace.yaml…"
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "apps/*"
EOF

# ── rename app-level packages to user's scope ────────────────────────────────

info "Renaming @rbrasier/web and @rbrasier/api → ${APP_SCOPE}/…"
sed_inplace "s|\"@rbrasier/web\"|\"${APP_SCOPE}/web\"|g"  apps/web/package.json
sed_inplace "s|\"@rbrasier/api\"|\"${APP_SCOPE}/api\"|g"  apps/api/package.json

# ── swap workspace:* → versioned npm ranges in apps ──────────────────────────

info "Wiring framework packages as versioned npm dependencies…"
VERSION_RANGE="^${FRAMEWORK_VERSION}"
for pkg in "${FRAMEWORK_PKGS[@]}"; do
  for app_pkg in apps/web/package.json apps/api/package.json; do
    [ -f "$app_pkg" ] || continue
    sed_inplace "s|\"${FRAMEWORK_SCOPE}/${pkg}\": \"workspace:\*\"|\"${FRAMEWORK_SCOPE}/${pkg}\": \"${VERSION_RANGE}\"|g" "$app_pkg"
  done
done

# ── update root package.json name ────────────────────────────────────────────

info "Updating root package name…"
sed_inplace "s|\"name\": \"template\"|\"name\": \"${PROJECT_NAME}\"|g" package.json

# ── docker-compose and .env.example renames ──────────────────────────────────

info "Updating docker-compose and .env.example…"
if [ -f docker-compose.yml ]; then
  sed_inplace "s|POSTGRES_DB=template|POSTGRES_DB=${PROJECT_NAME}|g"   docker-compose.yml
  sed_inplace "s|^  template:|  ${PROJECT_NAME}:|g"                    docker-compose.yml
fi
if [ -f .env.example ]; then
  sed_inplace "s|APP_NAME=template|APP_NAME=${PROJECT_NAME}|g"                         .env.example
  sed_inplace "s|/template|/${PROJECT_NAME}|g"                                          .env.example
  sed_inplace "s|AI_DEFAULT_PROVIDER=anthropic|AI_DEFAULT_PROVIDER=${AI_PROVIDER}|g"   .env.example
  sed_inplace "s|AUTH_METHOD=magic-link|AUTH_METHOD=${AUTH_METHOD}|g"                  .env.example

  # PKI: comment out PKI vars when not using PKI
  if [[ "$AUTH_METHOD" != "pki" && "$AUTH_METHOD" != "pki-and-magic-link" ]]; then
    sed_inplace "s|^PKI_|# PKI_|g" .env.example
  else
    warning "PKI auth selected — set PKI_TRUSTED_PROXY_IPS in .env to your reverse proxy's IP(s)."
  fi

  if [ "$AUTH_METHOD" = "google-oauth" ]; then
    warning "google-oauth requires additional setup. See docs/guides/google-oauth.md."
  fi

  if [ "$LANGFUSE_ENABLED" = "n" ]; then
    info "Langfuse disabled — commenting keys in .env.example…"
    sed_inplace "s|^LANGFUSE_|# LANGFUSE_|g" .env.example
  fi
fi

# ── reset git history ─────────────────────────────────────────────────────────

info "Resetting git history…"
rm -rf .git
git init -q

info "Installing pre-commit hook (validate.sh)…"
mkdir -p .git/hooks
cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/sh
./validate.sh
HOOK
chmod +x .git/hooks/pre-commit

git add .
git commit -q -m "chore: initial commit from ai-app-template v${FRAMEWORK_VERSION}"

# ── copy env file ─────────────────────────────────────────────────────────────

if [ -f .env.example ] && [ ! -f .env ]; then
  info "Copying .env.example → .env…"
  cp .env.example .env
fi

# ── write version tracking files ─────────────────────────────────────────────

info "Writing .framework-scope and .template-version…"
echo "${FRAMEWORK_SCOPE}" > .framework-scope
echo "${FRAMEWORK_VERSION}" > .template-version

git add .framework-scope .template-version
git commit -q -m "chore: add template version tracking files"

# ── install dependencies ──────────────────────────────────────────────────────

info "Installing dependencies (pnpm install)…"
pnpm install

# ── typecheck (light validation — no DB required) ────────────────────────────

info "Running typecheck…"
if pnpm typecheck 2>&1; then
  info "Typecheck passed."
else
  echo
  warning "TypeScript errors detected. Review above, then run './validate.sh' once"
  warning "infrastructure is running (docker compose up -d)."
fi

# ── done ──────────────────────────────────────────────────────────────────────

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓ Project \"${PROJECT_NAME}\" is ready.${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "  Next steps:"
echo "    1. Fill in secrets in .env (DATABASE_URL, BETTER_AUTH_SECRET, AI keys)"
if [[ "$AUTH_METHOD" == "pki" || "$AUTH_METHOD" == "pki-and-magic-link" ]]; then
echo "    ★  Set PKI_TRUSTED_PROXY_IPS in .env to your reverse proxy's IP(s)"
fi
echo "    3. Start infrastructure:   docker compose up -d"
echo "    4. pnpm run db:migrate"
echo "    5. Start the app:          ./restart.sh"
echo "    6. Open the app:           http://localhost:3000"
echo "    7. Push to GitHub:         git remote add origin <url> && git push -u origin main"
echo
echo "  Once infrastructure is up, run ./validate.sh to confirm everything passes."
echo "  Admin login is seeded from ADMIN_SEED_EMAIL in .env."
echo
