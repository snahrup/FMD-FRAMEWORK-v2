"""Ralph Wiggum Stop Hook — Python port for Windows compatibility.
Prevents session exit when a ralph-loop is active.
Feeds Claude's output back as input to continue the loop.
"""
import json
import re
import sys
import os
from pathlib import Path

def main():
    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, Exception):
        # Can't parse hook input — allow exit
        sys.exit(0)

    # Check if ralph-loop is active
    state_file = Path(".claude/ralph-loop.local.md")
    if not state_file.exists():
        # No active loop — allow exit
        sys.exit(0)

    content = state_file.read_text(encoding="utf-8")

    # Parse YAML frontmatter (between --- markers)
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
    if not fm_match:
        print("Warning: Ralph loop state file corrupted (no frontmatter)", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    frontmatter_text = fm_match.group(1)
    prompt_text = fm_match.group(2).strip()

    # Parse frontmatter fields
    def get_fm(key, default=""):
        m = re.search(rf'^{key}:\s*(.+)$', frontmatter_text, re.MULTILINE)
        if m:
            val = m.group(1).strip()
            # Strip surrounding quotes
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1]
            return val
        return default

    iteration_str = get_fm("iteration", "0")
    max_iterations_str = get_fm("max_iterations", "0")
    completion_promise = get_fm("completion_promise", "null")

    # Validate numeric fields
    try:
        iteration = int(iteration_str)
    except ValueError:
        print(f"Warning: Ralph loop iteration is not a number: {iteration_str}", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    try:
        max_iterations = int(max_iterations_str)
    except ValueError:
        print(f"Warning: Ralph loop max_iterations is not a number: {max_iterations_str}", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    # Check max iterations
    if max_iterations > 0 and iteration >= max_iterations:
        print(f"Ralph loop: Max iterations ({max_iterations}) reached.")
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    # Get transcript path from hook input
    transcript_path = hook_input.get("transcript_path", "")
    if not transcript_path or not Path(transcript_path).exists():
        print(f"Warning: Transcript file not found: {transcript_path}", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    # Read last assistant message from transcript (JSONL format)
    last_assistant_text = ""
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("role") == "assistant" or (
                        entry.get("message", {}).get("role") == "assistant"
                    ):
                        # Extract text content
                        msg = entry.get("message", entry)
                        content_parts = msg.get("content", [])
                        if isinstance(content_parts, str):
                            last_assistant_text = content_parts
                        elif isinstance(content_parts, list):
                            texts = [p.get("text", "") for p in content_parts if isinstance(p, dict) and p.get("type") == "text"]
                            if texts:
                                last_assistant_text = "\n".join(texts)
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"Warning: Failed to read transcript: {e}", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    if not last_assistant_text:
        print("Warning: No assistant text found in transcript", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    # Check for completion promise
    if completion_promise and completion_promise != "null":
        promise_match = re.search(r'<promise>(.*?)</promise>', last_assistant_text, re.DOTALL)
        if promise_match:
            promise_text = promise_match.group(1).strip()
            # Normalize whitespace for comparison
            promise_normalized = re.sub(r'\s+', ' ', promise_text)
            target_normalized = re.sub(r'\s+', ' ', completion_promise)
            if promise_normalized == target_normalized:
                print(f"Ralph loop: Detected <promise>{completion_promise}</promise>")
                state_file.unlink(missing_ok=True)
                sys.exit(0)

    # Not complete — continue loop
    if not prompt_text:
        print("Warning: No prompt text in state file", file=sys.stderr)
        state_file.unlink(missing_ok=True)
        sys.exit(0)

    next_iteration = iteration + 1

    # Update iteration in state file
    updated_content = re.sub(
        r'^iteration:\s*\d+',
        f'iteration: {next_iteration}',
        content,
        count=1,
        flags=re.MULTILINE
    )
    state_file.write_text(updated_content, encoding="utf-8")

    # Build system message
    if completion_promise and completion_promise != "null":
        system_msg = f"Ralph iteration {next_iteration} | To stop: output <promise>{completion_promise}</promise> (ONLY when statement is TRUE - do not lie to exit!)"
    else:
        system_msg = f"Ralph iteration {next_iteration} | No completion promise set - loop runs infinitely"

    # Output JSON to block the stop and feed prompt back
    result = {
        "decision": "block",
        "reason": prompt_text,
        "systemMessage": system_msg
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
