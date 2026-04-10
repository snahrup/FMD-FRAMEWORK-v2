# UI/UX Forensic Audit And Remediation Spec

Date: 2026-04-09

Related docs:
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\CODEX.md`
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-redesign-brief.md`
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-gold-studio-redesign-implementation-plan.md`
- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-codex-dashboard-handoff.md`

## Mission

Run the deepest possible forensic audit of the current dashboard UI and UX, then remediate every identified issue in scope until the audited experience is clean, stable, verified, and demonstrably better.

This is not a light polish pass.

This is not a severity-threshold bug scrub.

This is a route-by-route, component-by-component, state-by-state product review where the agent does not stop at identification. The agent must identify, document, correct, and re-verify every issue it can reproduce within scope.

## Non-Negotiable Outcome

The audit session only completes when all of the following are true:

1. Every in-scope page has been reviewed visually and behaviorally.
2. Every issue found has been logged.
3. Every issue that can be fixed inside the repo has been fixed.
4. Every fix has been re-tested.
5. A final adversarial review has been run after remediation.
6. Remaining open items, if any, are true external blockers with explicit evidence.

## Core Product Constraints

These rules remain active throughout the audit:

- Preserve the current FMD aesthetic.
- Do not treat this as a rebrand.
- Assume zero user context.
- No silent background behavior.
- Every page must make purpose and next action obvious, but avoid clutter and billboard-style text overload.
- Favor fewer, clearer destinations over page sprawl.
- Never remove functionality without explicitly re-homing it.
- Gold Studio is the reference implementation pattern, not the only area that matters.
- Make the product feel custom-built for IP Corporation's real operating context.
- Orchestration-first, explanation-second.
- Unified enterprise data should remove user glue work wherever possible.

## Audit Philosophy

The audit must judge the product as an operating surface, not a gallery of pages.

Each page should be evaluated with this framing:

- What is this page for?
- What job is the user trying to complete here?
- What context does the system already know?
- What work is the user still doing manually that the platform should be doing for them?
- What is noisy, redundant, decorative, misleading, fragile, or dead weight?
- What breaks trust, momentum, or comprehension even if it is technically "working"?

## Execution Model

Use a separate dedicated worktree for the audit session so it can run in parallel with redesign work.

Recommended:

- Worktree: `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK_codex_uiux_audit`
- Branch: `codex/ui-ux-forensic-audit-20260409`

Do not reuse the active redesign worktree for concurrent edits.

If local servers are needed, run them on ports that do not collide with existing sessions.

Suggested isolated ports:

- frontend: `5175`
- backend: `8789`

## Required Read Order

1. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\CODEX.md`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
3. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
4. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-redesign-brief.md`
5. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-gold-studio-redesign-implementation-plan.md`
6. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-coverage-map.md`
7. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-codex-dashboard-handoff.md`
8. This document

## Required Context Order

Use context in this order:

1. `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge`
3. Current codebase
4. Official external docs only when necessary

## Required Skill Inputs

Treat these as mandatory design constraints:

- `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`

Use browser automation for verification:

- `C:\Users\snahrup\.codex\skills\playwright\SKILL.md`

## In-Scope Surface

At minimum, audit every current user-facing route exposed through primary navigation plus every route reachable from those surfaces through normal workflows.

The agent must build the final inventory from:

- `dashboard/app/src/App.tsx`
- `dashboard/app/src/components/layout/AppLayout.tsx`

Audit all states for every route:

- initial load
- loading
- success
- empty
- partial data
- stale data
- error
- long-running background work
- no-selection state
- selected-item state
- modal, drawer, or drill-down state
- cross-page deep-link state

## Priority Emphasis

The first audit wave must concentrate on the tool pages where the product either proves or fails its value:

- `Explore`
- `Load`
- `Monitor`
- `Gold Studio`

Within `Explore`, core default-nav pages are mandatory:

- `SQL Explorer`
- `Data Blender`
- `Data Lineage`
- `Data Catalog`
- `Data Profiler`

Extended `Explore` pages are also in scope after the core pass:

- `Flow Explorer`
- `Record Counts`
- `Data Journey`
- `Load Progress`
- `Column Evolution`
- `Data Microscope`
- `Sankey Flow`
- `Transformation Replay`
- `Impact Pulse`

## Audit Dimensions

Every page must be checked across all of these dimensions:

### 1. Functional Integrity

- page loads
- primary interactions work
- filters work
- sorting works
- tab changes work
- drill-ins work
- close and back behavior work
- deep-link parameters work
- state persists correctly when it should
- state resets correctly when it should
- background tasks produce visible receipts
- linked pages receive enough context to continue the workflow

### 2. Data Integrity

- metrics match the actual API payloads
- counts are consistent across related surfaces
- labels match the real underlying object
- timestamps are accurate and scoped
- empty states are not masking failed requests
- fallback copy does not lie

### 3. UX Clarity

- the page has a single dominant job
- the recommended next action is obvious
- the page does not over-explain or under-explain
- the user does not need hidden institutional knowledge
- the system carries forward context instead of forcing re-entry
- the surface feels operational rather than decorative

### 4. Information Architecture

- no duplicated destinations without clear reason
- no actions hidden in the wrong page
- no context split across unrelated surfaces
- no dead-end pages
- no meaningless "overview" sections that do not help decisions

### 5. Visual And Interaction Quality

- spacing
- hierarchy
- typography
- balance
- density
- scannability
- affordance clarity
- transition quality
- hover/focus behavior
- loading motion quality
- badge and chip overuse
- billboard-style clutter

### 6. Accessibility And Responsiveness

- keyboard navigation
- focus visibility
- semantic labels
- touch target sizing
- contrast
- desktop layout
- iPhone layout
- iPad layout
- no horizontal overflow unless unavoidable and justified

### 7. Reliability Signals

- no console errors
- no page errors
- no failed requests unless explicitly handled and explained
- no silent retries that change visible state without explanation
- no deceptive loading indicators

### 8. AI Readiness

The agent should not force chat gimmicks into the product.

Instead, it must identify where AI can legitimately increase output:

- synthesis
- anomaly explanation
- next-best-action generation
- impact analysis
- cross-system summarization
- suggested joins or relationships
- draft requests, handoffs, or release notes

Every AI opportunity found must be documented as:

- current user pain
- required context already available in-platform
- proposed AI behavior
- why it is high-value
- why it is not a gimmick

## Mandatory Forensic Method

### Phase 1. Build The Inventory

Create a complete route and component inventory from:

- router definitions
- nav definitions
- direct links between pages
- modals, drawers, and contextual drill-downs

Output:

- `route-inventory.md`
- `component-inventory.md`

### Phase 2. Review The Code Line By Line

For each in-scope page and its supporting components:

- read the file fully
- inspect related hooks
- inspect related API routes
- inspect linked components
- inspect styling and motion behavior

The audit is not allowed to rely only on what is visible in the browser.

### Phase 3. Run Browser Forensics

For each route:

- desktop review
- iPhone review
- iPad review
- console capture
- failed request capture
- visual screenshots
- interaction checks
- deep-link checks where relevant

### Phase 4. Log Every Issue

There is no severity floor for documentation.

Log:

- critical
- high
- medium
- low
- cosmetic
- copy
- motion
- affordance
- responsiveness
- accessibility
- IA
- automation opportunity
- AI opportunity

### Phase 5. Remediate

Fix every issue that can be fixed in-repo.

For each fix:

- identify the root cause
- apply the correction
- avoid introducing regressions
- preserve the FMD aesthetic
- keep the experience custom to the operating context

### Phase 6. Re-Test

Every fix must be re-verified through:

- route-level browser testing
- targeted interaction testing
- API validation when data behavior changed
- mobile checks where layout changed

### Phase 7. Adversarial Final Review

After the audit agent believes the work is complete, it must attack its own output.

Required adversarial questions:

- what still feels like a data viewer instead of an operator tool?
- where is the user still doing glue work manually?
- where is the UI still noisy or over-explained?
- where could a confused first-time user still get lost?
- where are cross-tool transitions still weak?
- what would embarrass the product in front of the CIO, an operator, or a steward?

## Required Issue Register

Maintain a machine-readable and human-readable issue register.

Required file:

- `docs/superpowers/audits/2026-04-09-ui-ux-forensic-issue-register.md`

Every issue entry must include:

- issue id
- route
- viewport
- area
- severity
- category
- reproduction steps
- observed behavior
- expected behavior
- root cause
- affected file paths
- fix status
- verification evidence

## Required Evidence Artifacts

Store artifacts under:

- `dashboard/app/output/playwright/uiux-forensic-audit/`

Required outputs:

- route screenshots
- before and after screenshots for significant fixes
- console and request failure summary
- mobile audit summary
- deep-link verification summary
- final regression summary

## Required Test Gates

The audit session does not finish until these gates pass for all in-scope surfaces:

### Browser Gates

- zero uncaught page errors
- zero unexpected console errors
- zero unexpected failed network requests
- no broken primary CTA flows
- no broken selected-item flows

### UX Gates

- each page has a clear dominant job
- each page has an obvious next best action
- no dead-end interaction paths
- no misleading empty states
- no decorative clutter that weakens comprehension

### Mobile Gates

- no avoidable horizontal overflow
- touch targets are acceptable
- critical workflows are usable on iPhone
- critical workflows are usable on iPad

### Data Gates

- displayed counts are credible
- page summaries match underlying responses
- drill-downs do not contradict parent views

## Completion Standard

A page is not complete because it "looks better."

A page is complete only when:

- it works
- it is trustworthy
- it is clear
- it is useful
- it reduces effort
- it survives adversarial review

## Known Findings Already Surfaced

These are not the full audit. They are seed findings already observed and must be validated immediately by the audit session.

1. `SQL Explorer` source column retrieval appears broken for at least one real entity.
   - Endpoint tested:
     - `GET /api/sql-explorer/columns?server=M3-DB3&database=ETQStagingPRD&schema=dbo&table=CustomerContacts`
   - Observed:
     - `502 Bad Gateway`

2. `SQL Explorer` lakehouse column retrieval appears broken for at least one real entity.
   - Endpoint tested:
     - `GET /api/sql-explorer/lakehouse-columns?lakehouse=LH_BRONZE_LAYER&schema=etq&table=CustomerContacts`
   - Observed:
     - `502 Bad Gateway`

3. `Data Lineage` column lineage endpoint returns loaded statuses but no actual column lists for at least one real entity.
   - Endpoint tested:
     - `GET /api/lineage/columns/1042`
   - Observed:
     - `landing`, `bronze`, and `silver` report `loaded`
     - all column arrays are empty

4. `Data Profiler` underlying profile endpoint does return real data for at least one real entity.
   - Endpoint tested:
     - `GET /api/blender/profile?lakehouse=LH_BRONZE_LAYER&schema=etq&table=CustomerContacts`
   - Observed:
     - successful response with row counts, column counts, nulls, distinct counts, completeness, and uniqueness

5. Worktree baseline services were healthy at the time these seed checks were run.
   - Frontend:
     - `http://127.0.0.1:5174`
   - Backend:
     - `http://127.0.0.1:8788/api/health`

