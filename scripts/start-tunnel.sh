#!/usr/bin/env bash
# Expo's built-in `--tunnel` uses @expo/ngrok with ngrok v2, which often fails with:
#   TypeError: Cannot read properties of undefined (reading 'body')
# This script uses Cloudflare's quick tunnel instead (no account required).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPO_MODE=(--go --lan)
if [[ "${1:-}" == "--dev-client" ]]; then
  EXPO_MODE=(--dev-client --lan)
fi

PORT="${EXPO_PORT:-8081}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed."
  echo ""
  echo "Install it, then run this script again:"
  echo "  brew install cloudflared"
  echo ""
  echo "If your phone and Mac are on the same Wi‑Fi, use LAN mode instead:"
  echo "  npm start"
  exit 1
fi

LOG="$(mktemp)"
cleanup() {
  [[ -n "${CF_PID:-}" ]] && kill "$CF_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare tunnel to http://127.0.0.1:${PORT} ..."
cloudflared tunnel --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
CF_PID=$!

TUNNEL_URL=""
for _ in $(seq 1 45); do
  TUNNEL_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo "cloudflared exited unexpectedly:"
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Timed out waiting for tunnel URL. cloudflared log:"
  cat "$LOG"
  exit 1
fi

echo "Tunnel ready: $TUNNEL_URL"
echo "Starting Expo (QR code will use the public URL) ..."
export EXPO_PACKAGER_PROXY_URL="$TUNNEL_URL"
exec npx expo start "${EXPO_MODE[@]}"
