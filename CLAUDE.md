# FMD Framework — Claude Code Instructions

## Purpose

Fabric Metadata-Driven (FMD) Framework: an enterprise data pipeline for Microsoft Fabric using medallion architecture (Landing Zone -> Bronze -> Silver -> Gold). Metadata-driven with 26+ generic pipelines, a Python engine for extraction/loading/orchestration, and a React/TypeScript dashboard for monitoring, quality, and administration. 1,666 entities across 5 source systems (MES, ETQ, M3 ERP, M3 Cloud, OPTIVA).

## Tree

| Path | Purpose |
|------|---------|
| `engine/` | Python pipeline engine: extractor, loader, orchestrator, models, auth, preflight |
| `dashboard/app/src/` | React/TypeScript frontend (Vite, Tailwind, shadcn/ui) |
| `dashboard/app/api/` | Python FastAPI backend (routes, control plane DB) |
| `config/` | Deployment config: `item_config.yaml` (GUIDs), `item_deployment.json`, `entity_registration.json` |
| `scripts/` | Utility scripts: load optimization, join discovery, diagnostics, Jira updates |
| `setup/` | Fabric workspace provisioning and setup notebooks |
| `docs/` | Architecture decisions, audits, specs, current state |
| `knowledge/` | UX research, onboarding vision, reference materials |
| `context/` | Self-improving memory: standards, learnings, patterns discovered across sessions |
| `CLAUDE_RULES.md` | Detailed operating modes (Diagnose/Plan/Implement/Review) and hard rules |
| `ARCHITECTURE.md` | Single source of truth: paths, GUIDs, schema, pipeline chain |

## Rules

1. **Before doing any task, check `context/` for relevant training materials.**
2. Read `CLAUDE_RULES.md` for operating modes (Diagnose -> Plan -> Implement -> Review) and hard rules.
3. Read `ARCHITECTURE.md` for paths, GUIDs, schema, and pipeline architecture.
4. **Save learnings to the matching context file's Learnings section.**
5. `config/item_config.yaml` is the GUID source of truth. Never hardcode GUIDs.
6. SP auth scope is `analysis.windows.net/powerbi/api/.default` (not `database.windows.net`).
7. Short hostnames only for source servers (no `.ipaper.com` suffix).
8. `deploy_from_scratch.py` is the deployment path. Not NB_SETUP_FMD.
9. Paths are `{Namespace}/{Table}` everywhere (LZ, Bronze, Silver, Gold).
10. No scope creep: a bug fix changes the bug, nothing else.
11. No opportunistic refactors during failure remediation.
12. All UI must scale to N sources (never hardcode source count).
13. `docs/data-source-audit.html` is the source of truth for dashboard data sources.
14. **After merging any PR**, run `python scripts/update_command_center.py` and commit the updated `docs/PACKET_COMMAND_CENTER.html`. A PostToolUse hook handles this automatically, but if it fails, do it manually.
15. To add a new packet to the command center, edit the `PACKETS` and/or `PAGES` lists in `scripts/update_command_center.py`, then regenerate.
16. **Design DNA, not feature clones.** When asked to redesign FMD to feel like a reference UI (Cowork, Linear, Notion, etc.), extract the design language only — colors, typography, spacing, restraint patterns. NEVER add product-specific features that don't exist in FMD (no AI chat composers, no model selectors, no "How can I help you today?" inputs, no fake AI artifacts). FMD is a data pipeline dashboard; tiles and right-rail panels must always link to real FMD pages and real FMD task state. See `context/cowork-design-dna.md`.
17. **Warm cream canvas, not pure white.** The design system already defines `--bp-canvas: #F4F2ED` (warm cream) and `--bp-copper: #B45624` (terracotta accent). Do not override these with `#FFFFFF` or other accent colors without explicit approval. Single-accent rule: terracotta only — most clickable elements should be neutral.
18. **Serif font is for the hero greeting only.** `--font-greeting: 'Fraunces'` (or the `.cw-greeting` utility class) is reserved for the empty-state hero headline on landing/overview pages. Do not apply to body text, card headings, or anywhere else — it loses impact when overused.

## Note-Taking

After each task, log any correction, preference, or pattern learned. Write to the matching context file's ## Learnings section. Format: - [YYYY-MM-DD] Plain language description. If no context file fits, add to Rules above. If 3+ related notes accumulate, create a new context/<topic>.md file and update Tree. Keep CLAUDE.md under 100 lines of actual instructions.
