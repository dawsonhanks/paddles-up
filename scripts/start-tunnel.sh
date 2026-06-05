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
BIN_DIR="$ROOT/.bin"
CF_BIN=""

resolve_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    CF_BIN="$(command -v cloudflared)"
    return 0
  fi
  if [[ -x "$BIN_DIR/cloudflared" ]]; then
    CF_BIN="$BIN_DIR/cloudflared"
    return 0
  fi
  return 1
}

download_cloudflared() {
  mkdir -p "$BIN_DIR"
  local arch url tmp
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" ;;
    x86_64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" ;;
    *)
      echo "Unsupported architecture for auto-download: $arch"
      echo "Install cloudflared manually: brew install cloudflared"
      return 1
      ;;
  esac
  echo "Downloading cloudflared ($arch) ..."
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/cloudflared.tgz"
  tar -xzf "$tmp/cloudflared.tgz" -C "$tmp"
  mv "$tmp/cloudflared" "$BIN_DIR/cloudflared"
  chmod +x "$BIN_DIR/cloudflared"
  rm -rf "$tmp"
  CF_BIN="$BIN_DIR/cloudflared"
}

if ! resolve_cloudflared; then
  download_cloudflared || exit 1
fi

LOG="$(mktemp)"
cleanup() {
  [[ -n "${CF_PID:-}" ]] && kill "$CF_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare tunnel to http://127.0.0.1:${PORT} ..."
"$CF_BIN" tunnel --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
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
