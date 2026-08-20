#!/bin/bash
# PostToolUse hook: auto-format/lint the file that was just written/edited.
# Reads the Claude Code hook payload (JSON) from stdin.

set -u

payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

PROJECT_ROOT="/home1/junlee/ev_auto_pipeline"

case "$file" in
  "$PROJECT_ROOT"/frontend/*.ts|"$PROJECT_ROOT"/frontend/*.tsx)
    (cd "$PROJECT_ROOT/frontend" && npx eslint --fix "$file") >/dev/null 2>&1
    ;;
  "$PROJECT_ROOT"/*.py)
    "$PROJECT_ROOT/venv/bin/ruff" format "$file" >/dev/null 2>&1
    "$PROJECT_ROOT/venv/bin/ruff" check --fix "$file" >/dev/null 2>&1
    ;;
esac

exit 0
