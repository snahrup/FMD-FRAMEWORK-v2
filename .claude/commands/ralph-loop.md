---
description: "Start Ralph Wiggum loop in current session"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(python C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/ralph_setup.py:*)"]
---

# Ralph Loop Command

Execute the setup script to initialize the Ralph loop:

```!
python "C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/ralph_setup.py" $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

CRITICAL RULE: If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.

IMPORTANT: Before each iteration ends, save your findings and progress to memory files so you don't lose context:
- Update `C:\Users\sasnahrup\.claude\projects\c--Users-snahrup-CascadeProjects-FMD-FRAMEWORK\memory\bronze-pipeline-debugging.md` with new discoveries
- Create script files for any diagnostics you run so they can be re-run
- Commit working changes to git so they persist across iterations
