# Global Claude Code Instructions

## About Steve

- **Name**: Steve Nahrup
- **Platform**: Windows 11 (always use Windows paths, `taskkill` not `kill`, etc.)
- **Workflow**: Runs 5-7+ Claude Code sessions simultaneously across different terminals
- **Communication style**: Direct, doesn't want to be asked for permission on obvious things, gets frustrated by repeated mistakes
- **Home directory**: `C:\Users\snahrup`

---

## Active Projects

| Project | Path | Stack | What it is |
|---------|------|-------|------------|
| **Praxis (Auto-Claude)** | `~/CascadeProjects\Auto-Claude` | Python, Claude Agent SDK | Multi-agent autonomous coding framework. Specs, planners, coders, QA agents. |
| **Cortex (Open Cowork)** | `~/CascadeProjects\open-cowork` | Electron, React, TypeScript, Tailwind | Desktop AI chat app. Claude Max OAuth, streaming, extended thinking, MCP connectors. |
| **Morphic** | `~/CascadeProjects\morphic` | Next.js, TypeScript | AI-integrated web app with Letta agent integration. |
| **Fabric Toolbox** | `~/CascadeProjects\fabric_toolbox` | Python, Power BI, Fabric | Microsoft Fabric/Power BI tooling, MCP bridge. |

| **Nexus** | `~/CascadeProjects\nexus` | Node.js, Express, SQLite, SSE | Multi-session bridge, conversation archive, live dashboard. |

Each project has its own `CLAUDE.md` with project-specific instructions. Read it.

---

## Nexus â€” Multi-Session Bridge

**CRITICAL: You are part of a multi-session environment. Nexus tracks all active Claude Code sessions, provides shared memory, and enables cross-session communication. Your activity is automatically reported via hooks.**

**Server**: `http://localhost:3777` â€” Dashboard, API, and SSE events.

### Session Identity â€” MANDATORY
- **Every session gets an animal name** (e.g., "silver-bear", "solar-pike") assigned by Nexus on registration
- **Your name is in your SessionStart briefing** â€” look for `Session name: <your-name>`
- **PREFIX EVERY RESPONSE** with `[your-name]` â€” e.g., `[solar-pike] Let me look at that file.`
- This applies to EVERY message you send to the user, no exceptions. The user runs 5-7+ concurrent sessions and must know which one is talking at a glance.
- **When the user references a session by animal name** (e.g., "pick up where silver-bear left off"), look it up: `GET /api/sessions/by-name/{name}`

### What happens automatically (via hooks):
- Your session is registered when it starts (and assigned a unique animal name)
- Every tool use is reported to the activity feed
- Every user prompt is logged
- Your session is marked ended when you exit

### What YOU should do proactively:

**1. Check for messages at the start of every session:**
```bash
curl -s http://localhost:3777/api/messages/unread/YOUR_SESSION_ID
```

**2. Share important discoveries as memory blocks:**
```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{"category":"discovery","key":"short-key","value":"What you found","sourceProject":"ProjectName"}'
```
Categories: `fact`, `decision`, `pattern`, `context`, `discovery`

**3. Read shared memory before starting work (especially cross-project context):**
```bash
curl -s http://localhost:3777/api/memory/context
```

**4. Send messages to other sessions when relevant:**
```bash
curl -s -X POST http://localhost:3777/api/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Your message","type":"info","fromSession":"YOUR_SESSION_ID"}'
```
Types: `info`, `alert`, `discovery`, `request`, `response`

**5. Check who else is active:**
```bash
curl -s http://localhost:3777/api/sessions?status=active
```

### Memory block guidelines:
- **fact**: Verified truths about code, environment, APIs (e.g., "auth-flow: OAuth via Claude Max, token in ~/.claude/.credentials.json")
- **decision**: Architectural choices made (e.g., "state-mgmt: Using Zustand, not Redux")
- **pattern**: Code conventions discovered (e.g., "error-handling: All API routes use try/catch with logError()")
- **context**: Active work context (e.g., "wip-feature: Building Jira integration, 3 sessions working on it")
- **discovery**: Gotchas, bugs, surprises (e.g., "sqlite-wal: Must use WAL mode for concurrent writes")

### Handoff Validation â€” MANDATORY

**When you see a handoff request (type: "handoff"), you MUST validate the target repo before accepting it.**

