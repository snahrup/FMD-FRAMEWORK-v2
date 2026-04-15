---
description: "Inspect the live FMD load watchdog snapshot, worker log tail, and latest pipeline-integrity truth."
argument-hint: "[--run-id RUN_ID]"
allowed-tools: Read, Grep, Bash(python C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/load_watchdog.py:*)
---

Refresh the watchdog artifacts first:

```!
python "C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/load_watchdog.py" status $ARGUMENTS
```

Then read these files if they exist:
- `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/artifacts/load-watchdog/status.md`
- `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/artifacts/load-watchdog/status.json`
- `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/artifacts/load-watchdog/worker-tail.log`
- `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/artifacts/pipeline-integrity.json`

Your job:
1. Summarize the current run state in plain English.
2. Call out the top blocking error, if one exists.
3. Distinguish between evidence from the worker log, structured task logs, and pipeline-integrity truth.
4. If the user is asking for triage or a fix, immediately move into diagnosis using the current evidence instead of asking for screenshots or copied logs.

Do not give a generic overview. Focus on what is broken now, what evidence proves it, and the next corrective action.
