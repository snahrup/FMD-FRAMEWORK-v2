---
description: "Cancel active Ralph Wiggum loop"
allowed-tools: ["Bash(python -c *:*)", "Read(.claude/ralph-loop.local.md)"]
---

# Cancel Ralph

To cancel the Ralph loop:

1. Check if `.claude/ralph-loop.local.md` exists by reading it
2. **If file not found**: Say "No active Ralph loop found."
3. **If file exists**:
   - Read the current iteration number from the `iteration:` field
   - Delete the file using: `python -c "from pathlib import Path; Path('.claude/ralph-loop.local.md').unlink()"`
   - Report: "Cancelled Ralph loop (was at iteration N)" where N is the iteration value
