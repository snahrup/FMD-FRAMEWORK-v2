# Pipeline Tooling Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate ConnectorX, Pandera, delta-rs default writes, Presidio + Purview, and a premium Data Estate visualization into the FMD Framework pipeline and dashboard.

**Architecture:** 5 packets executed in order: C (delta-rs default) → A (ConnectorX) → B (Pandera) → D (Presidio + Purview) → E (Data Estate). Each packet produces working, testable software. Engine changes modify existing files; dashboard changes add new pages/routes alongside existing ones.

**Tech Stack:** Python (Polars, ConnectorX, Pandera, Presidio, delta-rs), React 19, TypeScript, Tailwind CSS 4, Framer Motion, Recharts, shadcn/ui, SQLite (control_plane_db)

**Spec:** `docs/superpowers/specs/2026-03-24-pipeline-tooling-integration.md`

---

## File Map

### Packet C (delta-rs default)
| Action | File | Purpose |
|--------|------|---------|
| Modify | `engine/config.py:130` | Change fallback from `"notebook"` to `"local"` |
| Modify | `dashboard/app/api/config.json` | Add explicit `"load_method": "local"` to engine section |
| Modify | `engine/onelake_io.py:276-349` | Add write verification + delta compaction |
| Modify | `engine/bronze_processor.py:108-183` | Add write verification after `write_delta` |
| Modify | `engine/silver_processor.py:160-235` | Add write verification + log SCD stats |
| Modify | `engine/models.py:303-316` | Add `delta_compact_interval` + `delta_vacuum_retention_days` |

### Packet A (ConnectorX)
| Action | File | Purpose |
|--------|------|---------|
| Modify | `engine/models.py:266-316` | Add `use_connectorx`, `connectorx_auth_mode` fields |
| Modify | `engine/connections.py` | Add `build_connectorx_uri()` method |
| Modify | `engine/extractor.py:50-244` | Add ConnectorX extraction path with feature flag |
| Modify | `engine/requirements.txt` | Add `connectorx` |

### Packet B (Pandera)
| Action | File | Purpose |
|--------|------|---------|
| Create | `engine/schemas/__init__.py` | Schema registry |
| Create | `engine/schemas/base.py` | Base schema with common fields |
| Create | `engine/schemas/m3_schemas.py` | M3 table schemas |
| Create | `engine/schemas/mes_schemas.py` | MES table schemas |
| Create | `engine/schema_validator.py` | Validation step |
| Modify | `engine/models.py` | Add `validation_mode` field |
| Modify | `engine/config.py` | Read `validation_mode` from config |
| Modify | `engine/orchestrator.py:1341-1360` | Wire validation between extract and upload |
| Modify | `dashboard/app/api/control_plane_db.py` | Add `schema_validations` table |
| Create | `dashboard/app/api/routes/schema_validation.py` | API routes |
| Create | `dashboard/app/src/pages/SchemaValidation.tsx` | Dashboard page |
| Modify | `dashboard/app/src/App.tsx:95-124` | Add route |
| Modify | `dashboard/app/src/components/layout/AppLayout.tsx:73-133` | Add nav item |
| Modify | `engine/requirements.txt` | Add `pandera[polars]` |

### Packet D (Presidio + Purview)
| Action | File | Purpose |
|--------|------|---------|
| Modify | `engine/requirements.txt` | Add `presidio-analyzer`, `presidio-anonymizer`, `spacy` |
| Modify | `dashboard/app/api/control_plane_db.py` | Add `classification_type_mappings` + `purview_sync_log` tables |
| Create | `dashboard/app/api/routes/purview.py` | Purview sync API routes |
| Modify | `dashboard/app/api/routes/classification.py` | Add column-level + override endpoints |
| Modify | `dashboard/app/src/pages/DataClassification.tsx` | Enhance with Presidio results + Purview panel |
| Modify | `dashboard/app/src/App.tsx` | Routes already exist for `/classification` |
| Modify | `engine/orchestrator.py` | Wire schema capture into post-LZ-upload flow |

### Packet E (Data Estate)
| Action | File | Purpose |
|--------|------|---------|
| Create | `dashboard/app/api/routes/data_estate.py` | Aggregation endpoint |
| Create | `dashboard/app/src/pages/DataEstate.tsx` | Main page |
| Create | `dashboard/app/src/components/estate/PipelineFlow.tsx` | Animated flow |
| Create | `dashboard/app/src/components/estate/SourceNode.tsx` | Source system card |
| Create | `dashboard/app/src/components/estate/LayerZone.tsx` | Medallion layer card |
| Create | `dashboard/app/src/components/estate/GovernancePanel.tsx` | Classification + Purview |
| Create | `dashboard/app/src/components/estate/GovernanceScore.tsx` | Composite metric ring |
| Modify | `dashboard/app/src/App.tsx` | Add `/estate` route |
| Modify | `dashboard/app/src/components/layout/AppLayout.tsx` | Add Data Estate as first nav item |

---

## PACKET C: delta-rs Direct Writes (Default Mode)

### Task 1: Change default load_method to "local"

**Files:**
- Modify: `engine/config.py:130`
- Modify: `dashboard/app/api/config.json` (engine section)

- [ ] **Step 1: Read the current config.py fallback**

Open `engine/config.py` and confirm line 130:
```python
load_method=engine_section.get("load_method", "notebook"),
```

- [ ] **Step 2: Change fallback to "local"**

In `engine/config.py` line 130, change:
```python
# Before
load_method=engine_section.get("load_method", "notebook"),
# After
load_method=engine_section.get("load_method", "local"),
```

- [ ] **Step 3: Add explicit load_method to config.json**

In `dashboard/app/api/config.json`, find the `"engine"` section and add:
```json
"load_method": "local"
```

- [ ] **Step 4: Verify engine status API reports "local"**

Start the engine API and check:
```bash
curl -s http://localhost:8787/api/engine/status | python -c "import sys,json; print(json.load(sys.stdin).get('load_method'))"
```
Expected: `local`

- [ ] **Step 5: Commit**

```bash
git add engine/config.py dashboard/app/api/config.json
git commit -m "feat(engine): default load_method to 'local' — eliminates notebook dependency"
```

