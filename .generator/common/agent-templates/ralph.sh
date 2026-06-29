#!/usr/bin/env sh
set -eu

AGENT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INTERVAL="${RALPH_INTERVAL_SECONDS:-10}"
RUNTIME="${RALPH_RUNTIME:-codex}"

echo "[ralph] runtime=${RUNTIME} interval=${INTERVAL}s"
echo "[ralph] tasks=${AGENT_DIR}/tasks.json"

while true; do
  if [ "${RALPH_SYNC_PLANNED:-0}" = "1" ]; then
    node "$AGENT_DIR/sync-planned-slices.js" || true
  fi

  case "$RUNTIME" in
    claude)
      node "$AGENT_DIR/ralph-claude.js"
      ;;
    opencode)
      node "$AGENT_DIR/ralph-opencode.js"
      ;;
    codex|*)
      node "$AGENT_DIR/ralph-codex.js"
      ;;
  esac
  sleep "$INTERVAL"
done
