# Gold Studio — Spec Corrections (Packet 00B)

**Date:** 2026-03-18
**Author:** Steve Nahrup

---

## Authoritative Spec

The **corrected authoritative spec** is:

    docs/superpowers/specs/2026-03-18-gold-studio-design.md

All future Gold Studio implementation work — packets, agents, reviews — must follow this file.

## Superseded Spec

The following file is the **pre-correction** version and must NOT be used as the implementation source of truth:

    docs/gold-studio-handoff/00_GOLD_STUDIO_FINAL_SPEC.md

It remains in the bundle for historical reference only. It does not reflect the corrected product intent.

## What Changed

### 1. Product Vision — Domain-by-Domain Construction

Gold Studio is a **domain-by-domain gold-model construction workspace**. It aggregates structural, supporting, and contextual evidence; audits current reporting logic; incrementally constructs the final clean Gold model for a domain; validates that model against legacy reporting behavior; and tracks readiness to recreate or replace legacy reports.

The old spec described Gold Studio as a "persistent assay ledger for report artifacts." The corrected spec expands this to a domain-scoped construction console that handles diverse evidence types, not just parseable artifacts.

### 2. Source Classification Model

Every specimen is classified on two orthogonal axes:

| Field | Purpose | Values |
|-------|---------|--------|
| `type` | Artifact format | `rdl`, `pbix`, `pbip`, `tmdl`, `bim`, `sql`, `excel`, `csv`, `screenshot`, `note`, `other` |
| `source_class` | Authority tier | `structural`, `supporting`, `contextual` |

The old spec had no `source_class` concept. All specimens were implicitly structural.

### 3. Domain Workspace — New First-Class Object

`Domain Workspace` is now a first-class object (6 total, up from 5). It is the organizing container for all evidence, entities, and specs within a business domain. Table: `gs_domain_workspaces`. Endpoints: 4 CRUD routes under `/api/gold-studio/domains`.

The old spec did not mention domain workspaces.

### 4. Report Recreation Readiness / Coverage Tracking

Gold Studio tracks per-domain readiness to recreate or replace legacy reports. Table: `gs_report_recreation_coverage`. Endpoints: 6 routes under `/api/gold-studio/report-recreation-coverage`.

The old spec did not include report recreation tracking.

### 5. Supporting / Contextual Evidence — Authority Boundaries

Supporting evidence (Excel, CSV, mapping sheets) and contextual evidence (screenshots, notes) are cataloged and linked to domains but are **never treated as authoritative structural inputs**:

- They do not produce extracted entities
- They do not participate in duplicate detection or clustering
- They cannot be promoted to canonical entities
- They are linked as references, not structural sources
- Extraction requests for non-structural specimens must be rejected (HTTP 400)

The old spec did not distinguish evidence authority tiers.

### 6. Provenance Lifecycle — Structural Only

Only **structural** specimens and their extracted entities participate in the 7-phase provenance lifecycle (Imported → Extracted → Clustered → Canonicalized → Gold Drafted → Validated → Cataloged).

Supporting and contextual specimens:
- Are fixed at `imported`, never advance
- Display a flat `Supporting` or `Contextual` badge instead of the Provenance Thread
- Have `job_state = 'accepted'` immediately on import (no parsing)

The old spec applied provenance to all specimens uniformly.

### 7. Expanded Specimen / Artifact Types

The corrected spec supports: `rdl`, `pbix`, `pbip`, `tmdl`, `bim`, `sql`, `excel`, `csv`, `screenshot`, `note`, `other`.

The old spec supported only: `rdl`, `pbix`, `pbip`, `tmdl`, `bim`, `sql`.

## Invariants Preserved

All invariants from `02_GUARDRAILS_AND_INVARIANTS.md` remain in force. The corrections above add scope and classification — they do not remove or weaken any existing guardrail.

## Instructions for Future Packets

1. Always read the corrected spec first.
2. If a packet references `00_GOLD_STUDIO_FINAL_SPEC.md`, mentally substitute the corrected spec.
3. If a packet's scope conflicts with the corrections above, follow the corrected spec.
4. Do not regress to the old product vision (artifact-only, no domains, no source classes).
