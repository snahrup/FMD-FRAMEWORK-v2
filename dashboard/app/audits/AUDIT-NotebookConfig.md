# AUDIT: NotebookConfig.tsx (Refresh)

**Date**: 2026-03-23
**Previous audit**: 2026-03-13 (found missing notebook/trigger and notebook/job-status endpoints)
**Frontend**: `dashboard/app/src/pages/NotebookConfig.tsx` (895 lines)
**Backend**:
- `dashboard/app/api/routes/config_manager.py` — `GET /api/notebook-config`, `POST /api/notebook-config/update`
- `dashboard/app/api/routes/notebook.py` — `POST /api/notebook/trigger`, `GET /api/notebook/job-status`

---

## Summary Table

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | LOW | Token compliance | Hardcoded `rgba(180, 86, 36, 0.15)` focus ring on edit input | FIXED |
| 2 | MEDIUM | Accessibility | Zero `aria-label` attributes on any interactive element | FIXED |
| 3 | MEDIUM | Accessibility | Loading spinner missing `role="status"` | FIXED |
| 4 | MEDIUM | Accessibility | Error state missing `role="alert"` | FIXED |
| 5 | MEDIUM | Accessibility | Readiness banners missing `role="status"` | FIXED |
| 6 | MEDIUM | Accessibility | Collapsible sections missing `aria-expanded` | FIXED |
| 7 | LOW | Honesty | `templateMapping` always `{}` — stub data presented as real section | DEFERRED |
| 8 | LOW | Honesty | `missingConnections` always `[]` — warning never fires | DEFERRED |
| 9 | OK | Error handling | Fetch calls have try/catch, error state shown to user | NO ACTION |
| 10 | OK | Loading states | Full-page spinner on first load, inline refresh after | NO ACTION |
| 11 | OK | Empty states | Empty config values show "(empty -- needs value)" with set action | NO ACTION |
| 12 | OK | Token compliance | All other colors use `var(--bp-*)` tokens correctly | NO ACTION |
| 13 | OK | Dead code | All imports used, no commented-out blocks, no unreachable branches | NO ACTION |
| 14 | OK | Hardcoded strings | No magic numbers or hardcoded source counts | NO ACTION |
| 15 | OK | Backend security | All DB operations use parameterized queries | NO ACTION |
| 16 | OK | Backend validation | Input targets validated, unknown targets return 400 | NO ACTION |

---

## Detailed Findings

### 1. FIXED -- Hardcoded rgba focus ring

**Line 222**: The edit input's `boxShadow` used `rgba(180, 86, 36, 0.15)` instead of the design token `var(--bp-copper-soft)` (which is `rgba(180,86,36,0.10)`). Replaced with the token. The opacity difference (0.15 vs 0.10) is negligible and consistency with the design system matters more.

### 2-6. FIXED -- Accessibility gaps

The page had zero `aria-label` attributes and no ARIA roles on any element. Added:
- `aria-label` on CopyButton (with copied/uncopied states)
- `aria-expanded` + `aria-label` on SectionHeader collapse toggles
- `aria-label` on Save, Cancel, Edit, Set Value buttons (includes field name for context)
- `aria-label` on edit input fields
- `aria-label` on Refresh button
- `role="status"` on loading spinner
- `role="alert"` on error state
- `role="status"` on readiness banners (caution and success)

### 7-8. DEFERRED -- Stub data in notebook-config endpoint

`GET /api/notebook-config` (config_manager.py line 475-476) returns:
```python
"templateMapping": {},
"missingConnections": [],
```

These were dynamic in the old `server.py.bak` implementation:
- `templateMapping` was built by analyzing pipeline JSON files, mapping template GUIDs to deployed GUIDs per workspace
- `missingConnections` detected connections deactivated during deployment

**Impact**: The "Template -> Real ID Mapping" section renders empty (but is collapsed by default). The missing connections warning never appears. Both are informational-only features.

**Why deferred**: Implementing the dynamic logic requires pipeline JSON analysis and connection state tracking that belongs in a dedicated task, not an audit fix.

### Backend Assessment

**Endpoints used by this page:**

| Endpoint | Route File | Assessment |
|----------|-----------|------------|
| `GET /api/notebook-config` | config_manager.py:449 | OK -- reads from filesystem, returns config data |
| `POST /api/notebook-config/update` | config_manager.py:480 | OK -- writes to YAML/JSON files, proper validation |
| `POST /api/notebook/trigger` | notebook.py:426 | OK -- Fabric Jobs API, proper error handling |
| `GET /api/notebook/job-status` | notebook.py:479 | OK -- polls Fabric API, returns job list |

**Previous critical finding resolved**: The 2026-03-13 audit found `POST /api/notebook/trigger` and `GET /api/notebook/job-status` were missing (404). These have since been implemented in `dashboard/app/api/routes/notebook.py` with proper Fabric API integration, error handling, and token acquisition.

**No SQL injection risk**: The notebook-config endpoints only read/write files (YAML, JSON). The config-manager endpoints that do touch SQLite all use parameterized queries.

**No fake data**: All returned data comes from real filesystem reads or Fabric API calls. The two stub fields (templateMapping, missingConnections) are acknowledged empty objects, not fabricated data.

---

## Verdict

**Page Status: HEALTHY** -- All four endpoints are live and functional. Config viewing, editing, and one-click deploy all work. Six accessibility issues fixed, one token compliance issue fixed. Two stub data items deferred as low-impact informational features.
