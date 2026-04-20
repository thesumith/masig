#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  for pid in $(jobs -p); do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

echo "Starting backend (http://127.0.0.1:8000) and frontend (http://localhost:3000)…"
echo "Press Ctrl+C to stop both."

(
  cd "$ROOT/backend"
  python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
) &

(
  cd "$ROOT/frontend"
  npm run dev
) &

wait
