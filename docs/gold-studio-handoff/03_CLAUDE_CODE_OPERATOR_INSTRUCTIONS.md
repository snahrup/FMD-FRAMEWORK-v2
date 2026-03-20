# Claude Code — Operator Instructions

Paste the opening prompt from `CLAUDE_OPENING_PROMPT.md` into Claude Code, then proceed packet by packet.

## Session rules

Tell Claude the following:

- The product spec is already decided.
- The implementation must follow the spec and packet scope.
- Claude may implement only one packet at a time.
- Claude must not redesign product behavior or information architecture.
- Claude may ask only narrowly scoped blocking questions tied to the current packet.
- Claude must return a packet completion report in the required format.

## Allowed questions

Claude is allowed to ask only things like:
- which existing file contains the main app sidebar
- which component library is already used in the repo
- where migrations live
- whether the existing job framework is FastAPI BackgroundTasks, Celery, RQ, or something custom
- whether Storybook already exists
- which route file registers `/gold/*`

Claude is **not** allowed to ask:
- “Should I rethink the layout?”
- “Would you prefer a wizard?”
- “Do you want me to simplify the provenance model?”
- “Can I merge these pages?”
- “Would a different schema be cleaner?”

## Required completion format

At the end of every packet, Claude must return:

1. **Summary of what was implemented**
2. **Files changed**
3. **Migrations added/updated**
4. **API routes added/updated**
5. **Components/pages added/updated**
6. **How to run or verify**
7. **Acceptance criteria status**
8. **Known risks / TODOs**
9. **Questions that remain genuinely blocking**

## Review gate

Stop after the packet.

Do not begin the next packet automatically.