## Required Final Deliverables

The audit session must finish with:

1. Updated code in its own dedicated audit worktree.
2. Completed issue register.
3. Artifact folder with browser evidence.
4. Final audit summary with:
   - total issues found
   - total issues fixed
   - total issues verified
   - remaining blockers
   - remaining AI opportunity recommendations
5. Explicit statement on whether the in-scope experience is production-ready.

## Copy-Paste Bootstrap Prompt For The Audit Session

Use a dedicated worktree for this audit and do not stop until every issue you can find is identified, documented, fixed, and re-verified.

Bootstrap files to read first:

1. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\CODEX.md`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
3. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
4. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-redesign-brief.md`
5. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-gold-studio-redesign-implementation-plan.md`
6. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-coverage-map.md`
7. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-codex-dashboard-handoff.md`
8. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK_codex_gold_studio\docs\superpowers\specs\2026-04-09-ui-ux-forensic-audit-spec.md`

Use context in this order:

1. `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge`
3. the current codebase
4. official external docs only when needed

Read and follow these skill files:

- `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`
- `C:\Users\snahrup\.codex\skills\playwright\SKILL.md`

Non-negotiable rules:

- preserve the current FMD aesthetic
- do not treat this as a rebrand
- assume zero user context
- no silent background behavior
- every issue regardless of severity must be logged
- every fix must be re-tested
- do not stop at identification
- do not stop until all fixable issues in scope are corrected and verified
- produce screenshots, logs, and an issue register
- run a final adversarial review after all fixes

Start by creating a separate dedicated worktree and building a complete route inventory from `App.tsx` and `AppLayout.tsx`.
