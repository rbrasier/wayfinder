#!/usr/bin/env bash
#
# Compiles the routes in warm-routes.txt before the suite runs.
#
# CI serves the app with `next dev`, so each route compiles on its first request
# and the spec that gets there first pays for it inside a wait that was never
# sized for a compile (/flows/[id]/config has taken 61s). Which spec that is
# moves whenever the suite is resharded, so the compile is paid here, once, and
# not by whoever happens to arrive first.
#
# Page routes sit behind the auth middleware, which redirects an anonymous
# request before the page compiles, so requests carry a test session. Any
# status is fine — a 404 for the placeholder id or a 400 for an empty body still
# means the route compiled — except a redirect, which means nothing did.

set -euo pipefail

base_url="${BASE_URL:-http://localhost:3000}"
admin_email="${TEST_ADMIN_EMAIL:-admin@example.com}"
routes_file="$(dirname "$0")/warm-routes.txt"
placeholder_id="00000000-0000-4000-8000-000000000000"

session_token="$(
  curl -fsS -X POST "$base_url/api/auth/test-session" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$admin_email\"}" | jq -er .token
)"

grep -vE '^\s*(#|$)' "$routes_file" | while read -r method path; do
  url="$base_url${path//:id/$placeholder_id}"
  result="$(
    curl -sS -o /dev/null --max-time 300 -X "$method" \
      -H "Cookie: better-auth.session_token=$session_token" \
      -w '%{http_code} %{time_total}' "$url"
  )"
  status="${result%% *}"
  echo "$method $path -> $status in ${result##* }s"
  if [[ "$status" == 3* ]]; then
    echo "::error::$method $path was redirected, so it was never compiled — is the test session being refused?"
    exit 1
  fi
done