### Task 2: Add delta compaction config fields

**Files:**
- Modify: `engine/models.py:303-316`
- Modify: `engine/config.py`

- [ ] **Step 1: Add config fields to EngineConfig**

In `engine/models.py`, after `pipeline_copy_sql_id` (line 315), add:
```python
    delta_compact_interval: int = 10          # Compact after N writes per table
    delta_vacuum_retention_days: int = 7      # VACUUM retention period
```

- [ ] **Step 2: Read fields from config.json**

In `engine/config.py`, in the EngineConfig construction block, add:
```python
delta_compact_interval=engine_section.get("delta_compact_interval", 10),
delta_vacuum_retention_days=engine_section.get("delta_vacuum_retention_days", 7),
```

- [ ] **Step 3: Commit**

```bash
git add engine/models.py engine/config.py
git commit -m "feat(engine): add delta compaction config fields"
```

### Task 3: Add write verification to OneLakeIO

**Files:**
- Modify: `engine/onelake_io.py:276-349`

- [ ] **Step 1: Read the current write_delta methods**

Open `engine/onelake_io.py` and study `write_delta()` (line 276), `_write_delta_fs()` (line 288), and `_write_delta_adls()` (line 323).

- [ ] **Step 2: Add write verification to _write_delta_fs**

After the `df.write_delta()` call in `_write_delta_fs`, add verification:
```python
        # Verify write: read back row count
        try:
            verified_df = pl.read_delta(local_path)
            if len(verified_df) != len(df):
                log.warning(
                    "Write verification MISMATCH for %s: wrote %d, read back %d",
                    table_path, len(df), len(verified_df),
                )
                return False
            log.debug("Write verified: %s (%d rows)", table_path, len(df))
        except Exception as exc:
            log.warning("Write verification read-back failed for %s: %s", table_path, exc)
```

- [ ] **Step 3: Add same verification to _write_delta_adls**

Same pattern after the ADLS `df.write_delta()` call, using the `uri` and `storage_options`.

- [ ] **Step 4: Commit**

```bash
git add engine/onelake_io.py
git commit -m "feat(engine): add Delta write verification (row count read-back)"
```

### Task 4: Add write verification to Bronze + Silver processors

**Files:**
- Modify: `engine/bronze_processor.py`
- Modify: `engine/silver_processor.py`

- [ ] **Step 1: Read bronze_processor.py process_entity()**

Open `engine/bronze_processor.py` and find the `write_delta` call(s).

- [ ] **Step 2: Add row count verification + version logging to Bronze**

After each `self._io.write_delta()` call in `bronze_processor.py`, add:
```python
if not success:
    log.error("Bronze write FAILED for %s", entity.table_name)
    # return failed RunResult
log.info("Bronze write verified: %s (%d rows)", entity.table_name, len(df))
```

- [ ] **Step 3: Enhance Silver SCD statistics logging**

In `silver_processor.py`, after the SCD merge and write, log:
```python
log.info(
    "Silver SCD complete: %s — %d inserts, %d updates, %d deletes, %d unchanged",
    entity.table_name, insert_count, update_count, delete_count, unchanged_count,
)
```

- [ ] **Step 4: Commit**

```bash
git add engine/bronze_processor.py engine/silver_processor.py
git commit -m "feat(engine): add write verification + SCD stats to Bronze/Silver processors"
```

---

## PACKET A: ConnectorX High-Speed Extraction

### Task 5: Add ConnectorX config fields to EngineConfig

**Files:**
- Modify: `engine/models.py:266-316`
- Modify: `engine/config.py`

- [ ] **Step 1: Add fields to EngineConfig dataclass**

In `engine/models.py`, after the `source_sql_driver` field (line 310), add:
```python
    # ConnectorX
    use_connectorx: bool = True              # Feature flag — False falls back to pyodbc
    connectorx_auth_mode: str = "windows"    # "windows" (SSPI, default) or "sql" (username/password)
    sql_username: str = ""                    # Only used when connectorx_auth_mode="sql"
    sql_password: str = ""                    # Only used when connectorx_auth_mode="sql"
```

- [ ] **Step 2: Read fields from config**

In `engine/config.py`, add to the EngineConfig construction:
```python
use_connectorx=engine_section.get("use_connectorx", True),
connectorx_auth_mode=engine_section.get("connectorx_auth_mode", "windows"),
sql_username=engine_section.get("sql_username", ""),
sql_password=engine_section.get("sql_password", ""),
```

- [ ] **Step 3: Commit**

```bash
git add engine/models.py engine/config.py
git commit -m "feat(engine): add ConnectorX config fields (use_connectorx, auth_mode)"
```

### Task 6: Add ConnectorX connection string builder

**Files:**
- Modify: `engine/connections.py`

- [ ] **Step 1: Read current connections.py**

Study the existing `SourceConnection` class and its `connect()` method.

- [ ] **Step 2: Add ConnectorX URI builder method**

Add to `SourceConnection`:
```python
def build_connectorx_uri(self, server: str, database: str) -> str:
    """Build a ConnectorX-compatible mssql:// connection URI.

    Supports two auth modes:
    - "windows" (default): Uses Windows Integrated Auth (SSPI/Trusted_Connection).
      ConnectorX's tiberius driver supports this natively on Windows.
      URI: mssql://server:1433/database?trusted_connection=true
    - "sql": Uses SQL Server username/password (Basic credentials).
      URI: mssql://user:pass@server:1433/database?TrustServerCertificate=true
    """
    port = 1433
    if self._config.connectorx_auth_mode == "sql":
        from urllib.parse import quote_plus
        username = self._config.sql_username
        password = quote_plus(self._config.sql_password)
        return f"mssql://{username}:{password}@{server}:{port}/{database}?TrustServerCertificate=true"
    else:
        # Windows Auth — same auth the engine already uses
        return f"mssql://{server}:{port}/{database}?trusted_connection=true&TrustServerCertificate=true"
```

- [ ] **Step 3: Commit**

```bash
git add engine/connections.py
git commit -m "feat(engine): add ConnectorX URI builder with Windows + SQL auth modes"
```

