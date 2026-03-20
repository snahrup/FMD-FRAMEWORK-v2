# Gold Studio — Claude Code Handoff Bundle

This bundle is designed to keep Claude Code tightly scoped and prevent a single agent from trying to solve the entire Gold Studio product in one overloaded pass.

## What is in this bundle

- `00_GOLD_STUDIO_FINAL_SPEC.md` — the authoritative product/design/backend specification
- `01_IMPLEMENTATION_PLAYBOOK.md` — how Claude should work against the spec
- `02_GUARDRAILS_AND_INVARIANTS.md` — non-negotiable implementation rules
- `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md` — copy-ready instructions for the Claude session
- `04_PACKET_INDEX_AND_SEQUENCE.md` — the recommended build order
- `PACKET_01_*` through `PACKET_05_*` — the first implementation packets
- `REVIEW_GATE_TEMPLATE.md` — what Claude must return at the end of each packet
- `CLAUDE_OPENING_PROMPT.md` — the first prompt to paste into Claude Code

## How to use this bundle

1. Give Claude Code the final spec and the operator instructions.
2. Tell Claude it may only execute one packet at a time.
3. Start with `PACKET_01_FOUNDATION_SHELL_AND_DESIGN_SYSTEM.md`.
4. Require Claude to return the review gate output after completing the packet.
5. Bring the result back for review before moving to the next packet.

## Important working rule

Claude is implementing a decided system, not inventing a new one.

The bundle is intentionally repetitive in a few places. That is on purpose. Repetition reduces drift.

## Initial recommendation

Do **not** ask Claude to do packets 1–5 in one run.

Start with:
- Packet 01
- review
- then Packet 02
- review
- then continue

## Expected outcome

This workflow should produce:
- tighter architectural consistency
- less speculative redesign
- fewer unrelated refactors
- smaller review surfaces
- clearer acceptance criteria
