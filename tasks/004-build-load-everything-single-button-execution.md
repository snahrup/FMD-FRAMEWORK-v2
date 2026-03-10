# TASK 004: Build "Load Everything" Single-Button Execution

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09
> **Category**: feature
> **Complexity**: medium
> **Impact**: critical
> **Agent**: ui-specialist, backend-architect

---

## Problem Statement

The current Engine Control interface requires users to:
1. Understand the concept of "layers" (Landing, Bronze, Silver)
2. Manually check 3 checkboxes
3. Understand "Plan" vs "Run" mode
4. Click "Execute" after configuration

**This is too complex for end users.** They just want to click ONE button and have everything load.

### Target Behavior

- Single "Load Everything" button visible on multiple pages (Engine Control, Source Manager)
- One click → LZ + Bronze + Silver full load for ALL entities
- No checkboxes, no configuration required
- Shows live progress during execution
- Shows summary on completion

---

## Scope

### In Scope

- [ ] "Load Everything" button on Engine Control page (`/engine`)
- [ ] "Load Everything" button on Source Manager page (`/sources`)
- [ ] Single-click triggers full pipeline (all layers, all entities)
- [ ] Live progress indicator during execution
- [ ] Completion summary with stats
- [ ] Error summary if failures occur
- [ ] Navigation to detailed logs
- [ ] Confirmation dialog for destructive actions (optional)

### Out of Scope

- Partial layer execution (advanced users can use existing checkboxes)
- Entity filtering (load all or nothing)
- Custom execution order (always LZ → Bronze → Silver)
- Scheduled execution (future feature)

---

## Acceptance Criteria (Binary Checklist)

### A. UI Components

| # | Component | Location | Validation |
|---|-----------|----------|-----------|
| A.1 | "Load Everything" button on Engine Control page | Top-right corner, next to "Execute" | Button visible, has PlayCircle icon |
| A.2 | "Load Everything" button on Source Manager page | Top toolbar, next to "Add Source" | Button visible, has Rocket icon |
| A.3 | Button disabled when engine is already running | Query `/api/engine/status`, disable if `status = "running"` | Button grayed out, tooltip shows "Engine already running" |
| A.4 | Button enabled when engine is idle | Engine status = "idle" | Button clickable, primary color |
| A.5 | Hover tooltip explains what button does | Hover shows: "Load all 1,666 entities across Landing Zone, Bronze, and Silver" | Tooltip renders |
| A.6 | Loading indicator during execution trigger | After click, button shows spinner for 2-3 seconds while API call processes | Spinner visible |

### B. Execution Flow

| # | Step | Expected Behavior | Validation |
|---|------|------------------|-----------|
| B.1 | User clicks "Load Everything" | API call to `/api/engine/execute-all` | POST request sent |
| B.2 | Backend validates no run in progress | Check `execution.PipelineRun` WHERE `Status = 'InProgress'` | If exists, return error "Pipeline already running" |
| B.3 | Backend creates new run record | INSERT into `execution.PipelineRun` with `Status = 'InProgress'`, return `run_id` | Run ID returned (UUID) |
| B.4 | Backend queues all entities | Populate `execution.PipelineLandingzoneEntity`, `execution.PipelineBronzeLayerEntity`, `execution.PipelineSilverLayerEntity` | 1,666 rows per table |
| B.5 | Backend triggers LZ pipeline | Call Fabric API: `POST /pipelines/{pipeline_id}/createRun` for `PL_FMD_LOAD_LANDINGZONE` | Fabric run ID returned |
| B.6 | Frontend receives `run_id` | Response: `{"success": true, "run_id": "<uuid>", "entity_count": 1666, "layers": ["LZ", "BRONZE", "SILVER"]}` | Response matches schema |
| B.7 | Frontend navigates to Engine Control page | If not already on `/engine`, navigate to `/engine?run_id=<run_id>` | URL changes, page shows live monitor |
| B.8 | Live log panel opens automatically | SSE connection to `/api/engine/logs/stream?run_id=<run_id>` | Log entries appear in real-time |
| B.9 | Progress KPIs update every 5 seconds | Poll `/api/engine/status` | KPIs show: "234 / 1666 (14.0%) complete" |
| B.10 | Execution completes | Engine status changes to "idle", final status = "Succeeded" or "Failed" | Status badge updates |

### C. Progress Indicators