### Task 7: Add ConnectorX extraction path to extractor.py

**Files:**
- Modify: `engine/extractor.py:50-244`
- Modify: `engine/requirements.txt`

- [ ] **Step 1: Add connectorx to requirements**

In `engine/requirements.txt`, add:
```
connectorx>=0.3.3
```

- [ ] **Step 2: Add conditional import at top of extractor.py**

```python
try:
    import connectorx as cx
    HAS_CONNECTORX = True
except ImportError:
    HAS_CONNECTORX = False
```

- [ ] **Step 3: Add ConnectorX extraction method**

Add a new private method to `DataExtractor`:
```python
def _extract_connectorx(
    self, entity: Entity, run_id: str
) -> tuple[Optional[bytes], RunResult]:
    """Extract using ConnectorX (Rust-speed, Windows or SQL Auth)."""
    import io
    start = time.time()

    query, params = entity.build_source_query()
    # ConnectorX doesn't support parameterized queries — inline the watermark
    if params:
        # Safe: watermark value is from our own DB, already validated
        query = query.replace("?", f"'{params[0]}'", 1)

    uri = self._connections.build_connectorx_uri(
        entity.source_server, entity.source_database
    )

    try:
        df = cx.read_sql(uri, query, return_type="polars2")
    except Exception as exc:
        elapsed = time.time() - start
        error_msg = str(exc)
        return None, RunResult(
            entity_id=entity.id, layer="landing", status="failed",
            rows_read=0, rows_written=0, bytes_transferred=0,
            duration_seconds=elapsed, error=error_msg,
            error_suggestion=self._diagnose_error(error_msg, entity),
        )

    # Filter binary columns (ConnectorX may include them)
    safe_cols = [c for c in df.columns if c not in self._binary_columns(entity)]
    if len(safe_cols) < len(df.columns):
        df = df.select(safe_cols)

    rows_read = len(df)
    if rows_read == 0:
        elapsed = time.time() - start
        if entity.is_incremental:
            log.info("[%s] ConnectorX: no new rows for %s", run_id, entity.source_name)
        else:
            log.warning("[%s] ConnectorX: 0 rows from %s (full load)", run_id, entity.source_name)

    # Compute watermark
    new_watermark = self._compute_watermark(entity, df)

    # Write parquet
    parquet_buf = io.BytesIO()
    df.write_parquet(parquet_buf, compression="snappy")
    parquet_bytes = parquet_buf.getvalue()

    elapsed = time.time() - start
    log.info(
        "[%s] ConnectorX extracted %s: %d rows in %.1fs",
        run_id, entity.source_name, rows_read, elapsed,
    )

    return parquet_bytes, RunResult(
        entity_id=entity.id, layer="landing", status="succeeded",
        rows_read=rows_read, rows_written=rows_read,
        bytes_transferred=len(parquet_bytes),
        duration_seconds=elapsed,
        watermark_before=entity.last_load_value,
        watermark_after=new_watermark,
    )
```

- [ ] **Step 4: Wire feature flag into extract()**

At the top of `DataExtractor.extract()` (line ~70), add the ConnectorX branch:
```python
# ConnectorX path (Rust speed — Windows Auth or SQL Auth)
if HAS_CONNECTORX and self._config.use_connectorx:
    return self._extract_connectorx(entity, run_id)

# Fallback: pyodbc path (existing code continues below)
```

- [ ] **Step 5: Commit**

```bash
git add engine/extractor.py engine/requirements.txt
git commit -m "feat(engine): add ConnectorX extraction path with feature flag fallback"
```

---

## PACKET B: Pandera Schema Validation

### Task 8: Add pandera to requirements + validation_mode config

**Files:**
- Modify: `engine/requirements.txt`
- Modify: `engine/models.py`
- Modify: `engine/config.py`

- [ ] **Step 1: Add pandera to requirements**

```
pandera[polars]>=0.20.0
```

- [ ] **Step 2: Add validation_mode to EngineConfig**

In `engine/models.py`, add after `use_connectorx`:
```python
    validation_mode: str = "warn"            # "enforce" | "warn" | "off"
```

- [ ] **Step 3: Read validation_mode from config**

In `engine/config.py`:
```python
validation_mode=engine_section.get("validation_mode", "warn"),
```

- [ ] **Step 4: Commit**

```bash
git add engine/requirements.txt engine/models.py engine/config.py
git commit -m "feat(engine): add pandera dependency + validation_mode config"
```

### Task 9: Create schema registry + base schema

**Files:**
- Create: `engine/schemas/__init__.py`
- Create: `engine/schemas/base.py`

- [ ] **Step 1: Create engine/schemas/ directory**

```bash
mkdir -p engine/schemas
```

- [ ] **Step 2: Write base.py**

```python
"""Base Pandera schema for FMD Framework entities."""
import pandera.polars as pa


class BronzeBaseSchema(pa.DataFrameModel):
    """Common fields added during Bronze processing."""
    HashedPKColumn: str = pa.Field(nullable=False)
    HashedNonKeyColumns: str = pa.Field(nullable=True)

    class Config:
        strict = False  # Allow extra columns (source tables vary)
        coerce = True
```

- [ ] **Step 3: Write __init__.py with registry**

```python
"""
Schema registry — maps source.table to Pandera schema class.
Tables without a schema entry skip Pandera validation (pass with warning).
"""
from typing import Optional, Type
import pandera.polars as pa
import logging

log = logging.getLogger(__name__)

# Registry: populated by importing source-specific schema modules
_REGISTRY: dict[str, Type[pa.DataFrameModel]] = {}


def register(source: str, table: str, schema_class: Type[pa.DataFrameModel]) -> None:
    """Register a schema for a source.table pair."""
    key = f"{source}.{table}"
    _REGISTRY[key] = schema_class


def get_schema(source: str, table: str) -> Optional[Type[pa.DataFrameModel]]:
    """Look up schema for a source.table. Returns None if not registered."""
    return _REGISTRY.get(f"{source}.{table}")


def coverage() -> dict:
    """Return registry stats."""
    return {"registered": len(_REGISTRY), "tables": list(_REGISTRY.keys())}


# Import source schemas to trigger registration
try:
    from . import m3_schemas  # noqa: F401
    from . import mes_schemas  # noqa: F401
    from . import etq_schemas  # noqa: F401
except Exception as exc:
    log.warning("Schema import error (validation will be skipped): %s", exc)
```

