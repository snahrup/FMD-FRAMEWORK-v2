# AUDIT-BR: Business Requests Page

**Date**: 2026-03-23
**Files audited**:
- `dashboard/app/src/pages/business/BusinessRequests.tsx` (596 lines)
- `dashboard/app/api/routes/requests.py` (227 lines)
- `dashboard/app/api/routes/overview.py` — GET /api/overview/sources only (read-only, not edited)

## Summary Table

| # | Category | Severity | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | Hardcoded hex | Medium | `#fff` used for active button text (lines 410, 459) | **Fixed** |
| 2 | Dead code | Low | `SearchIcon` imported but never used | **Fixed** |
| 3 | Accessibility | Medium | No `htmlFor`/`id` pairing on any of the 4 form labels | **Fixed** |
| 4 | Accessibility | Medium | Priority segmented control lacks `role="group"` and `aria-label` | **Fixed** |
| 5 | Accessibility | Low | Priority buttons and filter chips missing `aria-pressed` | **Fixed** |
| 6 | Accessibility | Low | Success banner missing `role="status"`, error banner missing `role="alert"` | **Fixed** |
| 7 | Accessibility | Low | Request list scroll container missing `aria-label` | **Fixed** |
| 8 | Form validation | Medium | No `maxLength` on title input (frontend) | **Fixed** |
| 9 | Backend validation | Medium | No title length limit on POST /api/requests | **Fixed** |
| 10 | Backend validation | Medium | No length limit on description/justification fields | **Fixed** |
| 11 | Backend validation | High | PATCH /api/requests/{id} does not validate `id` is an integer | **Fixed** |
| 12 | Error handling | Info | GET /api/requests fetch failure is silently swallowed on poll | Acceptable |
| 13 | Error handling | Info | GET /api/overview/sources failure silently swallowed | Acceptable |
| 14 | Overview.py | Low | `get_overview_sources` uses `.format()` for SQL placeholder injection — safe (only `?` chars) but inconsistent with f-string style in same file | **Deferred** |
| 15 | Honesty | Pass | All data comes from real DB queries, no stubs or fabricated IDs | N/A |
| 16 | Loading states | Pass | Skeleton shimmer shown during initial load | N/A |
| 17 | Empty states | Pass | Distinct empty states for "no requests yet" vs "no matching filter" | N/A |
| 18 | Token compliance | Pass | All colors use `var(--bp-*)` tokens (after #fff fix) | N/A |

## Detailed Findings

### 1. Hardcoded `#fff` on active button text

Priority segmented control (line 410) and status filter chips (line 459) used `#fff` for text color on the active `--bp-copper` background. Replaced with `var(--bp-surface-1)` (`#FEFDFB`) per the established pattern from AUDIT-EnvironmentSetup.

### 2. Unused `SearchIcon` import

`Search as SearchIcon` was imported from lucide-react but never referenced in JSX or logic. Removed.

### 3-7. Accessibility improvements

- All 4 form labels (`Title`, `Source`, `Description`, `Justification`) lacked `htmlFor` attributes, and their corresponding inputs lacked `id` attributes. Screen readers could not associate labels with inputs. Added `htmlFor`/`id` pairs: `req-title`, `req-source`, `req-description`, `req-justification`.
- Priority button group now has `role="group"` and `aria-label="Priority selection"`.
- Both priority buttons and filter chip buttons now include `aria-pressed` for toggle state.
- Success banner has `role="status"` and error banner has `role="alert"` for screen reader announcements.
- Scrollable request list has `aria-label="Request history"`.

### 8-10. Input length limits

- Frontend: Added `maxLength={200}` to the title input.
- Backend: Added 500-character limit on title, 5,000-character limits on description and justification in POST /api/requests. These are generous limits that prevent abuse without restricting legitimate use.

### 11. PATCH endpoint ID validation

The `request_id` from the URL path was used directly without validating it's an integer. A non-numeric ID would cause an unhandled SQLite error. Added `int()` cast with a 400 error on failure.

### 12-13. Silent fetch failures (Acceptable)

- `fetchRequests` silently catches errors on poll intervals. This is acceptable — the initial load sets `loading=false` regardless, and 30-second polling failures shouldn't spam the user.
- `fetchSources` failure is acceptable — the source dropdown is optional, and the "Other / Not sure" option is always available.

### 14. overview.py SQL formatting (Deferred — shared route)

`get_overview_sources` uses `.format(placeholders=...)` to inject `?` placeholders into SQL. While safe (only `?` characters are injected, actual values go through parameterized queries), it's inconsistent with the f-string approach used elsewhere in the same file. Not editing overview.py per audit scope.

## Files Modified

- `dashboard/app/src/pages/business/BusinessRequests.tsx` — 11 fixes applied
- `dashboard/app/api/routes/requests.py` — 3 fixes applied
