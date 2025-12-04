#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MCP_URL_DEFAULT="http://127.0.0.1:9090/mcp"
HEALTH_URL_DEFAULT="${MCP_URL_DEFAULT%/mcp}/health"
SOLIDITYSCAN_API_KEY_DEFAULT="DUMMY_API_TOKEN"
TIMEOUT_DEFAULT=60

usage() {
  cat <<USAGE
SolidityScan MCP integration harness

Environment overrides:
  MCP_URL                 MCP endpoint (default: ${MCP_URL_DEFAULT})
  HEALTH_URL              Health endpoint (default: derived from MCP_URL)
  SOLIDITYSCAN_API_KEY    API token forwarded to scan tools
  WAIT_TIMEOUT            Seconds to wait for a healthy service (default: ${TIMEOUT_DEFAULT})

Example:
  MCP_URL=http://localhost:9090/mcp SOLIDITYSCAN_API_KEY=real_token \\
    ./scripts/integration-test.sh
USAGE
}

if [[ "${1:-}" =~ ^(-h|--help)$ ]]; then
  usage
  exit 0
fi

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "❌ Missing dependency: $bin" >&2
    exit 1
  fi
}

require_bin curl
require_bin node

MCP_URL="${MCP_URL:-$MCP_URL_DEFAULT}"
HEALTH_URL="${HEALTH_URL:-${MCP_URL%/mcp}/health}"
SOLIDITYSCAN_API_KEY="${SOLIDITYSCAN_API_KEY:-$SOLIDITYSCAN_API_KEY_DEFAULT}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-$TIMEOUT_DEFAULT}"

echo "🔎 Running SolidityScan MCP integration checks"
echo "   MCP endpoint: $MCP_URL"
echo "   Health check: $HEALTH_URL"
echo "   Wait timeout: ${WAIT_TIMEOUT}s"

wait_for_health() {
  local deadline=$((SECONDS + WAIT_TIMEOUT))
  until curl -fsS "$HEALTH_URL" >/tmp/solidityscan-health.json; do
    if (( SECONDS >= deadline )); then
      echo "❌ Service failed health check within ${WAIT_TIMEOUT}s" >&2
      exit 1
    fi
    sleep 2
  done
}

echo -n "1) Waiting for healthy service ... "
wait_for_health
echo "ok"

echo "2) Exercising MCP flows via mcp-test.js"
MCP_URL="$MCP_URL" SOLIDITYSCAN_API_KEY="$SOLIDITYSCAN_API_KEY" node mcp-test.js

echo "✅ Integration test run complete"