- [ ] **Step 4: Commit**

```bash
git add engine/schemas/
git commit -m "feat(engine): create Pandera schema registry + base schema"
```

### Task 10: Create M3 + MES + ETQ schemas (top 20 tables)

**Files:**
- Create: `engine/schemas/m3_schemas.py`
- Create: `engine/schemas/mes_schemas.py`
- Create: `engine/schemas/etq_schemas.py`

- [ ] **Step 1: Write m3_schemas.py**

```python
"""Pandera schemas for M3 source tables."""
import pandera.polars as pa
from . import register


class MITMASSchema(pa.DataFrameModel):
    """M3 Item Master."""
    MMITNO: str = pa.Field(nullable=False)
    MMITDS: str = pa.Field(nullable=True)
    MMSTAT: str = pa.Field(nullable=False)

    class Config:
        strict = False
        coerce = True


class OOLINESchema(pa.DataFrameModel):
    """M3 Order Lines."""
    OBORNO: str = pa.Field(nullable=False)
    OBPONR: int = pa.Field(ge=0)
    OBITNO: str = pa.Field(nullable=False)

    class Config:
        strict = False
        coerce = True


class CIDMASSchema(pa.DataFrameModel):
    """M3 Customer Master."""
    OKCUNO: str = pa.Field(nullable=False)
    OKCUNM: str = pa.Field(nullable=False)

    class Config:
        strict = False
        coerce = True


# Register all schemas
register("M3 ERP", "MITMAS", MITMASSchema)
register("M3 ERP", "OOLINE", OOLINESchema)
register("M3 ERP", "CIDMAS", CIDMASSchema)
```

Note: Start with these 3 tables. Expand as we learn real column constraints from production data. Do NOT over-specify schemas before seeing real data.

- [ ] **Step 2: Write mes_schemas.py**

```python
"""Pandera schemas for MES source tables."""
import pandera.polars as pa
from . import register


class BatchHeaderSchema(pa.DataFrameModel):
    """MES Batch Header."""
    BatchID: str = pa.Field(nullable=False)
    ProductCode: str = pa.Field(nullable=True)

    class Config:
        strict = False
        coerce = True


register("MES", "BatchHeader", BatchHeaderSchema)
```

- [ ] **Step 3: Write etq_schemas.py**

```python
"""Pandera schemas for ETQ source tables — placeholder for expansion."""
# ETQ schemas will be added as we discover table structures
# from . import register
```

- [ ] **Step 4: Commit**

```bash
git add engine/schemas/
git commit -m "feat(engine): add initial Pandera schemas for M3 + MES top tables"
```

### Task 11: Create schema_validator.py

**Files:**
- Create: `engine/schema_validator.py`

- [ ] **Step 1: Write the validator module**

```python
"""
Schema validation step using Pandera.
Called after extraction, before loading. Blocks or warns on bad data
depending on validation_mode config.
"""
import polars as pl
from dataclasses import dataclass, field
from typing import Optional
import logging
import json

log = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    source: str
    table: str
    passed: bool
    row_count: int
    error_count: int
    errors: list[dict] = field(default_factory=list)
    skipped: bool = False
    skip_reason: str = ""


def validate_extraction(
    df: pl.DataFrame,
    source: str,
    table: str,
) -> ValidationResult:
    """Validate a Polars DataFrame against its registered Pandera schema.

    Returns ValidationResult. Tables without registered schemas pass with skipped=True.
    """
    from engine.schemas import get_schema

    schema_class = get_schema(source, table)

    if schema_class is None:
        return ValidationResult(
            source=source, table=table, passed=True,
            row_count=len(df), error_count=0,
            skipped=True, skip_reason="no schema registered",
        )

    try:
        schema_class.validate(df)
        log.info("Schema validation PASSED: %s.%s (%d rows)", source, table, len(df))
        return ValidationResult(
            source=source, table=table, passed=True,
            row_count=len(df), error_count=0,
        )
    except Exception as exc:
        error_str = str(exc)
        log.warning("Schema validation FAILED: %s.%s — %s", source, table, error_str)
        return ValidationResult(
            source=source, table=table, passed=False,
            row_count=len(df), error_count=1,
            errors=[{"schema_error": error_str[:2000]}],  # Truncate for storage
        )
```

- [ ] **Step 2: Commit**

```bash
git add engine/schema_validator.py
git commit -m "feat(engine): add Pandera schema validator module"
```

### Task 12: Wire validation into orchestrator

**Files:**
- Modify: `engine/orchestrator.py:1341-1360`

- [ ] **Step 1: Read the _try_entity_local method**

Open `engine/orchestrator.py` and find `_try_entity_local()` around line 1341. This is where `self._extractor.extract()` is called and then `self._loader.upload_entity()`.

- [ ] **Step 2: Add validation between extract and upload**

After the extract call (line ~1347) and before the upload call (line ~1356), insert:
```python
        # Schema validation (between extract and upload)
        if self.config.validation_mode != "off":
            try:
                from engine.schema_validator import validate_extraction
                import io
                # Re-read the parquet bytes as Polars to validate
                validation_df = pl.read_parquet(io.BytesIO(parquet_bytes))
                val_result = validate_extraction(
                    validation_df, entity.data_source_name, entity.source_name
                )
                # Log validation result to control plane
                self._log_validation(run_id, entity.id, val_result)

                if not val_result.passed and self.config.validation_mode == "enforce":
                    log.error(
                        "[%s] Validation BLOCKED upload for %s: %s",
                        run_id, entity.source_name, val_result.errors,
                    )
                    return RunResult(
                        entity_id=entity.id, layer="landing", status="failed",
                        rows_read=extract_result.rows_read, rows_written=0,
                        bytes_transferred=0,
                        duration_seconds=extract_result.duration_seconds,
                        error=f"Schema validation failed: {val_result.errors}",
                        error_suggestion="Check schema definition or switch to validation_mode='warn'",
                    )
            except ImportError:
                log.debug("Pandera not installed — skipping validation")
            except Exception as exc:
                log.warning("Validation error (non-fatal): %s", exc)
```

