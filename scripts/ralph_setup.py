"""Ralph Loop Setup Script — Python port for Windows compatibility.
Creates state file for in-session Ralph loop.

Usage:
  python ralph_setup.py "Your prompt here" [--max-iterations N] [--completion-promise "TEXT"]
"""
import sys
import os
from datetime import datetime, timezone
from pathlib import Path


def main():
    args = sys.argv[1:]
    prompt_parts = []
    max_iterations = 0
    completion_promise = "null"

    i = 0
    while i < len(args):
        if args[i] in ("-h", "--help"):
            print("""Ralph Loop - Interactive self-referential development loop

USAGE:
  python ralph_setup.py PROMPT [OPTIONS]

ARGUMENTS:
  PROMPT    The task prompt (quote if multi-word)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase to signal completion
  -h, --help                     Show this help message

EXAMPLES:
  python ralph_setup.py "Fix the Bronze pipeline" --completion-promise "DONE" --max-iterations 20
  python ralph_setup.py "Debug OneLake files" --max-iterations 10
""")
            sys.exit(0)
        elif args[i] == "--max-iterations":
            if i + 1 >= len(args):
                print("Error: --max-iterations requires a number", file=sys.stderr)
                sys.exit(1)
            try:
                max_iterations = int(args[i + 1])
            except ValueError:
                print(f"Error: --max-iterations must be an integer, got: {args[i+1]}", file=sys.stderr)
                sys.exit(1)
            i += 2
        elif args[i] == "--completion-promise":
            if i + 1 >= len(args):
                print("Error: --completion-promise requires text", file=sys.stderr)
                sys.exit(1)
            completion_promise = args[i + 1]
            i += 2
        else:
            prompt_parts.append(args[i])
            i += 1

    prompt = " ".join(prompt_parts)
    if not prompt:
        print("Error: No prompt provided", file=sys.stderr)
        print('  Example: python ralph_setup.py "Fix the Bronze pipeline" --max-iterations 20', file=sys.stderr)
        sys.exit(1)

    # Create state file
    claude_dir = Path(".claude")
    claude_dir.mkdir(exist_ok=True)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if completion_promise and completion_promise != "null":
        cp_yaml = f'"{completion_promise}"'
    else:
        cp_yaml = "null"

    state_content = f"""---
active: true
iteration: 1
max_iterations: {max_iterations}
completion_promise: {cp_yaml}
started_at: "{now}"
---

{prompt}
"""

    state_file = claude_dir / "ralph-loop.local.md"
    state_file.write_text(state_content, encoding="utf-8")

    # Output setup message
    max_str = str(max_iterations) if max_iterations > 0 else "unlimited"
    cp_str = f'{completion_promise} (ONLY output when TRUE - do not lie!)' if completion_promise != "null" else "none (runs forever)"

    print(f"""Ralph loop activated in this session!

Iteration: 1
Max iterations: {max_str}
Completion promise: {cp_str}

The stop hook is now active. When you try to exit, the SAME PROMPT will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively improve on the same task.

To monitor: check .claude/ralph-loop.local.md

WARNING: This loop cannot be stopped manually! It will run infinitely
    unless you set --max-iterations or --completion-promise.

{prompt}""")

    if completion_promise != "null":
        print(f"""
{'='*60}
CRITICAL - Ralph Loop Completion Promise
{'='*60}

To complete this loop, output this EXACT text:
  <promise>{completion_promise}</promise>

STRICT REQUIREMENTS (DO NOT VIOLATE):
  - Use <promise> XML tags EXACTLY as shown above
  - The statement MUST be completely and unequivocally TRUE
  - Do NOT output false statements to exit the loop
  - Do NOT lie even if you think you should exit

IMPORTANT - Do not circumvent the loop:
  Even if you believe you're stuck, the task is impossible,
  or you've been running too long - you MUST NOT output a
  false promise statement. The loop is designed to continue
  until the promise is GENUINELY TRUE. Trust the process.
{'='*60}""")


if __name__ == "__main__":
    main()
