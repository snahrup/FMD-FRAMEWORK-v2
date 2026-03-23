# AUDIT-ST: Settings Page Audit

**Pages**: `dashboard/app/src/pages/Settings.tsx`, `dashboard/app/src/pages/settings/DeploymentManager.tsx`
**Backend**: `dashboard/app/api/routes/config_manager.py`, `dashboard/app/api/routes/admin.py`
**Audited**: 2026-03-23
**Previous audit**: 2026-03-13 (API route tracing only)

---

## Summary Table

| ID | Severity | Category | Description | Status |
|----|----------|----------|-------------|--------|
| ST-01 | Medium | Token | `#fff` hardcoded for Deploy button text | Fixed |
| ST-02 | Medium | Token | `#0d1117` hardcoded for terminal background | Fixed |
| ST-03 | Low | Token | `#3D7C4F` hardcoded for log checkmark color | Fixed |
| ST-04 | Low | Token | `rgba(185, 58, 42, 0.08)` instead of `--bp-fault-light` | Fixed |
| ST-05 | Medium | Token | `#1C1917` hardcoded in page title color | Fixed |
| ST-06 | Medium | Token | `--font-display` used instead of `--bp-font-display` | Fixed |
| ST-07 | Low | Token | `rgba(255,255,255,*)` in terminal log text | Won't Fix |
| ST-08 | Low | Token | `rgba(0,0,0,0.04)` in box-shadow | Won't Fix |
| ST-09 | Medium | Dead code | `securityGroups` state fetched but never rendered | Fixed |
| ST-10 | Low | Dead code | `Loader2` imported but unused in DeploymentManager | Fixed |
| ST-11 | Low | Dead code | `DeployStatus` type imported but unused in DeploymentManager | Fixed |
| ST-12 | Medium | A11y | No `aria-label` on lab feature toggle buttons | Fixed |
| ST-13 | Medium | A11y | No `role="switch"` / `aria-pressed` on toggle buttons | Fixed |
| ST-14 | Low | A11y | No `aria-label` on Settings tab navigation | Fixed |
| ST-15 | Low | A11y | No `aria-current` on active tab button | Fixed |
| ST-16 | Low | A11y | No `aria-label` on deploy wizard select elements | Fixed |
| ST-17 | Low | A11y | No `aria-label` on Cancel deployment button | Fixed |
| ST-18 | Medium | Backend | `int(params["key"])` raises KeyError (500) instead of friendly 400 | Deferred |
| ST-19 | Low | Backend | `_read_yaml()` minimal parser does not handle lists/anchors | Deferred |
| ST-20 | Low | Honesty | DeployWizard log messages are time-estimated, not real | Noted |
| ST-21 | High | Backend | `/api/deploy/*` routes missing (state, start, cancel, stream) | Deferred |
| ST-22 | Low | Dead code | `DeployField.sensitive` and `DeployField.hint` fields never read | Won't Fix |
| ST-23 | Low | Loading | DeployWizard config step shows loading spinner correctly | Pass |
| ST-24 | Low | Empty state | Empty dropdowns show "Select a..." placeholder | Pass |
| ST-25 | Low | Error handling | DeployWizard has try/catch on all fetch calls | Pass |
| ST-26 | Low | Error handling | DeploymentManager has try/catch on mount fetch | Pass |

---

## Detailed Findings

### ST-01: `#fff` hardcoded for Deploy button text (Fixed)

**File**: `Settings.tsx` line 787
**Before**: `style={{ background: 'var(--bp-fault)', color: '#fff' }}`
**After**: `style={{ background: 'var(--bp-fault)', color: 'var(--bp-surface-1)' }}`

### ST-02: `#0d1117` hardcoded for terminal background (Fixed)

**File**: `Settings.tsx` line 830
**Before**: `background: '#0d1117'`
**After**: `background: 'var(--bp-code-block)'`

The `--bp-code-block` token (`#2B2A27`) is the design system's dark background. The original `#0d1117` was a GitHub-style dark, not part of the design system.

### ST-03: `#3D7C4F` hardcoded for log checkmark (Fixed)

**File**: `Settings.tsx` line 841
**Before**: `color: '#3D7C4F'`
**After**: `color: 'var(--bp-operational)'`

`--bp-operational` is already `#3D7C4F`, so this is a pure token migration.

### ST-04: `rgba(185, 58, 42, 0.08)` instead of token (Fixed)

**File**: `Settings.tsx` line 750
**Before**: `background: 'rgba(185, 58, 42, 0.08)'`
**After**: `background: 'var(--bp-fault-light)'`

`--bp-fault-light` (`#FBEAE8`) is the correct semantic token. The rgba was a manual approximation of the fault color at 8% opacity.

### ST-05: `#1C1917` hardcoded in page title (Fixed)

**File**: `Settings.tsx` line 1089
**Before**: `color: '#1C1917'`
**After**: `color: 'var(--bp-ink-primary)'`

