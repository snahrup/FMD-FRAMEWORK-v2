
## Overnight Push Flags Run — 2026-02-27 01:49:05 UTC
### Part A: Incremental Flags
- Updated: **723**
- Skipped (no DB match): **0**
- Errors: **0**
- By namespace:
  - ETQ: 28
  - M3: 7
  - M3C: 182
  - MES: 408
  - OPTIVA: 98

### Part B: Entity Reactivation
- Reactivated: **0**

### Part C: MES LoadValue Fix
- Status: **table_not_found**
- Fixed: **0**

### Part D: Final Verification
| Namespace | Active | Incremental | Total |
|-----------|--------|-------------|-------|
| ETQ | 29 | 28 | 29 |
| M3 | 596 | 7 | 596 |
| M3C | 185 | 182 | 185 |
| MES | 445 | 408 | 445 |
| OPTIVA | 480 | 98 | 480 |

---
| 1 | 2026-02-27 03:00 UTC | OPTIVA LZ copies fail on LK_GET_LASTLOADDATE — gateway connection CON_FMD_SQLOPTIVALIVE_OPTIVALIVE (67ED6C00) can't reach SQLOptivaLive | N/A — Fabric gateway infrastructure issue. Needs Fabric portal fix. | DEFERRED to Steve |
| 2 | 2026-02-27 03:00 UTC | LZ pipeline reports Failed despite 5,872/5,872 existing entities processed | Pipeline fails on ANY copy error (OPTIVA failures cascade) | Known behavior — existing sources fully loaded |
