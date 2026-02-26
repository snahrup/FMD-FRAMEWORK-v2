"""Ralph Loop Discipline Hook — UserPromptSubmit hook for FMD_FRAMEWORK.

Reads memory/shared_agent_log.md and outputs:
1. Current file locks (so agent doesn't stomp on Antigravity's work)
2. Reminder to save findings after every significant discovery
3. Current pipeline status if recently checked

This hook is TEMPORARY — disable after Ralph loop completes.
"""
import sys
import os
import json

def main():
    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except:
        hook_input = {}

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    shared_log = os.path.join(project_root, "memory", "shared_agent_log.md")

    # Read file locks from shared log
    locks = []
    if os.path.exists(shared_log):
        with open(shared_log, "r", encoding="utf-8") as f:
            content = f.read()
        # Extract file locks section
        in_locks = False
        for line in content.split("\n"):
            if "## Active File Locks" in line:
                in_locks = True
                continue
            if in_locks and line.startswith("## "):
                break
            if in_locks and line.startswith("- ") and "None" not in line:
                locks.append(line.strip("- ").strip())

    # Build reminder message
    parts = []
    if locks:
        parts.append("FILE LOCKS ACTIVE: " + ", ".join(locks) + " — DO NOT modify these files!")
    else:
        parts.append("No file locks active.")

    parts.append("RALPH DISCIPLINE: After every significant discovery, update memory/bronze-pipeline-debugging.md AND memory/shared_agent_log.md.")
    parts.append("Before modifying any file in src/ or scripts/, check memory/shared_agent_log.md Active File Locks section.")

    # Output as JSON
    output = {
        "decision": "allow",
        "systemMessage": " | ".join(parts)
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