### ST-06: `--font-display` instead of `--bp-font-display` (Fixed)

**File**: `Settings.tsx` line 1089
**Before**: `fontFamily: "var(--font-display)"`
**After**: `fontFamily: "var(--bp-font-display)"`

Both resolve to the same value, but `--bp-font-display` is the canonical token name used throughout the design system.

### ST-07: Terminal text rgba values (Won't Fix)

**File**: `Settings.tsx` lines 838, 842, 846
Values: `rgba(255,255,255,0.3)`, `rgba(255,255,255,0.8)`, `rgba(255,255,255,0.4)`

These are white text at varying opacities inside a dark terminal block. No `--bp-*` token exists for light-on-dark text. Acceptable as-is.

### ST-08: Box-shadow rgba (Won't Fix)

**File**: `Settings.tsx` line 1019
Value: `0 1px 3px rgba(0,0,0,0.04)`

Standard shadow value. No token exists for shadows. Acceptable.

### ST-09: `securityGroups` state dead code (Fixed)

**File**: `Settings.tsx` lines 186, 200, 204
The `securityGroups` state was populated from `/api/fabric/security-groups` but never rendered anywhere in the component. Removed the state variable, the fetch call, and the destructured variable.

### ST-10: `Loader2` unused import (Fixed)

**File**: `DeploymentManager.tsx` line 2
Imported but never referenced in the component template. Removed.

### ST-11: `DeployStatus` unused type import (Fixed)

**File**: `DeploymentManager.tsx` line 9
Imported from `./types` but never referenced. Removed.

### ST-12 & ST-13: Toggle buttons lack accessibility attributes (Fixed)

**File**: `Settings.tsx` lab feature toggle buttons
Added `aria-label`, `aria-pressed`, and `role="switch"` to make screen readers announce toggle state.

### ST-14 & ST-15: Tab navigation lacks ARIA (Fixed)

**File**: `Settings.tsx` nav element and tab buttons
Added `aria-label="Settings sections"` to nav and `aria-current="page"` to the active tab.

### ST-16: Select elements lack aria-label (Fixed)

**File**: `Settings.tsx` deploy wizard select elements
Added `aria-label` to all three select elements (workspace, connection, lakehouse schemas).

### ST-17: Cancel deployment button lacks aria-label (Fixed)

**File**: `DeploymentManager.tsx` cancel button
Added `aria-label="Cancel deployment"`.

### ST-18: Backend KeyError on missing required params (Deferred)

**File**: `config_manager.py` lines 213, 224, 238, 251, 272, 289
Pattern: `int(params["workspaceId"])` raises `KeyError` -> 500 instead of a 400 with a friendly message.
**Reason deferred**: Requires backend changes to add param validation wrapper. Affects multiple routes beyond Settings scope.

### ST-19: Minimal YAML parser limitations (Deferred)

**File**: `config_manager.py` lines 49-70
The `_read_yaml()` function is a hand-rolled subset parser that cannot handle YAML lists, anchors, or multi-line strings. Works for the flat `item_config.yaml` in use today.
**Reason deferred**: Would require adding a PyYAML dependency or a more robust parser. Low risk since the file format is controlled.

### ST-20: Deploy log messages are time-estimated (Noted)

**File**: `Settings.tsx` lines 138-155 (`DEPLOY_PHASES`), lines 243-250
The deployment wizard's log panel shows messages based on elapsed time, not actual backend events. A disclaimer exists at line 858-861.
**Assessment**: Honest -- the UI explicitly states "Log messages are estimated based on typical deployment timing." No fix needed.

### ST-21: `/api/deploy/*` routes missing (Deferred)

**File**: `DeploymentManager.tsx` calls `/api/deploy/state`, `/api/deploy/start`, `/api/deploy/cancel`, `/api/deploy/stream`
These SSE-based deploy routes are referenced by DeploymentManager but not yet implemented in any backend route file. This was already documented in the prior audit (2026-03-13).
**Reason deferred**: Requires new backend implementation, outside audit fix scope.

### ST-22: DeployField unused interface fields (Won't Fix)

**File**: `Settings.tsx` lines 104-111
`DeployField.sensitive` and `DeployField.hint` are defined in the interface and populated in `DEPLOY_FIELDS` but never read by the rendering code (the config step uses hardcoded labels instead). The data is still used for validation logic on line 238, so removing the entire struct would break functionality.

---

## Files Modified

- `dashboard/app/src/pages/Settings.tsx` -- 12 fixes (tokens, dead code, accessibility)
- `dashboard/app/src/pages/settings/DeploymentManager.tsx` -- 3 fixes (dead imports, accessibility)

## Files Audited (no changes needed)

- `dashboard/app/api/routes/config_manager.py` -- parameterized queries correct, findings deferred
- `dashboard/app/api/routes/admin.py` -- shared route, findings deferred
