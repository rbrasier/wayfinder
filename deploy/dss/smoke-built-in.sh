#!/usr/bin/env bash
# Checks the built-in signing engines inside the default Wayfinder image
# (ADR-069): LibreOffice converts to PDF/A, and the image's own Java runtime
# runs the DSS engine on loopback well enough to pass the full signing smoke
# test against the mocks server.
#
#   docker run --rm --network host -e MOCKS_URL=http://localhost:4001 \
#     wayfinder:ci bash /app/deploy/dss/smoke-built-in.sh
set -euo pipefail

MOCKS_URL="${MOCKS_URL:-http://localhost:4001}"
JAVA="${SIGNING_ENGINE_JAVA:-/opt/wayfinder/jre/bin/java}"
JAR="${SIGNING_ENGINE_JAR:-/opt/wayfinder/dss/wayfinder-dss.jar}"
SOFFICE="${PDF_CONVERTER_SOFFICE:-soffice}"
PORT="${SMOKE_ENGINE_PORT:-18085}"
work="$(mktemp -d)"
trap 'kill "${engine_pid:-0}" 2>/dev/null || true; rm -rf "$work"' EXIT

echo "Wayfinder built-in converter check" > "$work/check.txt"
"$SOFFICE" --headless --norestore "-env:UserInstallation=file://$work/profile" \
  --convert-to 'pdf:writer_pdf_Export:{"SelectPdfVersion":{"type":"long","value":"2"}}' \
  --outdir "$work" "$work/check.txt" > /dev/null
grep -aq "pdfaid:part" "$work/check.pdf"
echo "ok - the built-in converter produces PDF/A"

PORT="$PORT" BIND_ADDRESS=127.0.0.1 DSS_ENVIRONMENT=development \
  SIGNING_TRUST_MOCK_CA="$MOCKS_URL/csc/test-ca.pem" TRUST_ANCHORS_DIR="$work/no-trust" \
  "$JAVA" -Xmx384m -jar "$JAR" &
engine_pid=$!

node -e '
  const url = process.argv[1];
  const deadline = Date.now() + 60_000;
  const poll = async () => {
    try { if ((await fetch(url)).ok) return; } catch {}
    if (Date.now() > deadline) { console.error("the built-in engine did not start"); process.exit(1); }
    setTimeout(poll, 500);
  };
  poll();
' "http://127.0.0.1:$PORT/health"
echo "ok - the built-in signature engine starts on loopback"

MOCKS_URL="$MOCKS_URL" DSS_URL="http://127.0.0.1:$PORT" node "$(dirname "$0")/smoke-test.mjs"
