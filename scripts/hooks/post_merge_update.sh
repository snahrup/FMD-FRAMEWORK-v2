#!/bin/bash
# Post-merge hook: regenerates Packet Command Center after `gh pr merge`
# Triggered by Claude Code PostToolUse hook on Bash commands
#
# Reads tool_input from stdin JSON, checks if command contains "gh pr merge".
# If so, regenerates the dashboard, commits, and pushes.

set -e

INPUT=$(cat)

# Only trigger on merge commands
if ! echo "$INPUT" | grep -q "gh pr merge"; then
  exit 0
fi

# Only trigger on successful merges (check exit code in result)
if echo "$INPUT" | grep -q '"Exit code 1"'; then
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "[hook] PR merge detected — regenerating Packet Command Center..."

python scripts/update_command_center.py

# Check if the HTML actually changed
if git diff --quiet docs/PACKET_COMMAND_CENTER.html 2>/dev/null; then
  echo "[hook] No changes to dashboard."
  exit 0
fi

git add docs/PACKET_COMMAND_CENTER.html
git commit -m "$(cat <<'COMMITEOF'
chore: auto-update Packet Command Center after PR merge

Author: Steve Nahrup
COMMITEOF
)"

git push origin HEAD 2>/dev/null || echo "[hook] Push skipped (no remote tracking or auth issue)"

echo "[hook] Packet Command Center updated and pushed."
