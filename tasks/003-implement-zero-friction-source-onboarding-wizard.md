# TASK 003: Implement Zero-Friction Source Onboarding Wizard

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09
> **Category**: feature
> **Complexity**: large
> **Impact**: critical
> **Agent**: ui-specialist, backend-architect

---

## Problem Statement

> **Steve's words**: "When they add a source to the system, they expect that every single table they added is ready to import and run the pipeline to load across the entire architecture."

**Current state (BROKEN):**
Adding a new source requires **7 manual steps** with deep framework knowledge:
1. Create SQL connection in Fabric
2. Create gateway connection
3. Register data source
4. Manually enumerate tables
5. Manually discover primary keys and watermark columns
6. Register Landing Zone entities
7. Register Bronze entities
8. Register Silver entities

This is **NOT ACCEPTABLE** for end users.

**Target state (FIXED):**
Adding a source is **ONE operation**: User clicks "Add Source" → enters connection details → clicks Confirm → **everything else is automatic**.

---

## Scope

### In Scope

- [ ] Single-button "Add Source" wizard on `/sources` page
- [ ] Step 1: Connection details form (server, database, auth)
- [ ] Step 2: Test connection via Fabric Gateway API
- [ ] Step 3: Auto-discover all tables via `INFORMATION_SCHEMA.TABLES`
- [ ] Step 4: Auto-analyze each table (PKs, watermark columns, load method)
- [ ] Step 5: Auto-register entities across LZ + Bronze + Silver (single operation)
- [ ] Step 6: Seed local SQLite control plane
- [ ] Step 7: Show summary ("Added X tables, Y incremental, Z full load")
- [ ] User can deselect specific tables before registering
- [ ] Default: **ALL tables selected** (user opts out, not opt in)
- [ ] Error handling: partial success (register what worked, report failures)
- [ ] "Load All" button to immediately execute pipeline after adding source

### Out of Scope

- Custom transformation rules (future feature)
- Schema evolution detection (future feature)
- Multi-database sources (single database per wizard run)
- Advanced watermark column override (auto-detection only)
- Editing existing source configurations (delete + re-add for now)

---

## UX Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Source Manager Page (/sources)                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ [ + Add Source ]  [ Refresh ]  [ Load All ]          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                               │
│  ╔═══════════════════════════════════════════════════════╗  │
│  ║ ETQ (29 entities)                                     ║  │
│  ║ MES (445 entities)                                    ║  │
│  ║ M3 ERP (596 entities)                                 ║  │
│  ║ M3 Cloud (187 entities)                               ║  │
│  ║ OPTIVA (409 entities)                                 ║  │
│  ╚═══════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────┘

User clicks "Add Source" ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 1 of 4: Connection Details                              │
│                                                               │
│ Source Name: [___________________________]                   │
│              (e.g., "SAP", "CRM", "Legacy ERP")              │
│                                                               │
│ SQL Server:  [___________________________]                   │
│              (e.g., "sql-server.company.com")                │
│                                                               │
│ Database:    [___________________________]                   │
│              (e.g., "Production_DB")                         │
│                                                               │
│ Authentication:                                               │
│   ○ Windows Authentication                                   │
│   ● SQL Server Authentication                                │
│                                                               │
│ Username:    [___________________________]                   │
│ Password:    [***************************]                   │
│                                                               │
│ Gateway:     [ Select Gateway ▼ ]                            │
│              (e.g., "On-Premises Data Gateway 1")            │
│                                                               │
│               [Test Connection]  [Cancel]  [Next →]          │
│                                                               │
└─────────────────────────────────────────────────────────────┘

User clicks "Test Connection" ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 1 of 4: Connection Details                              │
│                                                               │
│ ✅ Connection successful!                                    │
│ Database: "Production_DB" (SQL Server 2019)                  │
│ Schema count: 5                                               │
│                                                               │
│ [Source Name]: CRM_System                                    │
│ [SQL Server]: sql-server.company.com                         │
│ [Database]: Production_DB                                    │
│ [Auth]: SQL Server Authentication                            │
│ [Username]: fmd_reader                                       │
│ [Gateway]: On-Premises Data Gateway 1                        │
│                                                               │
│               [Test Again]  [Cancel]  [Next →]               │
│                                                               │
└─────────────────────────────────────────────────────────────┘

User clicks "Next" ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 2 of 4: Discover Tables                                 │
│                                                               │
│ ⏳ Discovering tables in "Production_DB"...                  │
│                                                               │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ Progress:  [████████████████────────────]  73%        ║  │
│ ║                                                        ║  │
│ ║ Querying INFORMATION_SCHEMA.TABLES...                 ║  │
│ ║ Found 147 tables                                      ║  │
│ ║                                                        ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                                                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘

After discovery completes ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 3 of 4: Select Tables                                   │
│                                                               │
│ Found 147 tables in "Production_DB"                          │
│ [✓] Select All    [ ] Deselect All                           │
│                                                               │
│ Search: [_____________________]  [🔍]                        │
│                                                               │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ [✓] dbo.Customers                    (1.2M rows)      ║  │
│ ║ [✓] dbo.Orders                       (3.4M rows)      ║  │
│ ║ [✓] dbo.OrderDetails                 (8.7M rows)      ║  │
│ ║ [✓] dbo.Products                     (45K rows)       ║  │
│ ║ [✓] dbo.Suppliers                    (2.3K rows)      ║  │
│ ║ [ ] sys.database_firewall_rules      (SYSTEM)        ║  │
│ ║ ...                                                    ║  │
│ ║                                                        ║  │
│ ║ Showing 147 tables                                    ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                                                               │
│               [← Back]  [Cancel]  [Next →]                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘

User clicks "Next" ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 4 of 4: Analyzing Tables...                             │
│                                                               │
│ ⏳ Auto-detecting primary keys and load methods...           │
│                                                               │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ Progress:  [████████────────────────]  47%            ║  │
│ ║                                                        ║  │
│ ║ Analyzing: dbo.Customers                              ║  │
│ ║ ✅ PK: CustomerID (int)                               ║  │
│ ║ ✅ Watermark: ModifiedDate (datetime2) → INCREMENTAL  ║  │
│ ║                                                        ║  │
│ ║ Analyzing: dbo.Orders                                 ║  │
│ ║ ✅ PK: OrderID (int)                                  ║  │
│ ║ ⚠️  No watermark found → FULL LOAD                    ║  │
│ ║                                                        ║  │
│ ║ Completed: 68 / 145 tables                            ║  │
│ ║                                                        ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                                                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘

Analysis completes ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Step 4 of 4: Review and Confirm                              │
│                                                               │
│ ✅ Analysis complete!                                        │
│                                                               │
│ Summary:                                                      │
│ • Total tables: 145 (2 system tables excluded)               │
│ • Incremental loads: 112 tables (77%)                        │
│ • Full loads: 33 tables (23%)                                │
│ • Total estimated rows: 47.3M                                │
│                                                               │
│ Load Method Breakdown:                                        │
│ ┌───────────────────────────────────────────────┐            │
│ │ Incremental  [████████████████████░░░░░]  77% │            │
│ │ Full Load    [██████░░░░░░░░░░░░░░░░░░░]  23% │            │
│ └───────────────────────────────────────────────┘            │
│                                                               │
│ Next Steps:                                                   │
│ • Register 145 entities in Landing Zone, Bronze, Silver      │
│ • Add to pipeline execution queues                            │
│ • Ready to run "Load All"                                    │
│                                                               │
│ ⚠️  This will create 435 total entities (145 × 3 layers)    │
│                                                               │
│               [← Back]  [Cancel]  [Confirm and Register]     │
│                                                               │
└─────────────────────────────────────────────────────────────┘

User clicks "Confirm and Register" ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ Registering Entities...                                       │
│                                                               │
│ ╔═══════════════════════════════════════════════════════╗  │
│ ║ Progress:  [████████████████████████]  100%           ║  │
│ ║                                                        ║  │
│ ║ ✅ Landing Zone: 145 / 145 entities registered        ║  │
│ ║ ✅ Bronze Layer: 145 / 145 entities registered        ║  │
│ ║ ✅ Silver Layer: 145 / 145 entities registered        ║  │
│ ║ ✅ Local SQLite synced                                ║  │
│ ║ ✅ Pipeline queues updated                            ║  │
│ ║                                                        ║  │
│ ║ Registered 435 entities in 23.7 seconds               ║  │
│ ║                                                        ║  │
│ ╚═══════════════════════════════════════════════════════╝  │
│                                                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘

Success ↓

