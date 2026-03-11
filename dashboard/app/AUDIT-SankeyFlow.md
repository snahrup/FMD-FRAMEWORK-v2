# SankeyFlow Page Audit

Audited: 2026-03-11

## Frontend Bugs Fixed

1. **MEDIUM** — Anti-flash loading pattern missing
   - **Problem**: Component used `loading && !data` to gate the spinner, but lacked a `hasLoadedOnce` ref. On background refreshes the hook suppresses `loading=true`, but if the hook's internal cache expired and a new fetch started, users could see a brief flash to the loading state even though stale data was available.
   - **Fix**: Added `hasLoadedOnce` ref (line 240). Spinner now only shows before the first successful load: `loading && !hasLoadedOnce.current`.

2. **MEDIUM** — Error state overwrites stale data on refresh failure
   - **Problem**: `if (error)` at the error gate (line 468) rendered full-page error UI unconditionally, even when `data` still held a valid previous response. A transient network failure during a background refresh would flash the user from the Sankey diagram to an error screen.
   - **Fix**: Changed gate to `if (error && !data)` so full-page error only shows when there is no stale data. Added an inline "Refresh failed" label next to the Refresh button when `error && data` are both truthy, so the user is informed without losing context.

3. **MEDIUM** — Stale closure risk in SourcePanel event listeners
   - **Problem**: `useEffect` hooks for click-outside and Escape-key handling depended on `[onClose]`. Since `onClose` is `() => setSelectedSource(null)` — a new arrow function on every parent render — the effects re-ran every render cycle, repeatedly removing/adding DOM event listeners. If a render occurred during the 50ms setTimeout delay, the old handler (referencing a stale `onClose`) could fire.
   - **Fix**: Introduced `onCloseRef` (`useRef(onClose)`) updated on every render. Effects now use `onCloseRef.current()` and have empty `[]` dependency arrays, so listeners register once and always call the latest `onClose`.

4. **LOW** — Operator precedence / dead code in `isNodeHighlighted`
   - **Problem**: Lines 433-434 had conditions `s === nodeId && s === hoveredNode || t === nodeId && t === hoveredNode`. Due to `&&` binding tighter than `||`, these are equivalent to `(nodeId === hoveredNode)`, which is already handled by the early return at line 421 (`if (hoveredNode === nodeId) return true`). The redundant conditions made the logic harder to reason about.
   - **Fix**: Removed the two redundant conditions, leaving only the meaningful connected-neighbor check: `(s === hoveredNode && t === nodeId) || (t === hoveredNode && s === nodeId)`.

## Backend Issues

1. **LOW** — `server.py:976` — SQLite digest response missing `generatedAt` / `buildTimeMs` fields
   - **Problem**: The SQLite path (`_sqlite_entity_digest`) returns `{'sources': [...], 'statusCounts': ..., 'totalEntities': ..., '_source': 'sqlite', 'lastSync': ...}` but omits `generatedAt` and `buildTimeMs` that the Fabric SQL path includes. The frontend hook's `normalizeDigestResponse` compensates (falls back to `new Date().toISOString()` and `0`), so this is not a crash, but the backend response shapes are inconsistent.
   - **Fix needed**: Add `'generatedAt': datetime.utcnow().isoformat() + 'Z'` and `'buildTimeMs': round((time.time() - t0) * 1000)` to the SQLite path return dict (server.py ~line 976).

2. **LOW** — `server.py:131` — Display name mapping for M3 ERP returns "M3", not "M3 ERP"
   - **Problem**: `_DS_DISPLAY_NAMES` maps `'m3fdbprd'` to `'M3'`, but `SOURCE_COLORS` in `layers.ts` expects `'M3 ERP'` for the pink color. SQLite path uses `displayName` which becomes the source `name` in the frontend. Result: M3 ERP entities get the fallback gray color (`#64748b`) instead of pink in the Sankey diagram.
   - **Fix needed**: Change `_DS_DISPLAY_NAMES` mapping from `'m3fdbprd': 'M3'` to `'m3fdbprd': 'M3 ERP'` in server.py line 131, OR add `'M3': '#ec4899'` to `SOURCE_COLORS` in layers.ts. The server-side fix is preferred since "M3 ERP" is the canonical display name used elsewhere.

3. **LOW** — `server.py:966-972` — SQLite source objects missing `connection` at the source level
   - **Problem**: In the SQLite path, each source group object has `name`, `displayName`, `entities`, `statusCounts` but no top-level `connection` field. The Fabric SQL path (line 4622-4625) includes it. The frontend normalizer defaults to `null`, so `SourcePanel` works (guarded by `source.connection &&`), but the panel won't show server/database info for sources when running against SQLite.
   - **Fix needed**: Add `'connection': {'server': ..., 'database': ..., 'connectionName': ...}` to the source group dict in `_sqlite_entity_digest` (server.py ~line 967), sourcing from the first entity's connection fields.