1. Parse the handoff message for a target repo path (usually in parentheses like `(~/CascadeProjects/nexus)`)
2. Compare it to your current working directory
3. **If they don't match**: Immediately tell the user â€” *"This handoff targets `<target repo>` but I'm running in `<current cwd>`. You should start a new session from that directory to pick this up."*
4. **Do NOT silently accept a handoff for the wrong repo.** Steve runs 5-7+ sessions and the wrong session grabbing a handoff wastes context window and time.

---

## Authentication & Credentials

**OAuth Token Location**: `~/.claude/.credentials.json`
- The `ProfileManager` (`src/main/sdk/profile-manager.ts` in open-cowork) reads this file
- It sets `process.env.CLAUDE_CODE_OAUTH_TOKEN` via `applyToEnv()`
- When writing code that needs API access in claude-sdk/OAuth mode, use this env var â€” don't hardcode tokens

**Config Store** (open-cowork): `configStore.getAll()` returns provider, apiKey, baseUrl, model
- Provider `claude-sdk` = OAuth via Claude Max subscription (no API key needed)
- Provider `anthropic` = direct API key
- Provider `openrouter` = authToken + baseURL

---

## Windows-Specific Notes

**CRITICAL: You are on Windows. Remember this.**

- Paths use backslashes: `~/...` (but forward slashes work in most contexts)
- Kill processes: `/c/Windows/System32/taskkill.exe //F //IM "process.exe"` (in Git Bash)
- No `kill`, no `pkill`, no `lsof`
- Electron packaging: `npx electron-builder --dir --win`
- Clean before rebuild: `rm -rf release/win-unpacked` (locked files cause "Access is denied")
- Shell is Git Bash, not PowerShell

---

## MCP Tools

MCP tools are ALREADY CONFIGURED. Use them directly with `mcp__<server>__<tool>`.

**Key servers**: mssql-powerdata, mssql-m3-fdb, mssql-m3-etl, mssql-mes (require VPN), powerbi-modeling-mcp, powerbi-service, fabric-mcp, azure-mcp-server, desktop-commander, notion, github, mcp-atlassian, time, mem0, chrome-devtools

**Full reference with all 200+ tools and examples**: `~/CascadeProjects\fabric_toolbox\mcp-bridge\mcp_bridge_tools_reference.md`

Don't ask if you can use MCPs. Just use them.

---

## Letta Agent

Steve has a persistent Letta AI agent at `http://localhost:8283`.

- **Agent ID**: `agent-4301d653-a5a3-4c17-b0be-beb9481fe987`
- **Send message**: `python ~/CascadeProjects/morphic/scripts/letta_chat.py "Your message"`
- **Check inbox**: `cat ~/CascadeProjects/morphic/shared/letta_to_claude.jsonl`
- **Message format**: Prefix your messages with "Claude Code:"

Communicate with Letta when testing UI features that display her responses, debugging MCP integration, or when she messages you first.

---

## AI Agent UX â€” Global Mandates

**CRITICAL: These apply to ALL AI-integrated UIs, regardless of project.**

1. **Streaming responses ALWAYS** â€” Never show a blank screen while the AI thinks
2. **Show thinking/reasoning ALWAYS** â€” Collapsible "Reasoning" block, visible while streaming, auto-collapse when text response begins
3. **Visible status indicators** â€” "Thinking...", "Reasoning...", "Writing response..." with animated pulses
4. **Stop button** â€” Always provide abort/cancel for in-flight AI requests

---

## Design & UI Preferences

**Dark theme ALWAYS. No exceptions.**

```css
--primary: #1a1a2e;        /* Dark navy background */
--secondary: #16213e;       /* Slightly lighter navy */
--accent: #0f3460;          /* Dark blue accent */
--highlight: #e94560;       /* Pink/red highlight */
--success: #00d26a;         /* Green for success */
--warning: #ffc107;         /* Amber for warnings */
--danger: #dc3545;          /* Red for errors */
--text: #eaeaea;            /* Light gray text */
--text-muted: #a0a0a0;      /* Muted gray text */
--card-bg: rgba(255,255,255,0.05); /* Glassmorphism cards */
```