Add `import polars as pl` at top of file if not present.

- [ ] **Step 3: Add _log_validation helper**

Add to LoadOrchestrator class:
```python
    def _log_validation(self, run_id: str, entity_id: int, val_result) -> None:
        """Log validation result to control plane API."""
        import json
        try:
            import urllib.request
            data = json.dumps({
                "run_id": run_id, "entity_id": entity_id,
                "layer": "landing", "passed": val_result.passed,
                "error_count": val_result.error_count,
                "errors_json": json.dumps(val_result.errors),
            }).encode()
            req = urllib.request.Request(
                "http://localhost:8787/api/schema-validation/result",
                data=data, headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass  # Non-critical — don't fail loads for logging issues
```

- [ ] **Step 4: Commit**

```bash
git add engine/orchestrator.py
git commit -m "feat(engine): wire Pandera validation between extract and upload"
```

### Task 13: Add schema_validations table + API routes

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py`
- Create: `dashboard/app/api/routes/schema_validation.py`

- [ ] **Step 1: Add schema_validations table to control_plane_db.py**

Find the table creation section and add:
```sql
CREATE TABLE IF NOT EXISTS schema_validations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL,
    entity_id       INTEGER NOT NULL,
    layer           TEXT NOT NULL DEFAULT 'landing',
    passed          INTEGER NOT NULL DEFAULT 1,
    error_count     INTEGER NOT NULL DEFAULT 0,
    errors_json     TEXT,
    validated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sv_run ON schema_validations(run_id);
CREATE INDEX IF NOT EXISTS idx_sv_entity ON schema_validations(entity_id);
```

- [ ] **Step 2: Write schema_validation.py routes**

```python
"""Schema validation API routes."""
import json
import logging
from ..router import route

log = logging.getLogger(__name__)


@route("GET", "/api/schema-validation/summary")
def get_validation_summary(params: dict) -> dict:
    """Aggregate pass/fail counts across all runs."""
    from ..control_plane_db import get_db
    db = get_db()
    row = db.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed,
            SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) as failed
        FROM schema_validations
    """).fetchone()
    return {
        "total": row[0] or 0,
        "passed": row[1] or 0,
        "failed": row[2] or 0,
    }


@route("GET", "/api/schema-validation/run/{run_id}")
def get_validation_by_run(params: dict) -> dict:
    """Per-run validation results."""
    from ..control_plane_db import get_db
    run_id = params.get("run_id", "")
    db = get_db()
    rows = db.execute("""
        SELECT sv.entity_id, sv.layer, sv.passed, sv.error_count,
               sv.errors_json, sv.validated_at,
               le.TableName, ds.Namespace
        FROM schema_validations sv
        LEFT JOIN lz_entities le ON le.id = sv.entity_id
        LEFT JOIN datasources ds ON le.DataSourceId = ds.Id
        WHERE sv.run_id = ?
        ORDER BY sv.passed ASC, sv.validated_at DESC
    """, (run_id,)).fetchall()
    return {
        "run_id": run_id,
        "results": [
            {
                "entity_id": r[0], "layer": r[1], "passed": bool(r[2]),
                "error_count": r[3], "errors": json.loads(r[4] or "[]"),
                "validated_at": r[5], "table_name": r[6], "source": r[7],
            }
            for r in rows
        ],
    }


@route("GET", "/api/schema-validation/coverage")
def get_validation_coverage(params: dict) -> dict:
    """Which entities have schemas registered."""
    try:
        from engine.schemas import coverage
        return coverage()
    except ImportError:
        return {"registered": 0, "tables": [], "error": "pandera not installed"}


@route("POST", "/api/schema-validation/result")
def post_validation_result(params: dict) -> dict:
    """Store a validation result from the engine."""
    from ..control_plane_db import get_db
    body = params.get("_body", {})
    db = get_db()
    db.execute("""
        INSERT INTO schema_validations (run_id, entity_id, layer, passed, error_count, errors_json)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        body.get("run_id"), body.get("entity_id"), body.get("layer", "landing"),
        1 if body.get("passed") else 0, body.get("error_count", 0),
        body.get("errors_json", "[]"),
    ))
    db.commit()
    return {"stored": True}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/api/control_plane_db.py dashboard/app/api/routes/schema_validation.py
git commit -m "feat(api): add schema_validations table + API routes"
```

### Task 14: Create SchemaValidation.tsx page

**Files:**
- Create: `dashboard/app/src/pages/SchemaValidation.tsx`
- Modify: `dashboard/app/src/App.tsx`
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Run /interface-design for SchemaValidation page**

Invoke the `/interface-design` skill with the following context:
- Page purpose: Schema validation results viewer — shows pass/fail per entity per run, with column-level error drilldown
- Data: `GET /api/schema-validation/summary` (totals), `GET /api/schema-validation/run/{run_id}` (per-run), `GET /api/schema-validation/coverage` (schema registry stats)
- Design system: Follow existing FMD dashboard patterns (KPI strip, filterable table, expand-for-detail)
- Existing reference pages: DqScorecard.tsx (quality metrics pattern), ExecutionMatrix.tsx (run-level results pattern)

- [ ] **Step 2: Build the page per /interface-design output**

Implement whatever the interface design produces.

- [ ] **Step 3: Add route to App.tsx**

In `dashboard/app/src/App.tsx`, in the engineering console routes section (~line 95-124), add:
```tsx
<Route path="/schema-validation" element={<SchemaValidation />} />
```

Import at top:
```tsx
import SchemaValidation from "./pages/SchemaValidation";
```

- [ ] **Step 4: Add nav item to AppLayout.tsx**

In `dashboard/app/src/components/layout/AppLayout.tsx`, find the `"Quality"` group in `CORE_GROUPS` and add:
```typescript
{ icon: ShieldCheck, label: "Schema Validation", href: "/schema-validation" },
```

Import `ShieldCheck` from `lucide-react`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/src/pages/SchemaValidation.tsx dashboard/app/src/App.tsx dashboard/app/src/components/layout/AppLayout.tsx
git commit -m "feat(ui): add SchemaValidation page with KPI strip + run-level results"
```

