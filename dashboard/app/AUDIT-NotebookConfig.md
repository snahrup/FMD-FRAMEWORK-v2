# NotebookConfig Page Audit

Audited: 2026-03-11

## Frontend Bugs Fixed

1. **MEDIUM — Anti-flash loading pattern missing**
   - Problem: `loading && !data` guard caused a full-page spinner on every refetch (e.g., after saving a value), flashing the entire UI away and back.
   - Fix: Added `hasLoadedOnce` ref. Initial load shows spinner; subsequent refetches keep stale data visible while the header refresh icon spins.

2. **MEDIUM — `EditableValue.handleSave` missing try/catch**
   - Problem: `await onSave(draft)` (line 183) had no error handling. A network failure would leave the component in an inconsistent state — `setSaving(false)` and `setEditing(false)` still ran via fall-through, but the draft remained set to a value that was never persisted.
   - Fix: Wrapped in try/catch. On error, draft resets to the original `value`; `setSaving(false)` runs in `finally`.

3. **LOW — `toLocaleTimeString()` crash on invalid date**
   - Problem: `new Date(jobStatus.endTime).toLocaleTimeString()` (line ~605) would render "Invalid Date" if the backend returned an unexpected `endTime` string.
   - Fix: Added `!isNaN(new Date(jobStatus.endTime).getTime())` guard before rendering.

4. **MEDIUM — Polling cleanup race condition**
   - Problem: `startPolling` stored a `setTimeout` ID in `pollRef.current`. When the timeout fired, it overwrote `pollRef.current` with a `setInterval` ID. If `stopPolling` was called during the initial 5-second delay, it cleared the timeout correctly. But if the timeout fired at nearly the same instant, the new `setInterval` was written to `pollRef` after `stopPolling` cleared it, leaking the interval.
   - Fix: Introduced separate `initDelayRef` for the initial `setTimeout`. `stopPolling` now clears both `initDelayRef` (timeout) and `pollRef` (interval) independently.

5. **MEDIUM — Error state has no retry button**
   - Problem: If the initial `/api/notebook-config` fetch failed, the error screen was a dead end with no way to retry — the user had to navigate away and come back.
   - Fix: Added a Retry button to the error state that calls `load()`.

6. **LOW — `doUpdate` missing try/catch**
   - Problem: `doUpdate` called `postJson` which throws on non-2xx responses. The thrown error would propagate as an unhandled rejection (the `handleSave` caller had no catch at the time, and even after fix #2 the error message was lost).
   - Fix: Wrapped `doUpdate` body in try/catch; network errors are now logged to the update log.

7. **MEDIUM -- EditableValue draft not synced on external data refresh**
   - Problem: `draft` is initialized via `useState(value)` which only runs on mount. If the parent re-fetches data (e.g., after `doUpdate` calls `load()`), the `value` prop changes but `draft` stays stale. Re-entering edit mode shows the old value.
   - Fix: Added `useEffect` that syncs `draft` with `value` when `editing` is false.

8. **MEDIUM -- Non-null assertions on trigger response fields**
   - Problem: After `POST /api/notebook/trigger`, `res.workspaceId!` and `res.notebookId!` (line 414-416) crash if the backend returns success without these fields.
   - Fix: Added explicit guard: `if (res.error || !res.workspaceId || !res.notebookId)` before accessing fields. Falls to error path with descriptive message.

9. **MEDIUM -- `load()` anti-flash not fully applied**
   - Problem: `hasLoadedOnce` ref existed but `load()` set `setLoading(true)` unconditionally. After `doUpdate` triggered `load()`, the loading state could flash.
   - Fix: Changed to `if (!hasLoadedOnce.current) setLoading(true)` — only first load shows spinner.

## Backend Issues

1. **LOW — `update_notebook_config` has no try/catch around file I/O** (`server.py:5814`)
   - Problem: If `variables.json` is missing, malformed, or locked, the function raises an unhandled exception. The HTTP handler likely catches it generically, but the error message sent to the client would be a raw Python traceback string.
   - Fix needed: Wrap file reads/writes in try/except and return `{'error': '...'}` with a user-friendly message.

2. **LOW — `update_notebook_config` does not validate `newValue` exists** (`server.py:5821`)
   - Problem: `body['newValue'].strip()` will raise `KeyError` if `newValue` is missing from the POST body, and `AttributeError` if it's `None`.
   - Fix needed: Add `new_val = body.get('newValue', '')` with type check, or return an error if missing.

3. **LOW — YAML write uses naive serialization** (`server.py:5831-5838`)
   - Problem: The YAML writer reconstructs the file by iterating `yaml_data.items()` and manually formatting. This drops any comments, non-dict sections, or special YAML features (anchors, multi-line strings) from the original file.
   - Fix needed: Use a round-trip YAML library (e.g., `ruamel.yaml`) or accept the limitation with a comment in the code.