| # | Indicator | Display | Validation |
|---|-----------|---------|-----------|
| C.1 | Total entities processed | "1,234 / 1,666 entities (74%)" | Matches `SELECT COUNT(*) FROM execution.EntityStatus WHERE RunId = <run_id> AND Status IN ('Succeeded', 'Failed')` |
| C.2 | Current layer | "Current Layer: Bronze" | Matches most recent layer being processed |
| C.3 | Layer progress bars | 3 bars: LZ, Bronze, Silver with percentage | LZ bar: (LZ succeeded + failed) / 1666 × 100% |
| C.4 | Duration timer | "Duration: 00:23:45" | Updates every second, formatted as HH:MM:SS |
| C.5 | Estimated time remaining | "Est. remaining: 01:12:30" | Calculated from avg entity duration × remaining entities |
| C.6 | Success/Failure counts | "✅ 1,234  ❌ 12  ⏳ 420" | Success count + failure count + pending count = 1,666 per layer |

### D. Completion Summary

| # | Component | Display | Validation |
|---|-----------|---------|-----------|
| D.1 | Success toast notification | "✅ Pipeline completed! 1,666 entities loaded successfully." | Shows when `Status = 'Succeeded'` AND failures = 0 |
| D.2 | Partial success toast | "⚠️ Pipeline completed with errors. 1,654 / 1,666 entities succeeded." | Shows when failures > 0 but < 50% |
| D.3 | Failure toast | "❌ Pipeline failed. 834 / 1,666 entities failed." | Shows when failures >= 50% |
| D.4 | Duration summary | "Completed in 1h 23m 45s" | Formatted duration from `EndDate - StartDate` |
| D.5 | Rows processed summary | "Total rows processed: 47,123,456" | Sum of `TotalRowsWritten` from all EntityStatus records |
| D.6 | Link to detailed logs | "View detailed logs →" | Links to `/logs?run_id=<run_id>` |
| D.7 | Link to failures (if any) | "View 12 failures →" | Links to `/logs?run_id=<run_id>&status=failed` |

### E. Error Handling

| # | Scenario | Expected Behavior |
|---|----------|------------------|
| E.1 | Click while engine already running | Show error toast: "Pipeline already running. Please wait for completion." |
| E.2 | No entities active | Show error toast: "No active entities found. Please add sources first." |
| E.3 | Fabric workspace unreachable | Show error toast: "Cannot connect to Fabric. Check network connection." |
| E.4 | Pipeline trigger fails | Show error toast: "Failed to trigger pipeline: <error message>" |
| E.5 | User navigates away during execution | Execution continues in background, show notification on return: "Pipeline still running" |
| E.6 | Browser closed during execution | Execution continues in Fabric, user can resume monitoring by returning to `/engine` |

### F. Confirmation Dialog (Optional Enhancement)

| # | Check | Validation |
|---|-------|-----------|
| F.1 | Show confirmation dialog on first click | "Are you sure you want to load all 1,666 entities? This may take 1-3 hours." | Dialog renders |
| F.2 | Dialog shows estimated duration | "Estimated duration: 1h 30m (based on previous runs)" | Duration calculated from historical average |
| F.3 | Dialog shows resource impact | "This will process approximately 50M rows." | Row count estimate from metadata |
| F.4 | User can cancel | Click "Cancel" → dialog closes, no execution | No API call made |
| F.5 | User can confirm | Click "Load Everything" → dialog closes, execution starts | API call proceeds |
| F.6 | "Don't show this again" checkbox | User can suppress future confirmations | Preference saved to localStorage |

---

## Implementation Steps

### Step 1: Add "Load Everything" Button to Engine Control

**File:** `dashboard/app/src/pages/EngineControl.tsx`

```tsx
// Add to existing button group
<div className="flex gap-4">
  {/* Existing Execute button */}
  <Button
    variant="default"
    onClick={handleExecute}
    disabled={engineStatus === 'running'}
  >
    <Play className="w-4 h-4 mr-2" />
    Execute
  </Button>

  {/* NEW: Load Everything button */}
  <Button
    variant="default"
    onClick={handleLoadEverything}
    disabled={engineStatus === 'running'}
    className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
  >
    <Rocket className="w-4 h-4 mr-2" />
    Load Everything
  </Button>

  {/* Existing Stop button */}
  <Button
    variant="destructive"
    onClick={handleStop}
    disabled={engineStatus !== 'running'}
  >
    <Square className="w-4 h-4 mr-2" />
    Stop
  </Button>
</div>
```

**Handler:**