┌─────────────────────────────────────────────────────────────┐
│ Add New Source                                          [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│ ✅ Source Added Successfully!                                │
│                                                               │
│ Source: CRM_System                                            │
│ Tables: 145                                                   │
│ • Incremental: 112 tables                                    │
│ • Full load: 33 tables                                       │
│ • Total entities created: 435 (145 × 3 layers)               │
│                                                               │
│ All entities are now:                                         │
│ ✅ Registered in Landing Zone, Bronze, and Silver            │
│ ✅ Added to pipeline execution queues                        │
│ ✅ Ready to load immediately                                 │
│                                                               │
│ Next Steps:                                                   │
│ • Click "Load All" to run full pipeline                      │
│ • Or navigate to Engine Control to configure execution       │
│                                                               │
│               [Load All Now]  [View in Source Manager]       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Acceptance Criteria (Binary Checklist)

### A. UI Components

| # | Component | Validation |
|---|-----------|-----------|
| A.1 | "Add Source" button visible on `/sources` page | Button renders, click opens wizard modal |
| A.2 | Wizard modal renders with 4 steps indicator | Step 1/4 shown at top |
| A.3 | Connection form fields present | Source name, server, database, auth, username, password, gateway selector |
| A.4 | "Test Connection" button enabled when all required fields filled | Button disabled when fields empty, enabled when valid |
| A.5 | Connection success indicator | Green checkmark + connection details shown |
| A.6 | Table discovery progress bar | Animated progress during `INFORMATION_SCHEMA` query |
| A.7 | Table selection grid with checkboxes | All tables shown, all checked by default |
| A.8 | "Select All" / "Deselect All" toggles | Click toggles all table checkboxes |
| A.9 | Table search box filters list | Type "Customer", only matching tables shown |
| A.10 | Analysis progress indicator | Live updates showing current table being analyzed |
| A.11 | Summary view shows load method breakdown | Pie chart or bar: incremental vs full load percentages |
| A.12 | Confirm button enabled only after analysis completes | Disabled during analysis, enabled when done |
| A.13 | Registration progress indicator | Shows LZ, Bronze, Silver registration progress |
| A.14 | Success screen with summary stats | Total entities, load methods, next steps |
| A.15 | "Load All Now" button on success screen | Click triggers engine execution |

### B. Backend API Endpoints

| # | Endpoint | Method | Request | Response | Validation |
|---|----------|--------|---------|----------|-----------|
| B.1 | `/api/sources/test-connection` | POST | `{server, database, auth_type, username, password, gateway_id}` | `{success: bool, message: str, db_version: str, schema_count: int}` | Success = true when connection valid |
| B.2 | `/api/sources/discover-tables` | POST | `{connection_details, exclude_system_tables: true}` | `{tables: [{schema, table_name, row_count_estimate}]}` | Returns 100+ tables for typical source |
| B.3 | `/api/sources/analyze-table` | POST | `{connection_details, schema, table_name}` | `{pk_columns: [], watermark_column: str?, load_method: "incremental"|"full"}` | Returns PK + watermark for each table |
| B.4 | `/api/sources/analyze-batch` | POST | `{connection_details, tables: [{schema, table_name}]}` | `{results: [{table, pk_columns, watermark_column, load_method}]}` | Batch analysis for performance |
| B.5 | `/api/sources/register-source` | POST | `{source_name, connection_details, tables: [{schema, table_name, pk_columns, watermark_column, load_method}]}` | `{success: bool, entities_created: {lz: int, bronze: int, silver: int}, source_id: str}` | Registers all entities across 3 layers |
| B.6 | `/api/sources/validate-source-name` | GET | `?source_name=CRM` | `{available: bool, message: str}` | Returns false if source name already exists |

### C. Auto-Discovery Logic

| # | Check | Validation |
|---|-------|-----------|
| C.1 | Query `INFORMATION_SCHEMA.TABLES` for table list | Returns all user tables (excludes system tables like `sys.*`, `INFORMATION_SCHEMA.*`) |
| C.2 | Exclude system schemas | Filters out: `sys`, `INFORMATION_SCHEMA`, `msdb`, `master`, `tempdb` |
| C.3 | Discover primary keys via `sp_pkeys` | Returns PK column(s) for each table |
| C.4 | Fallback: Discover PKs via `sys.indexes` WHERE `is_primary_key = 1` | If `sp_pkeys` fails, use system catalog |
| C.5 | Discover watermark candidates | Query for datetime/datetime2/date columns |
| C.6 | Exclude binary watermark types | **NEVER** suggest `rowversion`, `timestamp`, `binary`, `varbinary` as watermark (see BURNED-BRIDGES.md) |
| C.7 | Rank watermark candidates | Prefer: `ModifiedDate` > `UpdatedDate` > `LastModified` > `CreateDate` > any datetime column |
| C.8 | Classify load method | IF watermark_column exists → `"incremental"`, ELSE → `"full"` |
| C.9 | Estimate row counts | Use `sys.dm_db_partition_stats` for fast estimates |
| C.10 | Handle tables without PKs | Log warning, register as full-load only, use all columns as natural key |

### D. Entity Registration

| # | Check | Validation |
|---|-------|-----------|
| D.1 | Call `sp_UpsertPipelineLandingzoneEntity` for each table | IsActive = 1, WatermarkColumn set if incremental |
| D.2 | Call `sp_UpsertPipelineBronzeLayerEntity` for each table | IsActive = 1, inherits config from LZ entity |
| D.3 | Call `sp_UpsertPipelineSilverLayerEntity` for each table | IsActive = 1, SCD Type 2 enabled |
| D.4 | Set `IsIncremental` flag correctly | True if watermark exists, False if full load |
| D.5 | Set `PrimaryKeyColumns` as JSON array | E.g., `["CustomerID"]` or `["OrderID", "LineNumber"]` |
| D.6 | Set `NaturalKeyColumns` for Silver | Same as PK for most tables |
| D.7 | Set `WatermarkColumn` for incremental entities | E.g., `"ModifiedDate"` |
| D.8 | Generate unique `LandingzoneEntityId`, `BronzeLayerEntityId`, `SilverLayerEntityId` | Auto-incremented integers |
| D.9 | Write to local SQLite control plane | Dual-write: Fabric SQL + local SQLite |
| D.10 | Refresh pipeline queues | Call `sp_RefreshPipelineQueues` after registration |

### E. Error Handling

| # | Scenario | Expected Behavior |
|---|----------|------------------|
| E.1 | Connection test fails | Show error message with reason (e.g., "Server not found", "Invalid credentials") |
| E.2 | Gateway unavailable | Show "Gateway offline" error, list of available gateways |
| E.3 | Table discovery times out | Show partial results + "Timed out after 60s, showing X / Y tables" |
| E.4 | Primary key discovery fails for some tables | Register those tables as full-load with warning badge |
| E.5 | Registration fails for subset of tables | Partial success: register what worked, show error list for failures |
| E.6 | Duplicate source name | Show "Source name already exists, choose a different name" |
| E.7 | User cancels wizard mid-process | Rollback any partial registrations, return to source list |
| E.8 | Network error during analysis | Retry 3 times, then fail gracefully with error report |

### F. "Load All" Button

| # | Check | Validation |
|---|-------|-----------|
| F.1 | "Load All" button visible on SourceManager page | Button renders at top of page |
| F.2 | Click triggers full pipeline execution | POST to `/api/engine/execute` with `layers: ["landing", "bronze", "silver"]` |
| F.3 | No layer checkboxes required | Default behavior: run all layers for all entities |
| F.4 | Redirects to Engine Control page after trigger | Navigate to `/engine` to show live progress |
| F.5 | Shows execution in progress indicator | Status badge updates to "Running" |
| F.6 | Completion summary shown | "Loaded X / Y entities, Z failed" |

---

## Implementation Steps

### Step 1: Create UI Components

**Files:**
- `dashboard/app/src/components/SourceOnboardingWizard.tsx` (new file)
- `dashboard/app/src/components/SourceManager.tsx` (update: add "Add Source" button)

**Component structure:**

```tsx
// SourceOnboardingWizard.tsx
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

interface SourceOnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (sourceId: string) => void;
}

type WizardStep = 'connection' | 'discover' | 'select' | 'analyze' | 'confirm' | 'register' | 'success';

export function SourceOnboardingWizard({ open, onClose, onSuccess }: SourceOnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>('connection');
  const [connectionDetails, setConnectionDetails] = useState({
    sourceName: '',
    server: '',
    database: '',
    authType: 'sql',
    username: '',
    password: '',
    gatewayId: '',
  });
  const [connectionValid, setConnectionValid] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const testConnection = async () => {
    setProgress(0);
    try {
      const response = await fetch('/api/sources/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectionDetails),
      });
      const data = await response.json();
      if (data.success) {
        setConnectionValid(true);
        toast({ title: '✅ Connection successful', description: `Connected to ${data.db_version}` });
      } else {
        toast({ title: '❌ Connection failed', description: data.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: '❌ Connection error', description: error.message, variant: 'destructive' });
    }
  };

  const discoverTables = async () => {
    setStep('discover');
    setProgress(0);
    try {
      const response = await fetch('/api/sources/discover-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...connectionDetails, exclude_system_tables: true }),
      });
      const data = await response.json();
      setTables(data.tables);
      // Select all tables by default
      setSelectedTables(new Set(data.tables.map(t => `${t.schema}.${t.table_name}`)));
      setProgress(100);
      setStep('select');
    } catch (error) {
      toast({ title: '❌ Discovery failed', description: error.message, variant: 'destructive' });
    }
  };

  const analyzeTables = async () => {
    setStep('analyze');
    setProgress(0);
    const selectedTableList = Array.from(selectedTables).map(fqn => {
      const [schema, table_name] = fqn.split('.');
      return { schema, table_name };
    });

    try {
      // Batch analysis for performance
      const response = await fetch('/api/sources/analyze-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_details: connectionDetails,
          tables: selectedTableList,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let results = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const result = JSON.parse(line);
          results.push(result);
          setProgress((results.length / selectedTableList.length) * 100);
        }
      }

      setAnalysisResults(results);
      setStep('confirm');
    } catch (error) {
      toast({ title: '❌ Analysis failed', description: error.message, variant: 'destructive' });
    }
  };

  const registerSource = async () => {
    setStep('register');
    setProgress(0);
    try {
      const response = await fetch('/api/sources/register-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_name: connectionDetails.sourceName,
          connection_details: connectionDetails,
          tables: analysisResults,
        }),
      });
      const data = await response.json();
      setProgress(100);
      setStep('success');
      onSuccess(data.source_id);
    } catch (error) {
      toast({ title: '❌ Registration failed', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Source</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex justify-between mb-6">
          <StepIndicator step={1} current={step === 'connection'} label="Connection" />
          <StepIndicator step={2} current={step === 'discover' || step === 'select'} label="Discover" />
          <StepIndicator step={3} current={step === 'analyze'} label="Analyze" />
          <StepIndicator step={4} current={step === 'confirm' || step === 'register' || step === 'success'} label="Confirm" />
        </div>

        {/* Step content */}
        {step === 'connection' && (
          <ConnectionStep
            details={connectionDetails}
            onChange={setConnectionDetails}
            onTest={testConnection}
            onNext={discoverTables}
            connectionValid={connectionValid}
          />
        )}

        {step === 'discover' && (
          <DiscoverStep progress={progress} />
        )}

        {step === 'select' && (
          <SelectTablesStep
            tables={tables}
            selected={selectedTables}
            onChange={setSelectedTables}
            onNext={analyzeTables}
            onBack={() => setStep('connection')}
          />
        )}

        {step === 'analyze' && (
          <AnalyzeStep progress={progress} currentTable={analysisResults[analysisResults.length - 1]?.table_name} />
        )}

        {step === 'confirm' && (
          <ConfirmStep
            results={analysisResults}
            onConfirm={registerSource}
            onBack={() => setStep('select')}
          />
        )}

        {step === 'register' && (
          <RegisterStep progress={progress} />
        )}

        {step === 'success' && (
          <SuccessStep
            sourceName={connectionDetails.sourceName}
            tableCount={analysisResults.length}
            onClose={onClose}
            onLoadNow={() => {/* Navigate to engine control and trigger load */}}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### Step 2: Implement Backend Endpoints

**File:** `dashboard/app/api/sources.py` (new file)

```python
"""Source onboarding API endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import pyodbc
import json

router = APIRouter()

class ConnectionDetails(BaseModel):
    server: str
    database: str
    auth_type: str  # "windows" or "sql"
    username: Optional[str] = None
    password: Optional[str] = None
    gateway_id: str

class Table(BaseModel):
    schema: str
    table_name: str
    row_count_estimate: int = 0

class AnalysisResult(BaseModel):
    schema: str
    table_name: str
    pk_columns: List[str]
    watermark_column: Optional[str]
    load_method: str  # "incremental" or "full"
    watermark_type: Optional[str]  # "datetime2", "date", etc.

@router.post("/api/sources/test-connection")
async def test_connection(details: ConnectionDetails):
    """Test SQL Server connection via gateway."""
    try:
        conn_str = build_connection_string(details)
        conn = pyodbc.connect(conn_str, timeout=10)
        cursor = conn.cursor()

        # Get SQL Server version
        cursor.execute("SELECT @@VERSION AS Version")
        version = cursor.fetchone()[0]

        # Count schemas
        cursor.execute("SELECT COUNT(DISTINCT TABLE_SCHEMA) FROM INFORMATION_SCHEMA.TABLES")
        schema_count = cursor.fetchone()[0]

        conn.close()

        return {
            "success": True,
            "message": "Connection successful",
            "db_version": version.split('\n')[0],  # First line only
            "schema_count": schema_count,
        }
    except Exception as e:
        return {
            "success": False,
            "message": str(e),
        }

@router.post("/api/sources/discover-tables")
async def discover_tables(details: ConnectionDetails, exclude_system_tables: bool = True):
    """Discover all tables in the database."""
    try:
        conn_str = build_connection_string(details)
        conn = pyodbc.connect(conn_str, timeout=30)
        cursor = conn.cursor()

        # Query INFORMATION_SCHEMA.TABLES
        query = """
        SELECT
            TABLE_SCHEMA,
            TABLE_NAME,
            (SELECT SUM(rows) FROM sys.partitions p
             INNER JOIN sys.tables t ON p.object_id = t.object_id
             WHERE t.name = INFORMATION_SCHEMA.TABLES.TABLE_NAME) AS RowCount
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        """

        if exclude_system_tables:
            query += """
            AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA', 'msdb', 'master', 'tempdb')
            AND TABLE_NAME NOT LIKE 'sys%'
            """

        query += " ORDER BY TABLE_SCHEMA, TABLE_NAME"

        cursor.execute(query)
        tables = []
        for row in cursor.fetchall():
            tables.append({
                "schema": row[0],
                "table_name": row[1],
                "row_count_estimate": row[2] or 0,
            })

        conn.close()

        return {"tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/sources/analyze-batch")
async def analyze_batch(details: ConnectionDetails, tables: List[Table]):
    """Analyze multiple tables and stream results."""
    async def stream_results():
        conn_str = build_connection_string(details)
        conn = pyodbc.connect(conn_str, timeout=60)
        cursor = conn.cursor()

        for table in tables:
            try:
                result = analyze_single_table(cursor, table.schema, table.table_name)
                yield json.dumps(result) + "\n"
            except Exception as e:
                yield json.dumps({
                    "schema": table.schema,
                    "table_name": table.table_name,
                    "error": str(e),
                    "load_method": "full",  # Fallback to full load
                    "pk_columns": [],
                    "watermark_column": None,
                }) + "\n"

        conn.close()

    return StreamingResponse(stream_results(), media_type="application/x-ndjson")

def analyze_single_table(cursor, schema: str, table_name: str) -> dict:
    """Analyze a single table: discover PKs and watermark columns."""

    # 1. Discover primary key columns
    pk_query = f"EXEC sp_pkeys @table_name = '{table_name}', @table_owner = '{schema}'"
    cursor.execute(pk_query)
    pk_columns = [row[3] for row in cursor.fetchall()]  # COLUMN_NAME is column index 3

    if not pk_columns:
        # Fallback: query sys.indexes for PK
        pk_query_fallback = f"""
        SELECT c.name
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.is_primary_key = 1
        AND OBJECT_NAME(i.object_id) = '{table_name}'
        AND OBJECT_SCHEMA_NAME(i.object_id) = '{schema}'
        ORDER BY ic.key_ordinal
        """
        cursor.execute(pk_query_fallback)
        pk_columns = [row[0] for row in cursor.fetchall()]

    # 2. Discover watermark column candidates
    watermark_query = f"""
    SELECT
        c.name AS ColumnName,
        t.name AS DataType
    FROM sys.columns c
    INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID('[{schema}].[{table_name}]')
    AND t.name IN ('datetime', 'datetime2', 'date', 'datetimeoffset')
    ORDER BY
        CASE
            WHEN c.name LIKE '%Modified%' OR c.name LIKE '%Updated%' THEN 1
            WHEN c.name LIKE '%Created%' OR c.name LIKE '%Insert%' THEN 2
            ELSE 3
        END,
        c.name
    """
    cursor.execute(watermark_query)
    watermark_candidates = cursor.fetchall()

    watermark_column = None
    watermark_type = None
    if watermark_candidates:
        # Use the best candidate (first result)
        watermark_column = watermark_candidates[0][0]
        watermark_type = watermark_candidates[0][1]

    # 3. Determine load method
    load_method = "incremental" if watermark_column else "full"

    return {
        "schema": schema,
        "table_name": table_name,
        "pk_columns": pk_columns,
        "watermark_column": watermark_column,
        "watermark_type": watermark_type,
        "load_method": load_method,
    }

@router.post("/api/sources/register-source")
async def register_source(
    source_name: str,
    connection_details: ConnectionDetails,
    tables: List[AnalysisResult]
):
    """Register all entities across LZ, Bronze, Silver."""
    # Import control_plane_db to use stored procedures
    from dashboard.app.api.control_plane_db import execute_fabric_sql, execute_sqlite

    entities_created = {"lz": 0, "bronze": 0, "silver": 0}

    for table in tables:
        fq_table_name = f"{table.schema}.{table.table_name}"

        # Register Landing Zone entity
        lz_params = {
            "LandingZoneKey": "LZ",  # Hardcoded for now
            "TableName": fq_table_name,
            "IsActive": 1,
            "IsIncremental": 1 if table.load_method == "incremental" else 0,
            "WatermarkColumn": table.watermark_column,
            "PrimaryKeyColumns": json.dumps(table.pk_columns),
            "DataSourceKey": source_name,
        }
        execute_fabric_sql("EXEC integration.sp_UpsertPipelineLandingzoneEntity @LandingZoneKey=?, @TableName=?, @IsActive=?, @IsIncremental=?, @WatermarkColumn=?, @PrimaryKeyColumns=?, @DataSourceKey=?", lz_params.values())
        entities_created["lz"] += 1

        # Register Bronze entity
        bronze_params = {
            "BronzeLayerKey": "BRONZE",
            "TableName": fq_table_name,
            "IsActive": 1,
            "IsIncremental": 1 if table.load_method == "incremental" else 0,
            "WatermarkColumn": table.watermark_column,
            "PrimaryKeyColumns": json.dumps(table.pk_columns),
            "DataSourceKey": source_name,
        }
        execute_fabric_sql("EXEC integration.sp_UpsertPipelineBronzeLayerEntity @BronzeLayerKey=?, @TableName=?, @IsActive=?, @IsIncremental=?, @WatermarkColumn=?, @PrimaryKeyColumns=?, @DataSourceKey=?", bronze_params.values())
        entities_created["bronze"] += 1

        # Register Silver entity (SCD Type 2)
        silver_params = {
            "SilverLayerKey": "SILVER",
            "TableName": fq_table_name,
            "IsActive": 1,
            "NaturalKeyColumns": json.dumps(table.pk_columns),  # Use PK as natural key
            "SCDType": 2,
            "DataSourceKey": source_name,
        }
        execute_fabric_sql("EXEC integration.sp_UpsertPipelineSilverLayerEntity @SilverLayerKey=?, @TableName=?, @IsActive=?, @NaturalKeyColumns=?, @SCDType=?, @DataSourceKey=?", silver_params.values())
        entities_created["silver"] += 1

    # Refresh pipeline queues
    execute_fabric_sql("EXEC execution.sp_RefreshPipelineQueues")

    # Sync to local SQLite
    execute_sqlite("/* resync command */")

    return {
        "success": True,
        "entities_created": entities_created,
        "source_id": source_name,
    }

def build_connection_string(details: ConnectionDetails) -> str:
    """Build pyodbc connection string."""
    if details.auth_type == "windows":
        return f"DRIVER={{SQL Server}};SERVER={details.server};DATABASE={details.database};Trusted_Connection=yes;"
    else:
        return f"DRIVER={{SQL Server}};SERVER={details.server};DATABASE={details.database};UID={details.username};PWD={details.password};"
```

### Step 3: Add "Load All" Button

**File:** `dashboard/app/src/components/SourceManager.tsx`

```tsx
// Add to top of SourceManager component
<div className="flex justify-between items-center mb-6">
  <h1 className="text-3xl font-bold">Source Manager</h1>
  <div className="flex gap-4">
    <Button
      variant="default"
      onClick={() => setWizardOpen(true)}
      className="flex items-center gap-2"
    >
      <PlusCircle className="w-4 h-4" />
      Add Source
    </Button>
    <Button
      variant="outline"
      onClick={handleLoadAll}
      className="flex items-center gap-2"
    >
      <Play className="w-4 h-4" />
      Load All
    </Button>
  </div>
</div>

{/* Wizard modal */}
<SourceOnboardingWizard
  open={wizardOpen}
  onClose={() => setWizardOpen(false)}
  onSuccess={(sourceId) => {
    setWizardOpen(false);
    toast({ title: `✅ Source "${sourceId}" added successfully` });
    // Refresh source list
    refetchSources();
  }}
/>
```

**Load All handler:**

```tsx
const handleLoadAll = async () => {
  try {
    const response = await fetch('/api/engine/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layers: ['landing', 'bronze', 'silver'],
        mode: 'run',
        entity_filter: null,  // All entities
      }),
    });
    const data = await response.json();
    // Navigate to Engine Control to show progress
    navigate(`/engine?run_id=${data.run_id}`);
  } catch (error) {
    toast({ title: '❌ Load failed', description: error.message, variant: 'destructive' });
  }
};
```

---

## Validation Script

**File:** `scripts/validate_source_onboarding.py`

```python
"""Manual test script for source onboarding wizard."""

import requests

BASE_URL = "http://127.0.0.1:8787"

def test_source_onboarding():
    """Test the full onboarding flow."""

    print("\n" + "="*80)
    print("TASK 003 VALIDATION: Source Onboarding Wizard")
    print("="*80 + "\n")

    # Step 1: Test connection
    print("Step 1: Testing connection...")
    connection_details = {
        "server": "test-server.company.com",
        "database": "TestDB",
        "auth_type": "sql",
        "username": "test_user",
        "password": "test_pass",
        "gateway_id": "gateway-123",
    }
    response = requests.post(f"{BASE_URL}/api/sources/test-connection", json=connection_details)
    assert response.status_code == 200
    result = response.json()
    assert result["success"] is True
    print(f"✅ Connection successful: {result['db_version']}")

    # Step 2: Discover tables
    print("\nStep 2: Discovering tables...")
    response = requests.post(f"{BASE_URL}/api/sources/discover-tables", json=connection_details)
    assert response.status_code == 200
    tables = response.json()["tables"]
    assert len(tables) > 0
    print(f"✅ Discovered {len(tables)} tables")

    # Step 3: Analyze tables (batch)
    print("\nStep 3: Analyzing tables...")
    selected_tables = tables[:10]  # Test with first 10 tables
    response = requests.post(
        f"{BASE_URL}/api/sources/analyze-batch",
        json={"connection_details": connection_details, "tables": selected_tables}
    )
    assert response.status_code == 200
    # Parse NDJSON stream
    analysis_results = []
    for line in response.text.strip().split('\n'):
        analysis_results.append(json.loads(line))
    assert len(analysis_results) == len(selected_tables)
    print(f"✅ Analyzed {len(analysis_results)} tables")

    # Print summary
    incremental_count = sum(1 for r in analysis_results if r['load_method'] == 'incremental')
    full_count = len(analysis_results) - incremental_count
    print(f"  - Incremental: {incremental_count}")
    print(f"  - Full load: {full_count}")

    # Step 4: Register source
    print("\nStep 4: Registering source...")
    response = requests.post(
        f"{BASE_URL}/api/sources/register-source",
        json={
            "source_name": "TEST_SOURCE",
            "connection_details": connection_details,
            "tables": analysis_results,
        }
    )
    assert response.status_code == 200
    result = response.json()
    assert result["success"] is True
    print(f"✅ Registered {result['entities_created']['lz']} LZ entities")
    print(f"✅ Registered {result['entities_created']['bronze']} Bronze entities")
    print(f"✅ Registered {result['entities_created']['silver']} Silver entities")

    print("\n" + "="*80)
    print("✅ ALL STEPS PASSED - Source onboarding works end-to-end")
    print("="*80 + "\n")

if __name__ == "__main__":
    import sys
    try:
        test_source_onboarding()
        sys.exit(0)
    except AssertionError as e:
        print(f"❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ ERROR: {e}")
        sys.exit(1)
```

---

## Cross-Reference

- **DEFINITION-OF-DONE.md**: Section 9 (Source Onboarding — Zero-Friction UX)
- **BURNED-BRIDGES.md**: Entry on binary watermark types (rowversion/timestamp must be excluded)
- **TEST-PLAN.md**: T-INT-12a (Source Onboarding Wizard tests), T-INT-12b ("Load Everything" button)

---

## Dependencies

- **Blocked by**: Task 001 (Entity Activation) — registration won't work if IsActive defaults to 0
- **Blocks**: All future source additions — this is THE way to add sources
- **Blocks**: Task 002 (Full Load) — users can't add sources to test with

---

## Sign-Off

- [ ] "Add Source" button functional on `/sources` page
- [ ] 4-step wizard works end-to-end
- [ ] Connection test validates successfully
- [ ] Table discovery returns all user tables
- [ ] Analysis detects PKs and watermark columns correctly
- [ ] Binary watermark types excluded (rowversion/timestamp)
- [ ] Registration creates LZ + Bronze + Silver entities
- [ ] All entities created with `IsActive = 1`
- [ ] Local SQLite synced
- [ ] Success screen shows summary
- [ ] "Load All" button triggers full pipeline
- [ ] Validation script passes 100%

**Completed by**: ___________
**Date**: ___________
**Verified by**: ___________