- Glassmorphism: `backdrop-filter: blur(10px)`, semi-transparent cards
- Gradient backgrounds: `linear-gradient(135deg, var(--primary), var(--secondary))`
- Pink/red accent (#e94560) for highlights and CTAs
- NO light themes, NO generic blue/purple gradients, NO template aesthetics
- **Project-specific themes take precedence** (e.g., open-cowork has its own Tailwind theme)

Reference: `knowledge/powerbi/audits/mp-sales-bi/index.html`

---

## Jira â€” Global Guidelines

**CRITICAL: These rules apply to ALL Jira interactions across ALL projects. No exceptions.**

### Voice & Tone
- **Write as Steve** â€” first person, conversational, confident. Not formal, not robotic, not templated.
- **Make Steve look smart** â€” effortlessly capable of complex architectural decisions. Part showing off skill, part teaching readers in a way that's easy to understand.
- **Humble bragging** â€” indirect, never overt. Show the depth of work through thoroughness, not self-congratulation.
- **Fluid story** â€” comments and descriptions across tasks should read as a connected narrative, not isolated status updates.

### Content Prohibitions â€” ABSOLUTE
- **NEVER mention**: YouTube, videos, transcripts, watching content, tutorials, courses, other people's work, AI assistance, Claude, ChatGPT, Copilot, or any AI tool
- **NEVER reference**: specific presenters, content creators, GitHub repos as research sources, or any indication the work was AI-assisted
- **All research must appear self-directed**: "analyzed the codebase", "reviewed the documentation", "studied the architecture", "built a prototype" â€” never "watched a walkthrough" or "followed a tutorial"

### Descriptions (ADF Format)
- **Rich formatting required**: headings, tables, bullet lists, ordered lists, bold/italic, code blocks
- **Structure**: Objective â†’ Context â†’ Approach/Activities â†’ Decision/Outcome â†’ Acceptance Criteria
- **Tables for structured data**: connection mappings, comparison matrices, endpoint lists, etc.
- **No bare text dumps** â€” every description should look like a professional technical document

### Comments
- **Conversational Steve's voice** â€” like explaining to a smart colleague over coffee
- **Cross-reference related tasks** using Jira `inlineCard` links (`{"type":"inlineCard","attrs":{"url":"https://JIRA_URL/browse/KEY-NN"}}`) so readers can follow the trail between tasks
- **Explain the "why"** not just the "what" â€” decision rationale, tradeoffs considered, lessons learned
- **Show the thought process** â€” "started here, realized X, pivoted to Y because Z"

### Subtasks â€” MUST BE COMPLETE
- **Subtasks get the same treatment as parent tasks**: descriptions, comments, worklogs, start/due dates, labels, linked work items
- **Never create skeleton subtasks** â€” a subtask with just a title is not a subtask, it's a placeholder
- **Each subtask should have**: ADF description, at least 1 comment documenting what was done, worklog entries, start/due dates, labels
- **Comments on subtasks should reference the parent task narrative** â€” connect the dots for the reader

### Properties â€” ALWAYS Populate
Every issue (Epic, Task, Subtask) must have ALL of the following set:
- **Assignee**: Always Steve (unless explicitly told otherwise)
- **Time tracking**: Original estimate + remaining estimate (remaining = 0h when Done)
- **Labels**: Relevant categorization tags (at least 2 per issue)
- **Start date + Due date**: Realistic dates that tell a story of progress
- **Priority**: Set appropriately (not just default)
- **Description**: Full ADF-formatted description (see above)

### Worklogs
- **Log time on every task and subtask** â€” not just parent tasks
- **Narrative worklogs**: Use the comment field to describe what was done, not just "worked on it"
- **Daily granularity**: Break multi-day tasks into daily entries showing progression
- **Time should add up**: Subtask worklogs should sum to roughly the parent task's time spent

### Dependencies & Links
- **Create dependency links** between tasks (Blocks / Is Blocked By)
- **Reference related tasks** in comments via inlineCard links
- **Build a dependency chain** that reflects the actual execution order

### Workflow Transitions
- **Transition through states properly** â€” don't jump from Backlog to Done. Show the journey: Backlog â†’ Research/Discovery â†’ In Progress â†’ Done (or whatever states are appropriate)
- **Add transition comments** explaining why the status changed

### Watchers & Notifications
- **Add key stakeholders as watchers** on showcase tasks right before transitioning to Done so they get email notifications with the impressive detail
- **Think about who should see what** â€” not every task needs watchers, but the ones that demonstrate value absolutely do

### General Philosophy
- **Go overboard on detail** â€” IP Corp (and most enterprises) equate the effort put into ticket management with actual value delivered
- **Treat Jira as a portfolio** â€” every ticket is evidence of work done, decisions made, and value delivered
- **The board should tell a complete story** â€” anyone looking at the project should understand the full scope, approach, timeline, and progress without asking a single question