```tsx
const handleLoadEverything = async () => {
  // Optional: Show confirmation dialog
  const confirmed = await showConfirmation({
    title: "Load Everything?",
    message: `This will load all 1,666 entities across Landing Zone, Bronze, and Silver layers.`,
    estimatedDuration: "1-3 hours",
    confirmLabel: "Load Everything",
    cancelLabel: "Cancel",
  });

  if (!confirmed) return;

  try {
    setLoading(true);
    const response = await fetch('/api/engine/execute-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();

    // Navigate to this page with run_id to show progress
    navigate(`/engine?run_id=${data.run_id}`);

    toast({
      title: "✅ Pipeline started",
      description: `Loading ${data.entity_count} entities across ${data.layers.length} layers`,
    });
  } catch (error) {
    toast({
      title: "❌ Failed to start pipeline",
      description: error.message,
      variant: "destructive",
    });
  } finally {
    setLoading(false);
  }
};
```

### Step 2: Add "Load Everything" Button to Source Manager

**File:** `dashboard/app/src/pages/SourceManager.tsx`

```tsx
// Add to toolbar (already implemented in Task 003)
<div className="flex gap-4">
  <Button
    variant="default"
    onClick={() => setWizardOpen(true)}
  >
    <PlusCircle className="w-4 h-4 mr-2" />
    Add Source
  </Button>

  <Button
    variant="default"
    onClick={handleLoadEverything}
    disabled={engineStatus === 'running'}
    className="bg-gradient-to-r from-green-600 to-blue-600"
  >
    <Rocket className="w-4 h-4 mr-2" />
    Load Everything
  </Button>
</div>
```

Handler uses same logic as Engine Control.

### Step 3: Create Backend Endpoint

**File:** `dashboard/app/api/server.py`

```python
@app.post("/api/engine/execute-all")
async def execute_all():
    """Execute full pipeline for all entities (LZ → Bronze → Silver)."""
    from src.core.pipeline_executor import PipelineExecutor
    from dashboard.app.api.control_plane_db import execute_fabric_sql

    # Check if a run is already in progress
    result = execute_fabric_sql(
        "SELECT COUNT(*) FROM execution.PipelineRun WHERE Status = 'InProgress'"
    )
    if result[0][0] > 0:
        raise HTTPException(
            status_code=409,
            detail="Pipeline already running. Please wait for completion."
        )

    # Check if any entities are active
    result = execute_fabric_sql(
        "SELECT COUNT(*) FROM integration.PipelineLandingzoneEntity WHERE IsActive = 1"
    )
    entity_count = result[0][0]
    if entity_count == 0:
        raise HTTPException(
            status_code=400,
            detail="No active entities found. Please add sources first."
        )

    # Create new run
    run_id = str(uuid.uuid4())
    execute_fabric_sql(
        """
        INSERT INTO execution.PipelineRun (RunId, Status, StartDate, Layers)
        VALUES (?, 'InProgress', GETDATE(), 'LZ,BRONZE,SILVER')
        """,
        (run_id,)
    )

    # Queue all entities for all layers
    execute_fabric_sql("EXEC execution.sp_RefreshPipelineQueues")

    # Trigger pipeline execution (async)
    executor = PipelineExecutor()
    asyncio.create_task(executor.execute_full_load(run_id))

    return {
        "success": True,
        "run_id": run_id,
        "entity_count": entity_count,
        "layers": ["LZ", "BRONZE", "SILVER"],
        "message": f"Pipeline started for {entity_count} entities across 3 layers",
    }
```

### Step 4: Implement Progress Monitoring

**File:** `dashboard/app/src/components/ExecutionProgress.tsx` (new component)

