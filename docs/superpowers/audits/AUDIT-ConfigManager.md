# Page Truth Audit: ConfigManager

**Date:** 2026-03-19
**Auditor:** bright-falcon
**Route:** `/config`
**Health:** 🟡 Fragile

---

## 1. Purpose

> Single pane of glass for all FMD configuration — verify GUID consistency across metadata DB, pipeline JSON, variable libraries, and config.json; fix mismatches inline; deploy corrected pipelines.

**Primary user jobs:**
1. Verify configuration consistency — do GUIDs match across all locations?
2. Fix mismatches — inline-edit any GUID/config value with cascade update
3. Deploy corrected pipelines to Fabric
4. Audit connections and data sources

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/ConfigManager.tsx` | 1,613 |
| API route | `dashboard/app/api/routes/config_manager.py` | 503 |
| Deploy stub | `dashboard/app/api/routes/pipeline.py:451-457` | 7 |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/api/config-manager` | GET | SQLite (5 tables) + `item_config.yaml` + pipeline JSON + var libs + `config.json` | ⚠️ **Pipelines query missing PipelineGuid, WorkspaceGuid** |
| `/api/config-manager/update` | POST | SQLite + pipeline JSON + config.json writes | ⚠️ **pipeline_db handler missing WorkspaceGuid** |
| `/api/config-manager/references` | GET | SQLite + pipeline JSON scan | ⚠️ **Response missing `count` field** |
| `/api/deploy-pipelines` | POST | — | ❌ **Stub — returns 501** |

---

## 4. Data Contracts

### Pipelines SELECT — CRITICAL
Backend: `SELECT PipelineId, Name, IsActive FROM pipelines`
Frontend accesses: `p.PipelineGuid`, `p.WorkspaceGuid` — both always `undefined`.
Entire "Registered Pipelines" section shows blank GUID columns.

### Lakehouse IsActive — MEDIUM
`lakehouses` table has no `IsActive` column. Frontend checks `lh.IsActive === "True"` — always `undefined`. Every lakehouse shows "Inactive" badge.

### Cascade references — MEDIUM
Frontend reads `refData.count` but backend returns `{guid, references: [...]}` with no `count` field. `undefined > 0` is `false` → cascade modal **never triggers**.

### pipeline_db WorkspaceGuid — MEDIUM
Frontend sends `newWorkspaceGuid` but handler only processes `newGuid`, `newName`, `newIsActive`. WorkspaceGuid saves silently succeed without persisting.

### Fabric entities — LOW
Backend returns empty `fabricEntities` and `fabricConnections`. `resolveGuid` Fabric paths are dead code.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Spinner |
| Error | Fetch fail | ✅ | Red error banner |
| Empty (no items) | No workspaces/pipelines | ❌ | **Empty table body, no placeholder** |
| Success | Data loaded | ✅ | 9 config sections render |
| Save error | Update fails | ⚠️ | Logged to update log, no inline feedback |
| Deploying | Deploy clicked | ✅ | Spinner banner |
| Deploy result | Complete | ✅ | Success/failure cards |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| View YAML workspaces/connections | 🟢 Real | Reads from disk |
| View DB workspaces/lakehouses/connections/datasources | 🟢 Real | SQLite queries |
| **View DB pipelines** | 🔴 **Broken** | Missing PipelineGuid + WorkspaceGuid in SELECT |
| View pipeline JSON params | 🟢 Real | Scans pipeline files |
| View variable library | 🟢 Real | Reads var lib JSON |
| Mismatch detection | 🟢 Real | Compares against item_config.yaml |
| Inline edit | 🟢 Real | Parameterized SQL + file writes |
| **Cascade GUID update** | 🔴 **Broken** | `refData.count` always undefined → modal never appears |
| Fix All Mismatches | 🟢 Real | Batch pipeline JSON writes |
| **Deploy to Fabric** | 🟠 Stub | Returns 501 |
| Fabric entity resolution | 🟠 Stub | Returns empty objects |
| Business/Technical mode | 🟢 Real | Name mapping |

### Misleading UI

