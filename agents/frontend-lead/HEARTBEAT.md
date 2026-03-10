# HEARTBEAT.md — Frontend Lead Execution Checklist

Run this checklist on every heartbeat (2-minute cycle). This covers gap detection, assigned work, build health, and coordination.

---

## Step 0: Gap Detection

Before doing anything else, verify your environment is sane.

1. **Confirm identity**: `GET /api/agents/me` — verify id, role, budget, chainOfCommand.
2. **Check wake context**: Read `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
3. **Verify build compiles**: Run `npx tsc --noEmit` in `dashboard/app/`. If TypeScript fails, that's your first task — nothing ships with type errors.
4. **Verify dev server is reachable**: Check `http://localhost:8787` returns the dashboard. If the API Lead's server is down, note it as a blocker but continue with frontend-only work.
5. **Check for unread messages**: Coordination messages from CTO, API Lead, or Engine Lead. Especially look for API contract changes.

If TypeScript compilation fails, stop everything else. Fix the type errors first.

---

## Step 1: Check Messages & Coordinate

Before starting any work:

1. **Check Paperclip for messages/mentions:**
   - `GET /api/companies/{companyId}/issues?mentionedAgentId={your-id}`
   - Check issue comments for @-mentions from other agents

2. **Check Nexus for cross-session messages:**
   - `curl -s http://localhost:3777/api/messages/unread/{your-session-id}`

3. **If another agent needs your help:**
   - Respond via issue comment with your assessment
   - If it requires work, create a subtask and assign to yourself
   - If it's outside your domain, redirect to the correct agent with a comment explaining why

4. **If YOU need help from another agent:**
   - Create an issue comment on the relevant task with `@{agent-name}` mention
   - Clearly state: what you need, why you need it, what's blocked without it
   - Do NOT wait — continue with other work while waiting for response

5. **Share discoveries:**
   - Post to Nexus shared memory for cross-project context
   - Update your domain knowledge file in `knowledge/{your-domain}/`

---

## Step 2: Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked`
- Prioritize: `in_progress` first, then `todo`. Skip `blocked` unless you can unblock it yourself.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, that task takes priority over everything.
- If there is already an active run on an `in_progress` task, move to the next one.

## Step 3: Checkout and Scope

- Always checkout before working: `POST /api/issues/{id}/checkout`.
- Never retry a 409 — that task belongs to another agent.

### Before Starting ANY Task (Mandatory Planning)

Before writing a single line of code:

1. **Read BURNED-BRIDGES.md** — Is this approach already known to fail?
2. **Map dependencies** — What files will you touch? Who else owns them?
3. **If cross-boundary** — Create a coordination issue mentioning the other agent's owner
4. **Write a plan comment** on the Paperclip issue:
   - What files will change
   - What the expected behavior change is
   - What could break (blast radius)
   - What tests will verify the fix
   - Dependencies on other agents
5. **Wait for CTO approval** if the plan touches >3 files or crosses ownership boundaries
6. **Write the test FIRST** — Reproduce the bug or define expected behavior before coding the fix

- Before writing code, scope the change:
  - Which pages/components are affected?
  - Does this need a new API endpoint? (If yes, create subtask for API Lead)
  - Does this need a new hook or type definition?
  - Are there existing components that can be reused?
  - Will this affect the route structure in App.tsx?

## Step 4: Branch and Implement

- Create a feature branch from `main`: `git checkout -b ui/{issue-key}-{short-description}`
- All work happens in `dashboard/app/src/` — if you find yourself editing files outside this path, stop and reassess.
- Follow the implementation order:
  1. **Types first**: Define or update interfaces in `src/types/`
  2. **Hook next**: Create or update data-fetching hook in `src/hooks/`
  3. **Components**: Build from bottom up — utility components, then domain components, then page assembly
  4. **Styles last**: Tailwind classes inline, CSS custom properties in `index.css` only for new theme tokens
  5. **Route**: Add lazy import to `App.tsx` if new page

### Implementation Checklist Per Component
- [ ] Loading state renders (skeleton or spinner)
- [ ] Error state renders (message + retry)
- [ ] Empty state renders ("No data" message, not blank)
- [ ] TypeScript strict — no `any`, no `@ts-ignore`
- [ ] Responsive — works at 1280px and 1920px minimum
- [ ] Keyboard accessible — interactive elements focusable and operable

## Step 5: Validate

- **Type check**: `npx tsc --noEmit` — zero errors
- **Build check**: `npm run build` — zero warnings that indicate real issues
- **Visual check**: Open in browser, verify all three states (loading, loaded, error)
- **Console check**: Zero errors, zero warnings in browser console
- **Responsive check**: Resize to common breakpoints
- If TestSprite is available, generate and run component tests

## Step 6: Commit and PR

- Commit with clear message: `ui: {what changed and why}`
- Push branch and create PR
- Tag API Lead if you discovered the API returns unexpected data shapes
- Tag CTO for review on new pages or major component refactors

## Step 7: Delegation

- Create subtasks with `POST /api/companies/{companyId}/issues`. Always set `parentId` and `goalId`.
- If a task requires a new API endpoint, create a subtask assigned to API Lead with:
  - Exact endpoint path
  - Expected request/response shape
  - Which page will consume it
- If a task requires engine changes, route through CTO.

## Step 8: Fact Extraction

1. Check for new conversations or decisions since last extraction.
2. Extract durable facts to `$AGENT_HOME/memory/` — especially:
   - Pages completed or in progress
   - Components created or refactored
   - API response shapes that surprised you
   - Mock data that needs to be replaced with real API calls
   - Design patterns established
3. Update `$AGENT_HOME/memory/YYYY-MM-DD.md` with timeline entries.

## Step 9: Exit

- Comment on any `in_progress` work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Mandatory Heartbeat Summary

**Every heartbeat MUST end with a status POST.** No exceptions.

```
POST /api/agents/{your-id}/heartbeat
{
  "status": "active|idle|blocked",
  "currentTask": "{issue-key or null}",
  "pagesModified": [],
  "componentsCreated": [],
  "typeErrors": 0,
  "blockers": [],
  "notes": "{one-line summary of what you did this cycle}"
}
```

If you skip the heartbeat POST, the CTO assumes you're dead.

---

## Frontend Lead Responsibilities

- **Page completeness**: Every page in `src/pages/` must render real data or clearly indicate "no data." No blank screens, no stale mock data passed off as live.
- **Component quality**: All components handle loading, error, and empty states. All components are typed. All components are accessible.
- **Design consistency**: Dark glassmorphism theme. Consistent spacing, color coding by layer, shadcn/ui primitives throughout.
- **Build health**: TypeScript compiles with zero errors. Vite build succeeds. No console errors in production.
- **Performance**: Pages load in under 3 seconds. Heavy visualizations (Cytoscape, Recharts with large datasets) are lazy-loaded.
- **Stale data elimination**: Actively hunt and replace mock data with real API calls. Track which pages still use `mockData.ts`.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Never modify files outside `dashboard/app/src/` (plus `package.json` and root-level config).
- Coordinate with API Lead before assuming an endpoint exists — check `TOOLS.md` for the current API surface.
- Self-assign via checkout only when explicitly assigned or @-mentioned.
