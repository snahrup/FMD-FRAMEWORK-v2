# Quick Start: Load Mission Control Tests

Run all tests for the Load Mission Control page in 5 minutes.

## Prerequisites

```bash
# Install Node dependencies (one time)
cd dashboard/app && npm install
cd ../..

# Install Python dependencies (one time)
pip install pytest pytest-cov unittest-mock
```

## Running Tests

### Option 1: Run API Tests Only (2 minutes)

```bash
# Test the /api/lmc/* endpoints
pytest engine/tests/test_lmc_api.py -v

# With coverage report
pytest engine/tests/test_lmc_api.py --cov=dashboard.app.api.routes.load_mission_control --cov-report=html
```

### Option 2: Run UI/E2E Tests Only (3 minutes)

```bash
# Start dev server in one terminal
cd dashboard/app
npm run dev

# In another terminal, run tests
npx playwright test .mri/generated-tests/test_load_mission_control.spec.ts -v

# View HTML report
npx playwright show-report
```

### Option 3: Run Integration Tests (4 minutes)

```bash
# Start dev + API servers in one terminal
cd dashboard/app
npm run dev

# In another terminal, start API
python dashboard/app/api/server.py

# In a third terminal, run integration tests
npx playwright test .mri/generated-tests/test_load_mission_control_integration.spec.ts -v
```

### Option 4: Run ALL Tests (10 minutes)

```bash
# Terminal 1: Start dev server
cd dashboard/app && npm run dev

# Terminal 2: Start API server
python dashboard/app/api/server.py

# Terminal 3: Run all tests
pytest engine/tests/test_lmc_api.py -v
npx playwright test test_load_mission_control --reporter=html

# View results
npx playwright show-report
```

## What Gets Tested?

### API Tests (22 tests)
- ✅ GET /api/lmc/sources
- ✅ GET /api/lmc/progress
- ✅ GET /api/lmc/runs
- ✅ GET /api/lmc/run/{run_id}
- ✅ GET /api/lmc/run/{run_id}/entities
- ✅ GET /api/lmc/entity/{entity_id}/history

### UI Tests (50 tests)
- ✅ Core rendering (no errors, content visible)
- ✅ KPI display (valid numbers, layer stats)
- ✅ Tab navigation (live, history, entities, triage, inventory)
- ✅ Filtering & search
- ✅ Table interactions
- ✅ Context panel
- ✅ Responsive design (mobile, tablet, desktop)
- ✅ Error handling

### Integration Tests (8 workflows)
- ✅ Start load → Monitor progress → Complete
- ✅ Retry failed entities
- ✅ Filter by status
- ✅ View run history
- ✅ Entity details
- ✅ Real-time SSE updates
- ✅ Error recovery
- ✅ Tab consistency

## Troubleshooting

**Tests timeout:**
```bash
# Increase timeout
npx playwright test --timeout=60000
```

**Port 5173 already in use:**
```bash
# Kill existing process
lsof -ti:5173 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :5173   # Windows (then taskkill)
```

**Playwright browsers not installed:**
```bash
npx playwright install chromium
npx playwright install
```

**Database connection errors (API tests):**
- This is expected! API tests mock the database
- Tests don't require actual DB connection

## Test Results Location

- **UI Test Report:** `.mri/generated-tests/test-report/`
- **API Test Results:** Console output (pytest)
- **Screenshots/Videos:** `.mri/generated-tests/screenshots/` (on failure)

## Coverage Metrics

See full details in: `docs/TEST_COVERAGE_LOAD_MISSION_CONTROL.md`

---

**Questions?** Check the full documentation:
```bash
cat docs/TEST_COVERAGE_LOAD_MISSION_CONTROL.md
```
