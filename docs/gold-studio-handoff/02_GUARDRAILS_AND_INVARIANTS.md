# Gold Studio — Guardrails and Invariants

This file defines non-negotiable rules. Claude must preserve these unless explicitly instructed otherwise.

## Product invariants

1. Gold Studio is **metadata-first**.
2. Gold Studio is **entity-centric**, not wizard-centric.
3. Clusters are **suggestions**, not automatic merges.
4. The human makes the judgment calls.
5. A Gold asset is not complete until it is **cataloged**.
6. Endorsement is separate from catalog publication.
7. Validation can be overridden only through the waiver model.

## First-class objects

These names are locked:
- Specimen
- Cluster
- Canonical Entity
- Specification / Gold Spec
- Catalog Entry

Do not rename them casually.

## Provenance invariants

The Provenance Thread has seven phases:
1. Imported
2. Extracted
3. Clustered
4. Canonicalized
5. Gold Drafted
6. Validated
7. Cataloged

Early phases are stored directly on extracted entities.
Downstream phases are derived from linked canonical/spec/catalog state.

Do not introduce a second competing source of truth for downstream provenance.

## Catalog and endorsement invariants

- `Cataloged` is the terminal provenance state.
- Endorsement is an attribute with values:
  - none
  - promoted
  - certified
- Publishing to catalog does not automatically imply certified endorsement.

## Gold spec invariants

Gold specs are physical Gold-layer object designs.

They are **not** the place to embed semantic measure definitions.

Semantic definitions belong in their own layer/package associated with canonical entities.

## Validation invariants

- Critical failures block validation unless a waiver is filed.
- Waivers must include reason, approver identity, timestamp, and review date.
- Validation is version-scoped.
- Material spec changes invalidate prior validation and require revalidation.

## Versioning invariants

Versioning must preserve root identity and current-version semantics.

Use the documented root/version/current patterns. Do not collapse versioning into mutable single-row objects for major state-bearing records.

## Async invariants

The following are asynchronous job workflows:
- extraction
- schema discovery
- bulk import
- validation
- duplicate detection

Do not implement them as blocking request-thread operations.

## UI invariants

- Warm paper / copper / gold / green palette stays intact.
- Zero shadows.
- Borders-only depth.
- Slide-over shell is consistent across pages.
- Gold Studio uses sidebar entry + horizontal internal sub-nav.
- Ledger is home base.

## Safety / implementation invariants

- Uploaded filenames are not trusted for storage paths.
- Pasted SQL is never executed directly.
- PBIX parsing must defend against zip bombs.
- XML parsing must defend against XXE.
- Schema discovery must use safe identifier handling.
- Default queries must filter out soft-deleted records.

## Drift prevention rules

Claude must not:
- compress states because they “look too similar”
- replace cards with plain tables where the spec intentionally uses cards
- convert async job flows into sync endpoints for convenience
- swap out the design language for a generic dark dashboard
- remove provenance thread behavior
- reinterpret Business Portal mapping