1. **"Deploy" button** — Appears functional, triggers 501. Banner says "update all 22 pipelines" (hardcoded count).
2. **Registered Pipelines section** — GUID columns always blank, workspace match shows nothing.
3. **Lakehouse badges** — All show "Inactive" (column doesn't exist in schema).
4. **"22 pipelines"** — Hardcoded in deploy banner, not validated against reality.
5. **Cascade update** — Prompt will never appear due to missing `count` field.

---

## 7. Mutation Flows

| Action | Target | Risk |
|--------|--------|------|
| Edit workspace GUID | SQLite `workspaces` | Low — parameterized SQL |
| Edit lakehouse | SQLite `lakehouses` | Low |
| Edit connection | SQLite `connections` | Low |
| Edit datasource | SQLite `datasources` | Low |
| Edit pipeline (DB) | SQLite `pipelines` | **Medium — cannot save WorkspaceGuid** |
| Edit pipeline param | Pipeline JSON on disk | **High — writes to repo files, no backup** |
| GUID replace | All pipeline JSONs | **High — regex replace, no backup, no git commit** |
| Edit dashboard config | `api/config.json` | Medium — requires restart |
| Deploy | Fabric REST API | **Stubbed — 501** |

**No GUID format validation anywhere.** User can save arbitrary strings as GUIDs.
**No confirmation dialogs** for destructive operations like GUID replace.

---

## 8. Root-Cause Bug Clusters

### Cluster A: Incomplete SELECT Queries
Pipelines missing `PipelineGuid` + `WorkspaceGuid`. Lakehouses missing `IsActive`.
- **Fix:** Add columns to SELECT (pipelines), remove badge (lakehouses)

### Cluster B: Dead Cascade Flow
References endpoint missing `count` field → cascade modal never triggers.
- **Fix:** Add `"count": len(refs)` to response

### Cluster C: Stubbed Deploy
`/api/deploy-pipelines` returns 501. UI suggests full capability.
- **Fix:** Migrate implementation or hide button

### Cluster D: Missing Backend Handler
`pipeline_db` target ignores `newWorkspaceGuid`.
- **Fix:** Add handler branch

### Cluster E: No Input Validation
No GUID format validation, no length checks, `pipeline_guid_replace` is unbounded regex.
- **Fix:** Validate on backend

---

## 9. Minimal Repair Order

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | Add PipelineGuid + WorkspaceGuid to pipelines SELECT | A | S | Critical — unblocks Section 8 |
| 2 | Add `count` to references response | B | S | Critical — unblocks cascade updates |
| 3 | Add WorkspaceGuid handler to pipeline_db | D | S | High — saves actually persist |
| 4 | Remove lakehouse IsActive badge | A | S | Medium — stops showing "Inactive" |
| 5 | Hide deploy button or disable with tooltip | C | S | Medium — UI honesty |
| 6 | Add GUID format validation | E | M | Medium — data integrity |
| 7 | Fix hardcoded "22 pipelines" | C | S | Low — accuracy |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
- [ ] Fix pipelines SELECT to include PipelineGuid, WorkspaceGuid
- [ ] Add `count: len(refs)` to references response
- [ ] Add WorkspaceGuid handler to pipeline_db update target
- [ ] Remove IsActive badge from lakehouse cards

### Packet B: Page Shell
- [ ] Hide or disable Deploy button ("Coming soon" tooltip)
- [ ] Fix hardcoded "22 pipelines" → dynamic count
- [ ] Add empty-state messages for each section
- [ ] Remove fabricEntities/fabricConnections from types

### Packet C: Core Workflows
- [ ] Migrate deploy-pipelines implementation
- [ ] Add GUID format validation
- [ ] Add dry-run mode to pipeline_guid_replace
- [ ] Add confirmation before GUID replace

### Packet D: Hardening & Polish
- [ ] Input sanitization (trim, length, character validation)
- [ ] Undo/backup for file writes
- [ ] Optimistic locking for concurrent edits

---

## 11. Verification Checklist

- [ ] Registered Pipelines section shows PipelineGuid and WorkspaceGuid
- [ ] Cascade update modal triggers when editing a shared GUID
- [ ] Pipeline WorkspaceGuid saves persist correctly
- [ ] Lakehouse badges show accurate status (or are removed)
- [ ] Deploy button is hidden or clearly marked as unavailable
- [ ] No console errors on any section
- [ ] GUID edits are validated for format
