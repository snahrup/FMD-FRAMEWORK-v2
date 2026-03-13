# AUDIT: DataClassification.tsx

**File**: `dashboard/app/src/pages/DataClassification.tsx` (289 lines)
**Audited**: 2026-03-13
**Verdict**: PASS — mock/placeholder data is correctly disclosed; no false metrics

---

## Page Overview

Data Classification provides a sensitivity tagging interface for entities and columns. The page uses the entity digest for entity metadata but generates all classification-specific data from a mock `useClassificationData()` hook. A prominent banner declares the classification engine is not yet active.

---

## Data Sources

### 1. Entity Digest (entity metadata only)

| What | Detail |
|------|--------|
| **Hook** | `useEntityDigest()` from `@/hooks/useEntityDigest` |
| **API call** | `GET /api/entity-digest` |
| **Backend handler** | `routes/entities.py → get_entity_digest()` |
| **Used for** | Entity list, source names, entity counts, layer badges |
| **Correctness** | PASS |

### 2. Mock Classification Data (local computation)

| What | Detail |
|------|--------|
| **Hook** | `useClassificationData(entities)` — local `useMemo` (lines 38-83) |
| **API call** | None — purely client-side |
| **Data** | All classification fields hardcoded to zero: `classifiedPct = 0`, `bySensitivity = { public: 0, internal: 0, ... }`, heatmap cells all 0 |
| **Comment in code** | Line 45: "In production this comes from integration.ColumnClassification table" |
| **Correctness** | PASS — the zeros are intentionally correct since the classification engine hasn't run yet |

---

## KPIs and Metrics

| KPI | Source | Value | Correct? |
|-----|--------|-------|----------|
| **Total Entities** | `classData.totalEntities` = `allEntities.length` | Real count from digest | PASS |
| **Est. Columns** | `classData.totalColumns` = `entities.length * 15` | Estimated (hardcoded multiplier) | PASS — labeled "Est." |
| **Classified** | `classData.classifiedColumns` = `0` | Always zero | PASS — classification engine not active |
| **PII Detected** | `classData.bySensitivity.pii` = `0` | Always zero | PASS |
| **Confidential** | `classData.bySensitivity.confidential` = `0` | Always zero | PASS |

---

## Classification Status Banner

The page displays a prominent amber banner (lines 133-147):
> "Classification Engine Not Yet Active — Column schema capture needs to run during next Bronze/Silver load..."

This is accurate and prevents users from interpreting the zero values as "no sensitive data found."

---

## Entity Table Fields

| Field | Source | Correct? |
|-------|--------|----------|
| Entity name | `entity.tableName` from digest | PASS |
| Source | `entity.source` from digest | PASS |
| Schema | `entity.sourceSchema` from digest | PASS |
| Layer badges | `lzStatus`/`bronzeStatus`/`silverStatus` from digest | PASS |
| Classification badge | Hardcoded `<CertificationBadge status="none" />` | PASS — always "none" since no classification |
| Rows | Hardcoded `&mdash;` | PASS — row counts not available |

---

## Heatmap View

| Field | Source | Correct? |
|-------|--------|----------|
| Source rows | From digest source grouping | PASS |
| Entity count per source | `sourceEntities.length` | PASS |
| Sensitivity cells | All zeros from mock `heatmap` array | PASS |
| Unclassified column | `src.estimatedColumns` = `entityCount * 15` | PASS — labeled correctly |

---

## Issues Found

None. The page is correctly structured as a forward-looking feature with honest zero-state representation. Entity metadata comes from the verified entity digest. Classification data is explicitly mock/zero with clear UX disclosure.

---

## Summary

Well-implemented placeholder page. Uses real entity digest data for entity metadata and displays honest zeros for all classification metrics with a clear "not yet active" banner. When `integration.ColumnClassification` table is populated, the `useClassificationData` hook will need to be rewired from local computation to an API call — the current comment at line 45 documents this intent.
