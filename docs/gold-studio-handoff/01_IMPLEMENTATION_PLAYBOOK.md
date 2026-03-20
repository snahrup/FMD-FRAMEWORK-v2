# Gold Studio — Implementation Playbook

## Objective

Implement Gold Studio in controlled, reviewable slices without reinterpreting product intent, overloading a single agent, or allowing architectural drift.

## Core operating model

Gold Studio must be built using three layers of authority:

1. **Master specification**  
   The final spec is the source of truth for product, UX, data model, routes, design system, and invariants.

2. **Atomic implementation packets**  
   Each packet narrows scope to one buildable slice. Claude must stay inside the packet boundary.

3. **Review gates**  
   No packet should be treated as implicitly approved. Each packet is reviewed before the next packet starts.

## What Claude is allowed to do

Claude may:
- implement the current packet
- make minimal local adjustments required to wire the packet into the repo
- add small helper utilities/components directly needed by the packet
- create tests for the packet
- create migration files, DTOs, hooks, and supporting code inside scope
- ask narrowly scoped blocking questions only when a real environmental ambiguity exists

Claude may not:
- redesign the product
- collapse workflow states because they “seem redundant”
- rename first-class objects without explicit instruction
- merge multiple packets into one effort
- refactor unrelated subsystems
- invent new provenance rules
- conflate catalog publication with endorsement
- move semantic definitions back into physical Gold specs
- bypass async job expectations with synchronous endpoint logic

## Build sequencing

### Phase 1 — foundation
- Gold Studio routing shell
- shared page layout
- design tokens / core UI primitives
- database schema and migrations
- API route scaffolding

### Phase 2 — ledger backbone
- specimen registry
- import modal
- job status model
- Ledger page by specimen
- entity detail slide-over

### Phase 3 — clustering workflow
- duplicate detection plumbing
- Clusters page
- column reconciliation
- standalone promotion

### Phase 4 — canonical and specifications
- Canonical page
- relationship map
- spec generation
- SQL editing and revalidation triggers

### Phase 5 — validation and governance
- validation runs
- waiver flow
- catalog publication
- business portal sync surfaces

### Phase 6 — hardening
- audit log
- versioning enforcement
- optimistic concurrency
- edge-state polish
- tests

## Required implementation discipline

For every packet, Claude must:
- read the packet and the relevant portions of the master spec
- identify the files likely to change
- keep all changes scoped to the packet
- preserve existing app conventions where they do not conflict with the spec
- return a concise implementation summary plus review checklist

## Packet completion standard

A packet is complete only when:
- the defined scope is implemented
- acceptance criteria are satisfied
- no known blocker remains hidden
- tests or validation steps are documented
- changes outside allowed scope are explicitly disclosed

## Review loop

After each packet:
1. Claude returns the review-gate output.
2. The result is reviewed.
3. Only then does the next packet begin.

## Default answer to ambiguity

If a choice is not explicitly defined:
- prefer the master spec
- prefer existing repo conventions
- prefer smaller change surfaces
- do not invent broader architectural changes
