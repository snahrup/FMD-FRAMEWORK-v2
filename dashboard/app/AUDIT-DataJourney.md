# DataJourney Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/DataJourney.tsx` (~930 lines)
Backend: `dashboard/app/api/server.py`

---

## Frontend Bugs Fixed

### 1. Anti-Flash Loading Pattern Missing (MEDIUM)

**Problem:** The `loadJourney` callback unconditionally called `setLoading(true)` on every invocation, including refreshes via the "Refresh" button. This caused the entire content area (timeline, transition cards, schema diff) to flash away and show a loading spinner even when data was already displayed, creating a jarring visual flicker.

**Fix:** Added a `hasLoadedOnce` ref (line 356). `setLoading(true)` is now only called when `hasLoadedOnce.current` is false (i.e., the first load). On subsequent refreshes, data updates silently in the background. The ref is reset when switching entities (`selectEntity`) or clearing the selection (clear button), so the spinner correctly appears for genuinely new loads.

### 2. Missing hasLoadedOnce Reset on Entity Switch and Clear (MEDIUM)

**Problem:** Without resetting `hasLoadedOnce` when the user selects a different entity or clears the selection, switching entities would never show a loading spinner because the ref remained `true` from the previous entity load. Users would see stale data from the previous entity with no visual indication that new data was loading.

**Fix:** Added `hasLoadedOnce.current = false` at the start of `selectEntity` (line 406) and in the clear button's onClick handler (line 531), ensuring the loading spinner appears when loading a genuinely different entity.

### 3. NaN Entity ID from Non-Numeric URL Param (LOW)

**Problem:** The `useEffect` on line 386 called `parseInt(entityIdParam, 10)` without validating that `entityIdParam` was numeric. If someone navigated to `?entity=abc`, `parseInt` returns `NaN`, which gets passed to the API as `/journey?entity=NaN`. The backend returns a 400, but the error message shown to the user would be a generic "API 400" instead of something meaningful.

**Fix:** Added a regex guard `/^\d+$/.test(entityIdParam)` before calling `parseInt` (line 387). Non-numeric entity params are now silently ignored rather than triggering a confusing API error.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. IsIncremental Boolean Coercion Is Fragile (MEDIUM)

**File:** `server.py` line ~3539

**Problem:** The journey endpoint uses `lz.get('IsIncremental') == 'True'` to determine if an entity uses incremental loading. However, `_execute_parameterized()` (line 3930) converts all values to `str(v)`, and depending on the Fabric SQL column type, `IsIncremental` could come back as `'True'`, `'1'`, `'true'`, or even `'False'`/`'0'`. The `== 'True'` check only catches one of these cases.

Other places in server.py handle this correctly -- e.g., line 4528-4529 uses `in (True, 1, '1', 'True', 'true')`, and line 934-935 uses `str(...).lower() in ('true', '1')`.

**Fix needed:**
```python
# Line 3539 — change:
'isIncremental': lz.get('IsIncremental') == 'True',
# to:
'isIncremental': str(lz.get('IsIncremental', '')).lower() in ('true', '1'),
```

### B2. No Try/Catch Around get_entity_journey Call (LOW)

**File:** `server.py` line ~8590-8596

**Problem:** The `/api/journey` route handler calls `get_entity_journey(int(entity_id))` without a local try/catch. If the function throws (e.g., Fabric SQL timeout, ThreadPoolExecutor exception), it falls through to the outer `do_GET` catch at line 8966 which returns `{"error": "<exception str>"}` with status 500. This works but exposes raw Python exception messages to the frontend. Most other complex endpoints in server.py have their own try/catch blocks with cleaner error messages.

**Fix needed:** Wrap in try/catch for a cleaner error:
```python
elif self.path.startswith('/api/journey'):
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
    entity_id = qs.get('entity', [''])[0]
    if not entity_id or not entity_id.isdigit():
        self._error_response('entity param required (LandingzoneEntityId)', 400)
    else:
        try:
            self._json_response(get_entity_journey(int(entity_id)))
        except Exception as e:
            self._error_response(f'Failed to load entity journey: {e}', 500)
```

---

## Code Quality Observations (No Fix Needed)

### Q1. API Endpoint Uses Local fetchJson, Not Shared Hook

The page defines its own local `fetchJson` helper (line 120) that uses a hardcoded `"/api"` prefix, while shared hooks like `useEngineStatus.ts` use `import.meta.env.VITE_API_URL || ""` with `/api` appended. This works in practice (both resolve to `/api/...` relative to the page), but it's a different pattern from the rest of the codebase.

### Q2. Response Shape Is Clean and Well-Typed

The backend's `get_entity_journey()` function (lines 3422-3575) returns a well-structured camelCase response that exactly matches the frontend's `JourneyData` TypeScript interface. The schema diff is built server-side with consistent field names. No PascalCase/camelCase mismatches exist for this endpoint -- this is one of the cleanest endpoint/interface pairs in the dashboard.

### Q3. Null Safety Is Generally Good

The `fmt()` helper (line 126) correctly guards against null/undefined before calling `.toLocaleString()`. All `journey.bronze?.xxx` and `journey.silver?.xxx` accesses use optional chaining. The conditional rendering with `{journey.bronze ? (...) : (...)}` prevents access to null layer objects.

### Q4. useEffect Dependency Array Uses entities.length

Line 402 uses `entities.length` instead of `entities` in the dependency array. This is intentional -- it prevents re-running the effect when the entity list reference changes but the content is the same (common with singleton cache patterns). The only risk is if entities are re-fetched with different content but the same count, which is unlikely in practice.