---

## PACKET D: Presidio Classification + Purview

### Task 15: Install Presidio + spaCy model

**Files:**
- Modify: `engine/requirements.txt`

- [ ] **Step 1: Add Presidio dependencies**

```
presidio-analyzer>=2.2.0
presidio-anonymizer>=2.2.0
spacy>=3.7.0
```

- [ ] **Step 2: Download spaCy model**

```bash
pip install presidio-analyzer presidio-anonymizer spacy
python -m spacy download en_core_web_lg
```

- [ ] **Step 3: Verify import works**

```bash
python -c "from presidio_analyzer import AnalyzerEngine; print('Presidio OK')"
```

- [ ] **Step 4: Commit**

```bash
git add engine/requirements.txt
git commit -m "feat(engine): add Presidio + spaCy dependencies for PII classification"
```

### Task 16: Add Purview mapping + sync tables

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py`

- [ ] **Step 1: Add classification_type_mappings table**

```sql
CREATE TABLE IF NOT EXISTS classification_type_mappings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    internal_type   TEXT NOT NULL UNIQUE,
    purview_type    TEXT NOT NULL,
    sensitivity_label TEXT NOT NULL DEFAULT 'Confidential',
    description     TEXT,
    is_active       INTEGER DEFAULT 1
);
```

- [ ] **Step 2: Add purview_sync_log table**

```sql
CREATE TABLE IF NOT EXISTS purview_sync_log (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id                 TEXT NOT NULL,
    direction               TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'running',
    entities_synced         INTEGER DEFAULT 0,
    classifications_synced  INTEGER DEFAULT 0,
    started_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    completed_at            TEXT,
    error                   TEXT
);
```

- [ ] **Step 3: Seed the mapping table**

Add seed data after table creation:
```sql
INSERT OR IGNORE INTO classification_type_mappings (internal_type, purview_type, sensitivity_label, description) VALUES
    ('PERSON', 'MICROSOFT.PERSONAL.NAME', 'Confidential', 'Person names'),
    ('EMAIL_ADDRESS', 'MICROSOFT.PERSONAL.EMAIL', 'Confidential', 'Email addresses'),
    ('PHONE_NUMBER', 'MICROSOFT.PERSONAL.PHONE_NUMBER', 'Confidential', 'Phone numbers'),
    ('CREDIT_CARD', 'MICROSOFT.FINANCIAL.CREDIT_CARD_NUMBER', 'Highly Confidential', 'Credit card numbers'),
    ('US_SSN', 'MICROSOFT.GOVERNMENT.US.SOCIAL_SECURITY_NUMBER', 'Highly Confidential', 'Social Security numbers'),
    ('US_DRIVER_LICENSE', 'MICROSOFT.GOVERNMENT.US.DRIVER_LICENSE_NUMBER', 'Highly Confidential', 'Driver license numbers'),
    ('IP_ADDRESS', 'MICROSOFT.IT.IPADDRESS', 'Internal', 'IP addresses'),
    ('LOCATION', 'MICROSOFT.PERSONAL.US.PHYSICAL_ADDRESS', 'Confidential', 'Physical addresses'),
    ('MEDICAL_LICENSE', 'MICROSOFT.PERSONAL.HEALTH', 'Highly Confidential', 'Medical license numbers'),
    ('US_BANK_NUMBER', 'MICROSOFT.FINANCIAL.US.ABA_ROUTING_NUMBER', 'Highly Confidential', 'Bank account/routing numbers'),
    ('DATE_TIME', 'MICROSOFT.PERSONAL.AGE', 'Internal', 'Dates that may indicate age'),
    ('US_PASSPORT', 'MICROSOFT.GOVERNMENT.US.PASSPORT_NUMBER', 'Highly Confidential', 'Passport numbers');
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/api/control_plane_db.py
git commit -m "feat(api): add Purview mapping table + sync log + seed data"
```

### Task 17: Create Purview API routes

**Files:**
- Create: `dashboard/app/api/routes/purview.py`

- [ ] **Step 1: Write purview.py routes**

```python
"""Purview integration API routes."""
import json
import uuid
import logging
from ..router import route

log = logging.getLogger(__name__)


@route("GET", "/api/classification/purview/status")
def get_purview_status(params: dict) -> dict:
    """Purview connection state + mapping coverage."""
    from ..control_plane_db import get_db
    db = get_db()

    # Mapping coverage
    total_mappings = db.execute(
        "SELECT COUNT(*) FROM classification_type_mappings"
    ).fetchone()[0]
    active_mappings = db.execute(
        "SELECT COUNT(*) FROM classification_type_mappings WHERE is_active = 1"
    ).fetchone()[0]

    # Unique PII types detected
    detected_types = db.execute(
        "SELECT DISTINCT pii_entities FROM column_classifications WHERE pii_entities IS NOT NULL AND pii_entities != ''"
    ).fetchall()
    unique_types = set()
    for row in detected_types:
        for t in (row[0] or "").split(","):
            t = t.strip()
            if t:
                unique_types.add(t)

    # Last sync
    last_sync = db.execute(
        "SELECT * FROM purview_sync_log ORDER BY started_at DESC LIMIT 1"
    ).fetchone()

    return {
        "configured": False,  # Will be True when Purview endpoint is configured
        "ready": total_mappings > 0,
        "mapping_coverage": {
            "total": total_mappings,
            "active": active_mappings,
            "detected_types": len(unique_types),
            "mapped_types": active_mappings,
        },
        "last_sync": {
            "sync_id": last_sync[1] if last_sync else None,
            "direction": last_sync[2] if last_sync else None,
            "status": last_sync[3] if last_sync else None,
            "entities_synced": last_sync[4] if last_sync else 0,
            "classifications_synced": last_sync[5] if last_sync else 0,
            "started_at": last_sync[6] if last_sync else None,
            "completed_at": last_sync[7] if last_sync else None,
        } if last_sync else None,
    }