```tsx
import React, { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

interface ExecutionProgressProps {
  runId: string;
}

export function ExecutionProgress({ runId }: ExecutionProgressProps) {
  const [progress, setProgress] = useState({
    total: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    current_layer: 'LZ',
    duration_seconds: 0,
    estimated_remaining_seconds: 0,
  });

  useEffect(() => {
    // Poll progress every 5 seconds
    const interval = setInterval(async () => {
      const response = await fetch(`/api/engine/progress?run_id=${runId}`);
      const data = await response.json();
      setProgress(data);
    }, 5000);

    return () => clearInterval(interval);
  }, [runId]);

  const percentComplete = progress.total > 0
    ? ((progress.succeeded + progress.failed) / progress.total) * 100
    : 0;

  return (
    <div className="space-y-4 p-6 border rounded-lg">
      <h3 className="text-lg font-semibold">Execution Progress</h3>

      {/* Overall progress bar */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span>Total Progress</span>
          <span className="font-mono">{percentComplete.toFixed(1)}%</span>
        </div>
        <Progress value={percentComplete} className="h-3" />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{progress.succeeded + progress.failed} / {progress.total} entities</span>
          <span>Current Layer: {progress.current_layer}</span>
        </div>
      </div>

      {/* Status counts */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <span className="font-mono text-lg">{progress.succeeded}</span>
          <span className="text-sm text-muted-foreground">Succeeded</span>
        </div>
        <div className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-600" />
          <span className="font-mono text-lg">{progress.failed}</span>
          <span className="text-sm text-muted-foreground">Failed</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600" />
          <span className="font-mono text-lg">{progress.pending}</span>
          <span className="text-sm text-muted-foreground">Pending</span>
        </div>
      </div>

      {/* Time indicators */}
      <div className="flex gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Duration:</span>
          <span className="ml-2 font-mono">{formatDuration(progress.duration_seconds)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Est. Remaining:</span>
          <span className="ml-2 font-mono">{formatDuration(progress.estimated_remaining_seconds)}</span>
        </div>
      </div>

      {/* Layer progress bars */}
      <div className="space-y-2">
        <LayerProgressBar layer="LZ" progress={progress.lz_progress} />
        <LayerProgressBar layer="Bronze" progress={progress.bronze_progress} />
        <LayerProgressBar layer="Silver" progress={progress.silver_progress} />
      </div>
    </div>
  );
}

function LayerProgressBar({ layer, progress }: { layer: string; progress: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{layer}</span>
        <span className="font-mono">{progress.toFixed(0)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
```

### Step 5: Add Progress API Endpoint

**File:** `dashboard/app/api/server.py`

```python
@app.get("/api/engine/progress")
async def get_execution_progress(run_id: str):
    """Get real-time progress for a pipeline run."""
    from dashboard.app.api.control_plane_db import execute_fabric_sql

    # Get overall stats
    stats = execute_fabric_sql(
        """
        SELECT
            COUNT(*) AS Total,
            SUM(CASE WHEN Status = 'Succeeded' THEN 1 ELSE 0 END) AS Succeeded,
            SUM(CASE WHEN Status = 'Failed' THEN 1 ELSE 0 END) AS Failed,
            SUM(CASE WHEN Status = 'InProgress' THEN 1 ELSE 0 END) AS Pending
        FROM execution.EntityStatus
        WHERE RunId = ?
        """,
        (run_id,)
    )[0]

    # Get current layer
    current_layer = execute_fabric_sql(
        """
        SELECT TOP 1 LayerKey
        FROM execution.EntityStatus
        WHERE RunId = ? AND Status = 'InProgress'
        ORDER BY StartDate DESC
        """,
        (run_id,)
    )
    current_layer = current_layer[0][0] if current_layer else 'SILVER'

    # Get duration
    run_info = execute_fabric_sql(
        """
        SELECT
            DATEDIFF(SECOND, StartDate, ISNULL(EndDate, GETDATE())) AS DurationSeconds
        FROM execution.PipelineRun
        WHERE RunId = ?
        """,
        (run_id,)
    )[0]

    # Estimate remaining time
    avg_duration = execute_fabric_sql(
        """
        SELECT AVG(DATEDIFF(SECOND, StartDate, EndDate)) AS AvgDuration
        FROM execution.EntityStatus
        WHERE RunId = ? AND Status IN ('Succeeded', 'Failed')
        """,
        (run_id,)
    )[0][0] or 60  # Default 60 seconds if no completions yet

    remaining_entities = stats[0] - stats[1] - stats[2]  # Total - Succeeded - Failed
    estimated_remaining = remaining_entities * avg_duration

    # Layer-specific progress
    lz_progress = execute_fabric_sql(
        """
        SELECT
            (CAST(SUM(CASE WHEN Status IN ('Succeeded', 'Failed') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100
        FROM execution.EntityStatus
        WHERE RunId = ? AND LayerKey = 'LZ'
        """,
        (run_id,)
    )[0][0] or 0

    bronze_progress = execute_fabric_sql(
        """
        SELECT
            (CAST(SUM(CASE WHEN Status IN ('Succeeded', 'Failed') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100
        FROM execution.EntityStatus
        WHERE RunId = ? AND LayerKey = 'BRONZE'
        """,
        (run_id,)
    )[0][0] or 0

    silver_progress = execute_fabric_sql(
        """
        SELECT
            (CAST(SUM(CASE WHEN Status IN ('Succeeded', 'Failed') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)) * 100
        FROM execution.EntityStatus
        WHERE RunId = ? AND LayerKey = 'SILVER'
        """,
        (run_id,)
    )[0][0] or 0

    return {
        "total": stats[0],
        "succeeded": stats[1],
        "failed": stats[2],
        "pending": stats[3],
        "current_layer": current_layer,
        "duration_seconds": run_info[0],
        "estimated_remaining_seconds": int(estimated_remaining),
        "lz_progress": lz_progress,
        "bronze_progress": bronze_progress,
        "silver_progress": silver_progress,
    }
```

