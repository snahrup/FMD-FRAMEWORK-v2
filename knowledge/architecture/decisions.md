# Architecture Decision Records

## ADR-001: 8-Agent Team Structure
**Date**: 2026-03-09
**Status**: Accepted
**Context**: FMD_FRAMEWORK has 5 distinct subsystems (engine, API, frontend, Fabric artifacts, deployment) plus a critical testing gap. Running 5-7 manual Claude Code sessions with no coordination has resulted in treading water.
**Decision**: Deploy 8 specialized agents via Paperclip with strict ownership boundaries and worktree isolation.
**Consequences**: Clear accountability, parallel work without conflicts, structured QA loop.

## ADR-002: Bull/Bear Code Review Protocol
**Date**: 2026-03-09
**Status**: Accepted
**Context**: Code quality varies when there's no structured review. Adapted from TauricResearch/TradingAgents debate protocol.
**Decision**: QA Lead plays adversarial "bear" reviewer on all changes. Authors defend with evidence. 2 rounds max, then CTO arbitrates.
**Consequences**: Higher code quality, but slightly longer merge cycle. Acceptable tradeoff.

## ADR-003: Tiered Model Assignment
**Date**: 2026-03-09
**Status**: Accepted
**Context**: Opus 4.6 is more capable but slower and more expensive. Adapted from wshobson/agents tier model.
**Decision**: CTO on Opus 4.6 (architecture decisions, conflict resolution). All ICs on Sonnet 4.6 (implementation speed).
**Consequences**: CTO makes better architectural calls. ICs ship faster. Rate limit pressure distributed.

## ADR-004: Shared Knowledge Base with Domain Silos
**Date**: 2026-03-09
**Status**: Accepted
**Context**: Agents need institutional memory that persists across heartbeats. Adapted from RuFlo's 5-stage learning loop.
**Decision**: `knowledge/` directory with per-domain subdirectories. QA convergence tracking is immutable (never overwrite test runs).
**Consequences**: Cross-session learning, audit trail for QA, no context loss between heartbeats.