@route("GET", "/api/classification/purview/mappings")
def get_purview_mappings(params: dict) -> dict:
    """Return all type mappings."""
    from ..control_plane_db import get_db
    db = get_db()
    rows = db.execute(
        "SELECT id, internal_type, purview_type, sensitivity_label, description, is_active "
        "FROM classification_type_mappings ORDER BY internal_type"
    ).fetchall()
    return {
        "mappings": [
            {
                "id": r[0], "internal_type": r[1], "purview_type": r[2],
                "sensitivity_label": r[3], "description": r[4], "is_active": bool(r[5]),
            }
            for r in rows
        ]
    }


@route("GET", "/api/classification/purview/history")
def get_purview_history(params: dict) -> dict:
    """Sync history log."""
    from ..control_plane_db import get_db
    db = get_db()
    rows = db.execute(
        "SELECT sync_id, direction, status, entities_synced, classifications_synced, "
        "started_at, completed_at, error FROM purview_sync_log ORDER BY started_at DESC LIMIT 20"
    ).fetchall()
    return {
        "history": [
            {
                "sync_id": r[0], "direction": r[1], "status": r[2],
                "entities_synced": r[3], "classifications_synced": r[4],
                "started_at": r[5], "completed_at": r[6], "error": r[7],
            }
            for r in rows
        ]
    }


@route("POST", "/api/classification/purview/sync")
def post_purview_sync(params: dict) -> dict:
    """Trigger a Purview sync (push). Currently scaffolded — actual Purview API call is future."""
    from ..control_plane_db import get_db
    sync_id = str(uuid.uuid4())[:8]
    db = get_db()

    # Count what would be synced
    classified = db.execute(
        "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level != 'public'"
    ).fetchone()[0]

    # Log the sync attempt
    db.execute(
        "INSERT INTO purview_sync_log (sync_id, direction, status, classifications_synced) "
        "VALUES (?, 'push', 'ready', ?)",
        (sync_id, classified),
    )
    db.commit()

    return {
        "sync_id": sync_id,
        "status": "ready",
        "message": f"Purview sync prepared: {classified} classifications ready to push. "
                   "Configure Purview endpoint to activate.",
        "classifications_ready": classified,
    }
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/api/routes/purview.py
git commit -m "feat(api): add Purview sync API routes (status, mappings, history, sync)"
```

### Task 18: Add column-level classification endpoint

**Files:**
- Modify: `dashboard/app/api/routes/classification.py`

- [ ] **Step 1: Add entity column detail endpoint**

Add to `classification.py`:
```python
@route("GET", "/api/classification/entity/{entity_id}/columns")
def get_entity_classification_columns(params: dict) -> dict:
    """Column-level classification detail for an entity."""
    from ..control_plane_db import get_db
    entity_id = int(params.get("entity_id", 0))
    db = get_db()
    rows = db.execute("""
        SELECT cm.column_name, cm.data_type, cm.ordinal_position, cm.is_nullable,
               cc.sensitivity_level, cc.classified_by, cc.confidence, cc.pii_entities,
               cc.classified_at
        FROM column_metadata cm
        LEFT JOIN column_classifications cc
            ON cm.entity_id = cc.entity_id AND cm.layer = cc.layer AND cm.column_name = cc.column_name
        WHERE cm.entity_id = ?
        ORDER BY cm.ordinal_position
    """, (entity_id,)).fetchall()
    return {
        "entity_id": entity_id,
        "columns": [
            {
                "column_name": r[0], "data_type": r[1], "ordinal": r[2],
                "nullable": bool(r[3]), "sensitivity_level": r[4] or "unclassified",
                "classified_by": r[5], "confidence": r[6], "pii_entities": r[7],
                "classified_at": r[8],
            }
            for r in rows
        ],
    }
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/api/routes/classification.py
git commit -m "feat(api): add column-level classification detail endpoint"
```

### Task 19: Enhance DataClassification.tsx with Purview panel

**Files:**
- Modify: `dashboard/app/src/pages/DataClassification.tsx`

- [ ] **Step 1: Run /interface-design for DataClassification enhancement**

Invoke `/interface-design` with context:
- Page purpose: Enhance existing DataClassification page with Presidio results + Purview integration panel
- Existing page: Already has KPI strip, heatmap view, entity table
- New sections: (1) Purview Integration Panel at top — connection status, sync button, mapping coverage ring, sync history, (2) Column-level drilldown — click entity → see columns with PII types + confidence, (3) Sensitivity badges
- Data sources: Existing `/api/classification/summary` + new `/api/classification/purview/status`, `/api/classification/purview/mappings`, `/api/classification/purview/history`, `/api/classification/entity/{id}/columns`
- Key demo moment: "Ready for Purview" state with mapping coverage showing forethought

- [ ] **Step 2: Build per /interface-design output**

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/pages/DataClassification.tsx
git commit -m "feat(ui): enhance DataClassification with Purview panel + column drilldown"
```

### Task 20: Wire schema capture into post-LZ-upload

**Files:**
- Modify: `engine/orchestrator.py`

- [ ] **Step 1: After successful LZ upload, trigger schema capture**

In `_try_entity_local()`, after the successful upload (line ~1356), add:
```python
        # Auto-capture column metadata for classification pipeline
        if upload_result.succeeded:
            try:
                import urllib.request
                req = urllib.request.Request(
                    f"http://localhost:8787/api/lineage/columns/{entity.id}",
                    method="GET",
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass  # Non-critical — classification will work on next scan
```

- [ ] **Step 2: Commit**

```bash
git add engine/orchestrator.py
git commit -m "feat(engine): auto-capture column metadata after LZ upload for classification"
```

---

## PACKET E: Data Estate Visualization

### Task 21: Create aggregation API endpoint

**Files:**
- Create: `dashboard/app/api/routes/data_estate.py`

- [ ] **Step 1: Write data_estate.py**

