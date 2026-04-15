---
description: "Start, resume, retry, or watch the FMD load watchdog so load runs stay observable without manual screenshot/log copying."
argument-hint: "[start|resume|retry-failed|watch|status|cleanup] [--sources CSV] [--layers CSV] [--mode run|bulk] [--detach-watch]"
allowed-tools: Read, Grep, Bash(python C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/load_watchdog.py:*)
---

Run the FMD load watchdog with the provided arguments:

```!
python "C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/scripts/load_watchdog.py" $ARGUMENTS
```

After the command finishes:
1. Read `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/artifacts/load-watchdog/status.md`.
2. Report the active run ID, run status, current layer, latest integrity posture, and any fresh failure evidence.
3. If the command started or resumed a run in foreground watch mode, treat the final watchdog result as authoritative and say whether the run finished cleanly or not.
4. If the command used `--detach-watch`, explicitly tell the user that the detached watcher is writing fresh artifacts and that `/log` will inspect them later.

If the user did not provide arguments, default to `status`.