---

## Validation Script

**File:** `tests/e2e/test_load_everything_button.spec.ts` (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Load Everything Button', () => {
  test('button visible on Engine Control page', async ({ page }) => {
    await page.goto('/engine');
    const button = page.getByRole('button', { name: /load everything/i });
    await expect(button).toBeVisible();
  });

  test('button disabled when engine running', async ({ page }) => {
    // Mock API to return "running" status
    await page.route('/api/engine/status', async (route) => {
      await route.fulfill({
        json: { status: 'running' },
      });
    });
    await page.goto('/engine');
    const button = page.getByRole('button', { name: /load everything/i });
    await expect(button).toBeDisabled();
  });

  test('clicking button triggers execution', async ({ page }) => {
    await page.goto('/engine');

    // Mock API response
    await page.route('/api/engine/execute-all', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          run_id: '12345678-1234-1234-1234-123456789012',
          entity_count: 1666,
          layers: ['LZ', 'BRONZE', 'SILVER'],
        },
      });
    });

    const button = page.getByRole('button', { name: /load everything/i });
    await button.click();

    // Should show success toast
    await expect(page.getByText(/pipeline started/i)).toBeVisible();

    // Should navigate to engine page with run_id
    await expect(page).toHaveURL(/\/engine\?run_id=/);
  });

  test('shows confirmation dialog', async ({ page }) => {
    await page.goto('/engine');
    const button = page.getByRole('button', { name: /load everything/i });
    await button.click();

    // Confirmation dialog should appear
    await expect(page.getByText(/are you sure/i)).toBeVisible();
    await expect(page.getByText(/1,666 entities/i)).toBeVisible();

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/are you sure/i)).not.toBeVisible();
  });

  test('progress updates during execution', async ({ page }) => {
    await page.goto('/engine?run_id=test-run-123');

    // Mock progress API
    await page.route('/api/engine/progress*', async (route) => {
      await route.fulfill({
        json: {
          total: 1666,
          succeeded: 500,
          failed: 2,
          pending: 1164,
          current_layer: 'BRONZE',
          duration_seconds: 1234,
          estimated_remaining_seconds: 3456,
        },
      });
    });

    // Progress component should render
    await expect(page.getByText(/execution progress/i)).toBeVisible();
    await expect(page.getByText(/500/)).toBeVisible();  // Succeeded count
    await expect(page.getByText(/current layer: bronze/i)).toBeVisible();
  });
});
```

**Run Playwright test:**

```bash
cd dashboard/app
npx playwright test test_load_everything_button.spec.ts
```

---

## Cross-Reference

- **DEFINITION-OF-DONE.md**: Section 9 ("Run Everything" Button)
- **TEST-PLAN.md**: T-INT-12b (Load Everything button tests)
- **TASK 002**: Execute Full Bronze/Silver Load (this button triggers that flow)
- **TASK 003**: Source Onboarding Wizard (button also appears on Source Manager)

---

## Dependencies

- **Blocked by**: Task 001 (Entity Activation) — entities must be active
- **Blocked by**: Task 002 (Full Load working) — button triggers full load
- **Blocks**: None (enhances UX but not blocking)

---

## Sign-Off

- [ ] "Load Everything" button visible on Engine Control page
- [ ] "Load Everything" button visible on Source Manager page
- [ ] Button disabled when engine running
- [ ] Click triggers full pipeline execution (LZ + Bronze + Silver)
- [ ] API endpoint `/api/engine/execute-all` works
- [ ] Progress component shows live updates
- [ ] Completion summary shows stats
- [ ] Error handling works for all failure scenarios
- [ ] Playwright E2E test passes
- [ ] Manual testing: click button → all 1,666 entities load successfully

**Completed by**: ___________
**Date**: ___________
**Verified by**: ___________