```python
"""Data Estate aggregation endpoint — single call for all estate metrics."""
import json
import logging
from ..router import route

log = logging.getLogger(__name__)


@route("GET", "/api/estate/overview")
def get_estate_overview(params: dict) -> dict:
    """Aggregated estate overview — sources, layers, classification, schema health."""
    from ..control_plane_db import get_db
    db = get_db()

    # Sources
    sources = db.execute("""
        SELECT ds.Namespace, COUNT(le.id) as entity_count,
               MAX(et.created_at) as last_load,
               SUM(CASE WHEN et.Status = 'succeeded' THEN 1 ELSE 0 END) as succeeded,
               SUM(CASE WHEN et.Status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM datasources ds
        LEFT JOIN lz_entities le ON le.DataSourceId = ds.Id AND le.IsActive = 1
        LEFT JOIN engine_task_log et ON et.entity_id = le.id AND et.Layer = 'landing'
        GROUP BY ds.Namespace
        ORDER BY ds.Namespace
    """).fetchall()

    # Layer stats
    layers = {}
    for layer_name, table_name in [("landing", "lz_entities"), ("bronze", "bronze_entities"), ("silver", "silver_entities")]:
        row = db.execute(f"SELECT COUNT(*) FROM {table_name} WHERE IsActive = 1").fetchone()
        layers[layer_name] = {"entities": row[0] or 0}

    # Classification coverage
    classified = db.execute(
        "SELECT COUNT(DISTINCT entity_id || '.' || column_name) FROM column_classifications"
    ).fetchone()[0] or 0
    total_columns = db.execute("SELECT COUNT(*) FROM column_metadata").fetchone()[0] or 0
    pii_count = db.execute(
        "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level = 'pii'"
    ).fetchone()[0] or 0

    # Schema validation
    val_row = db.execute("""
        SELECT COUNT(*), SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END)
        FROM schema_validations
    """).fetchone()

    # Purview status
    purview_ready = db.execute(
        "SELECT COUNT(*) FROM classification_type_mappings WHERE is_active = 1"
    ).fetchone()[0] > 0

    return {
        "sources": [
            {
                "name": s[0], "entity_count": s[1], "last_load": s[2],
                "succeeded": s[3] or 0, "failed": s[4] or 0,
                "health": "healthy" if (s[4] or 0) == 0 else ("degraded" if (s[4] or 0) < (s[3] or 1) else "failing"),
            }
            for s in sources
        ],
        "layers": layers,
        "classification": {
            "total_columns": total_columns,
            "classified_columns": classified,
            "coverage_percent": round(classified / total_columns * 100, 1) if total_columns > 0 else 0,
            "pii_detected": pii_count,
        },
        "schema_health": {
            "total_validated": val_row[0] or 0,
            "passed": val_row[1] or 0,
            "pass_rate": round((val_row[1] or 0) / (val_row[0] or 1) * 100, 1),
        },
        "governance": {
            "purview_ready": purview_ready,
            "purview_configured": False,
        },
    }
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/app/api/routes/data_estate.py
git commit -m "feat(api): add Data Estate aggregation endpoint"
```

### Task 22: Run /interface-design for Data Estate page

- [ ] **Step 1: Invoke /interface-design**

This is the crown jewel page. Invoke `/interface-design` with context from the spec:
- Purpose: Premium animated data estate visualization — exec demo page
- Requirements from spec Section "Packet E": Living pipeline flow, source constellation, layer progression, governance overlay, premium motion
- v1 criteria: Flow animates, numbers update live, click-through to detail pages, sources scale dynamically, < 2s load, 60fps
- v2 deferred: Ambient breathing, shared-element transitions, throughput-tied particle speed
- Empty state: Ghost nodes with pulse animation, progressive reveal as data arrives
- Data: `GET /api/estate/overview` (single aggregated call)
- Existing components to reuse: `AnimatedCounter.tsx`, `DqScoreRing.tsx` pattern
- Libraries available: Framer Motion (already installed), Recharts, GSAP (already installed), Lucide icons
- Color tokens: `--bp-operational` (green), `--bp-fault` (red), `--bp-caution` (amber), `--bp-gold`, `--bp-silver`, `--bp-bronze`

- [ ] **Step 2: Build per /interface-design output**

Build the page and all components under `dashboard/app/src/components/estate/`.

### Task 23: Add routing + navigation for Data Estate

**Files:**
- Modify: `dashboard/app/src/App.tsx`
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Add route**

In `App.tsx`, add at the TOP of the engineering console routes (before `/matrix`):
```tsx
<Route path="/estate" element={<DataEstate />} />
```

Import:
```tsx
import DataEstate from "./pages/DataEstate";
```

- [ ] **Step 2: Add as first nav item**

In `AppLayout.tsx`, add a new group at the TOP of `CORE_GROUPS` (before "Overview"):
```typescript
{
  label: "Estate",
  items: [
    { icon: Globe, label: "Data Estate", href: "/estate" },
  ],
},
```

Import `Globe` from `lucide-react`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/src/App.tsx dashboard/app/src/components/layout/AppLayout.tsx dashboard/app/src/pages/DataEstate.tsx dashboard/app/src/components/estate/
git commit -m "feat(ui): add Data Estate page — premium animated pipeline visualization"
```

---

## FINAL: Integration Verification

### Task 24: End-to-end verification

- [ ] **Step 1: Verify config defaults**

```bash
curl -s http://localhost:8787/api/engine/status | python -c "import sys,json; d=json.load(sys.stdin); print('load_method:', d.get('load_method')); print('validation_mode: warn expected')"
```

- [ ] **Step 2: Verify schema validation API**

```bash
curl -s http://localhost:8787/api/schema-validation/summary
curl -s http://localhost:8787/api/schema-validation/coverage
```

- [ ] **Step 3: Verify Purview API**

```bash
curl -s http://localhost:8787/api/classification/purview/status
curl -s http://localhost:8787/api/classification/purview/mappings
```

- [ ] **Step 4: Verify Data Estate API**

```bash
curl -s http://localhost:8787/api/estate/overview
```

- [ ] **Step 5: Verify frontend builds**

```bash
cd dashboard/app && npm run build
```

- [ ] **Step 6: Visual verification**

Open browser to `http://localhost:8787`:
1. Navigate to Data Estate — verify animated flow renders
2. Navigate to Schema Validation — verify KPI strip shows
3. Navigate to Data Classification — verify Purview panel shows "Ready for Purview"

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: pipeline tooling integration complete — 5 packets delivered"
```
