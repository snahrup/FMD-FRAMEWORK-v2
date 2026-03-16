# Local Bronze & Silver Processors — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Fabric notebook triggers with local Python processing for Bronze and Silver layers, using polars + deltalake to read/write Delta tables on OneLake.

**Architecture:** Two new engine modules (`bronze_processor.py`, `silver_processor.py`) follow the same patterns as `loader.py` and `extractor.py`. They use the ADLS SDK for OneLake file I/O and `polars`/`deltalake` for Delta table read/write. The orchestrator dispatches to these when `load_method == "local"` instead of calling `NotebookTrigger.run_bronze()`/`run_silver()`. Per-entity processing with the existing thread pool, adaptive throttle, and RunResult reporting.

**Tech Stack:** Python 3.13, polars 1.38+ (has `write_delta`/`read_delta` built-in), deltalake 0.25+, azure-storage-file-datalake (existing), SQLite control-plane DB.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `engine/bronze_processor.py` | **Create** | Read LZ parquet from OneLake → hash PKs → deduplicate → Delta merge to Bronze lakehouse |
| `engine/silver_processor.py` | **Create** | Read Bronze Delta from OneLake → SCD Type 2 change detection → Delta merge to Silver lakehouse |
| `engine/onelake_io.py` | **Create** | Shared OneLake read/write helpers: read_parquet, read_delta, write_delta (wraps ADLS SDK + polars) |
| `engine/orchestrator.py` | **Modify** | Wire local bronze/silver into `run()` and `build_plan()` when `load_method == "local"` |
| `engine/requirements.txt` | **Modify** | Add `deltalake>=0.25.0` |
| `engine/models.py` | **Modify** | Add `BronzeEntity` and `SilverEntity` dataclasses for layer-specific metadata |
| `engine/tests/test_bronze_processor.py` | **Create** | Unit tests for bronze processing logic (hash, dedup, merge) |
| `engine/tests/test_silver_processor.py` | **Create** | Unit tests for SCD Type 2 logic (insert, update, soft delete) |

---

## Chunk 1: Foundation — OneLake I/O + Dependencies

### Task 1: Add deltalake dependency

**Files:**
- Modify: `engine/requirements.txt`

- [ ] **Step 1: Add deltalake to requirements**

```
pyodbc>=4.0.35
polars>=0.20.0
azure-storage-file-datalake>=12.14.0
deltalake>=0.25.0
```

- [ ] **Step 2: Install**

Run: `pip install deltalake>=0.25.0`
Expected: Successfully installed deltalake-X.Y.Z

- [ ] **Step 3: Verify polars Delta integration works**

Run: `python -c "import polars as pl; import deltalake; print('OK:', pl.__version__, deltalake.__version__)"`
Expected: `OK: 1.38.1 X.Y.Z`

- [ ] **Step 4: Commit**

```bash
git add engine/requirements.txt
git commit -m "chore: add deltalake dependency for local bronze/silver processing"
```

---

### Task 2: Add BronzeEntity and SilverEntity models

**Files:**
- Modify: `engine/models.py` (append after Entity class, around line 57)

- [ ] **Step 1: Write failing test**

Create `engine/tests/test_models.py`:

```python
"""Tests for bronze/silver entity models."""
from engine.models import BronzeEntity, SilverEntity


def test_bronze_entity_onelake_table_path():
    e = BronzeEntity(
        bronze_entity_id=1,
        lz_entity_id=10,
        namespace="MES",
        source_schema="dbo",
        source_name="CUSCONGB",
        primary_keys="COMSID,COLANC",
        is_incremental=False,
        lakehouse_guid="F06393CA-C024-435F-8D7F-9F5AA3BB4CB3",
        workspace_guid="0596d0e7-e036-451d-a967-41a284302e8d",
        lz_file_name="CUSCONGB.parquet",
        lz_namespace="m3",
    )
    assert e.delta_table_path == "F06393CA-C024-435F-8D7F-9F5AA3BB4CB3/Tables/MES/CUSCONGB"
    assert e.lz_parquet_path == "3B9A7E79-1615-4EC2-9E93-0BDEBE985D5A/Files/m3/CUSCONGB.parquet"
    assert e.pk_columns == ["COMSID", "COLANC"]


def test_silver_entity_onelake_table_path():
    e = SilverEntity(
        silver_entity_id=1,
        bronze_entity_id=10,
        namespace="MES",
        source_name="CUSCONGB",
        primary_keys="COMSID,COLANC",
        is_incremental=False,
        lakehouse_guid="F85E1BA0-2E40-4DE5-BE1E-F8AD3DDBC652",
        workspace_guid="0596d0e7-e036-451d-a967-41a284302e8d",
        bronze_lakehouse_guid="F06393CA-C024-435F-8D7F-9F5AA3BB4CB3",
    )
    assert e.delta_table_path == "F85E1BA0-2E40-4DE5-BE1E-F8AD3DDBC652/Tables/MES/CUSCONGB"
    assert e.bronze_delta_path == "F06393CA-C024-435F-8D7F-9F5AA3BB4CB3/Tables/MES/CUSCONGB"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest engine/tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'BronzeEntity'`

- [ ] **Step 3: Implement BronzeEntity and SilverEntity**

Add to `engine/models.py` after the Entity class (after line 57):

```python
# ---------------------------------------------------------------------------
# Bronze entity — one Delta table in the Bronze lakehouse
# ---------------------------------------------------------------------------

@dataclass
class BronzeEntity:
    """A Bronze layer entity — LZ parquet → Delta table."""

    bronze_entity_id: int
    lz_entity_id: int
    namespace: str                      # e.g. "MES", "ETQ", "m3"
    source_schema: str
    source_name: str
    primary_keys: str                   # comma-separated PK column names
    is_incremental: bool
    lakehouse_guid: str                 # Bronze lakehouse GUID
    workspace_guid: str                 # DATA workspace GUID
    lz_file_name: str                   # e.g. "CUSCONGB.parquet"
    lz_namespace: str                   # LZ folder (may differ from namespace)
    lz_lakehouse_guid: str = ""         # LZ lakehouse GUID (for reading source parquet)
    is_active: bool = True

    @property
    def delta_table_path(self) -> str:
        """OneLake path for the Bronze Delta table: {lh}/Tables/{namespace}/{table}."""
        return f"{self.lakehouse_guid}/Tables/{self.namespace}/{self.source_name}"

    @property
    def lz_parquet_path(self) -> str:
        """OneLake path for the LZ source parquet: {lh}/Files/{folder}/{file}."""
        return f"{self.lz_lakehouse_guid}/Files/{self.lz_namespace}/{self.lz_file_name}"

    @property
    def pk_columns(self) -> list[str]:
        """Primary key column names as a list."""
        if not self.primary_keys or self.primary_keys in ("N/A", ""):
            return []
        return [c.strip() for c in self.primary_keys.split(",") if c.strip()]


# ---------------------------------------------------------------------------
# Silver entity — one Delta table in the Silver lakehouse
# ---------------------------------------------------------------------------

@dataclass
class SilverEntity:
    """A Silver layer entity — Bronze Delta → Silver Delta with SCD Type 2."""

    silver_entity_id: int
    bronze_entity_id: int
    namespace: str
    source_name: str
    primary_keys: str = ""              # inherited from Bronze
    is_incremental: bool = False
    lakehouse_guid: str = ""            # Silver lakehouse GUID
    workspace_guid: str = ""            # DATA workspace GUID
    bronze_lakehouse_guid: str = ""     # Bronze lakehouse GUID (for reading source Delta)
    is_active: bool = True

    @property
    def delta_table_path(self) -> str:
        """OneLake path for the Silver Delta table."""
        return f"{self.lakehouse_guid}/Tables/{self.namespace}/{self.source_name}"

    @property
    def bronze_delta_path(self) -> str:
        """OneLake path to read the Bronze Delta table."""
        return f"{self.bronze_lakehouse_guid}/Tables/{self.namespace}/{self.source_name}"

    @property
    def pk_columns(self) -> list[str]:
        if not self.primary_keys or self.primary_keys in ("N/A", ""):
            return []
        return [c.strip() for c in self.primary_keys.split(",") if c.strip()]
```

- [ ] **Step 4: Fix test — update LZ lakehouse GUID in test fixture**

The `lz_parquet_path` test needs the `lz_lakehouse_guid` field set. Update the test fixture to include it. Then run:

Run: `python -m pytest engine/tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/models.py engine/tests/test_models.py
git commit -m "feat(engine): add BronzeEntity and SilverEntity data models"
```

---

### Task 3: OneLake I/O helpers

**Files:**
- Create: `engine/onelake_io.py`

This module wraps ADLS SDK + polars for reading/writing parquet and Delta tables on OneLake. It reuses the existing `OneLakeLoader.get_filesystem()` pattern and `_OneLakeCredential` from `auth.py`.

- [ ] **Step 1: Implement onelake_io.py**

```python
"""
FMD v3 Engine — OneLake I/O helpers for reading/writing parquet and Delta tables.

Uses the same ADLS SDK + credential adapter as loader.py.
Delta read/write via polars (which uses deltalake under the hood).

Path conventions:
    Parquet (LZ):  {lakehouse_id}/Files/{namespace}/{table}.parquet
    Delta (Bronze/Silver): {lakehouse_id}/Tables/{namespace}/{table}/
"""

import io
import logging
import time
from typing import Optional

import polars as pl
from azure.storage.filedatalake import DataLakeServiceClient

from engine.auth import TokenProvider, SCOPE_ONELAKE
from engine.models import EngineConfig

log = logging.getLogger("fmd.onelake_io")


class OneLakeIO:
    """Read and write parquet/Delta files on OneLake via ADLS SDK.

    Usage::

        onio = OneLakeIO(config, token_provider)
        df = onio.read_parquet(workspace_id, "lh_guid/Files/MES/TABLE.parquet")
        onio.write_delta(workspace_id, "lh_guid/Tables/MES/TABLE", df, mode="merge", ...)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._token_provider = token_provider
        self._credential = token_provider.get_datalake_credential()
        self._service_client: Optional[DataLakeServiceClient] = None

    @property
    def service_client(self) -> DataLakeServiceClient:
        if self._service_client is None:
            self._service_client = DataLakeServiceClient(
                account_url=self._config.onelake_account_url,
                credential=self._credential,
            )
        return self._service_client

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_parquet(self, workspace_id: str, path: str) -> Optional[pl.DataFrame]:
        """Read a single parquet file from OneLake into a Polars DataFrame.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID (= ADLS filesystem/container).
        path : str
            Full path within the workspace, e.g. "{lakehouse_id}/Files/MES/TABLE.parquet".
        """
        t0 = time.perf_counter()
        try:
            fs = self.service_client.get_file_system_client(workspace_id)
            file_client = fs.get_file_client(path)
            download = file_client.download_file()
            data = download.readall()
            df = pl.read_parquet(io.BytesIO(data))
            elapsed = time.perf_counter() - t0
            log.info("Read parquet %s: %d rows, %.1f KB in %.1fs",
                     path.split("/")[-1], len(df), len(data) / 1024, elapsed)
            return df
        except Exception as exc:
            log.error("Failed to read parquet %s: %s", path, exc)
            return None

    def read_delta(self, workspace_id: str, table_path: str) -> Optional[pl.DataFrame]:
        """Read a Delta table from OneLake into a Polars DataFrame.

        Uses the abfss:// URI that polars/deltalake understand natively
        with the storage_options for Azure SP auth.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID.
        table_path : str
            Path within workspace, e.g. "{lakehouse_id}/Tables/MES/TABLE".
        """
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df = pl.read_delta(uri, storage_options=storage_options)
            elapsed = time.perf_counter() - t0
            log.info("Read delta %s: %d rows in %.1fs",
                     table_path.split("/")[-1], len(df), elapsed)
            return df
        except Exception as exc:
            error_msg = str(exc)
            # Table doesn't exist yet — that's fine for first load
            if "not found" in error_msg.lower() or "FileNotFoundError" in error_msg:
                log.info("Delta table %s does not exist yet (first load)", table_path)
                return None
            log.error("Failed to read delta %s: %s", table_path, exc)
            return None

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def write_delta(
        self,
        workspace_id: str,
        table_path: str,
        df: pl.DataFrame,
        mode: str = "overwrite",
    ) -> bool:
        """Write a Polars DataFrame as a Delta table to OneLake.

        Parameters
        ----------
        workspace_id : str
            Fabric workspace GUID.
        table_path : str
            Path within workspace, e.g. "{lakehouse_id}/Tables/MES/TABLE".
        df : pl.DataFrame
            Data to write.
        mode : str
            "overwrite" or "append".
        """
        t0 = time.perf_counter()
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            df.write_delta(uri, mode=mode, storage_options=storage_options)
            elapsed = time.perf_counter() - t0
            log.info("Wrote delta %s: %d rows in %.1fs (mode=%s)",
                     table_path.split("/")[-1], len(df), elapsed, mode)
            return True
        except Exception as exc:
            log.error("Failed to write delta %s: %s", table_path, exc)
            return False

    def delta_table_exists(self, workspace_id: str, table_path: str) -> bool:
        """Check if a Delta table exists on OneLake."""
        uri = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{table_path}"
        try:
            token = self._token_provider.get_token(SCOPE_ONELAKE)
            storage_options = {"bearer_token": token, "use_fabric_endpoint": "true"}
            from deltalake import DeltaTable
            DeltaTable(uri, storage_options=storage_options)
            return True
        except Exception:
            return False
```

- [ ] **Step 2: Smoke test import**

Run: `python -c "from engine.onelake_io import OneLakeIO; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add engine/onelake_io.py
git commit -m "feat(engine): add OneLake I/O helpers for reading/writing parquet and Delta tables"
```

---

## Chunk 2: Bronze Processor

### Task 4: Bronze processor — core logic

**Files:**
- Create: `engine/bronze_processor.py`

The bronze processor replicates the Fabric notebook `NB_FMD_LOAD_LANDING_BRONZE`:
1. Read LZ parquet from OneLake
2. Strip whitespace from column names
3. Hash PK columns with SHA-256 → `HashedPKColumn`
4. Deduplicate on PK hash
5. Hash non-PK columns with MD5 → `HashedNonKeyColumns`
6. Add `RecordLoadDate` timestamp
7. Delta merge: insert new + update changed + delete missing (full load only)

- [ ] **Step 1: Write failing test for hash logic**

Create `engine/tests/test_bronze_processor.py`:

```python
"""Tests for bronze processor — hash + dedup + merge logic."""
import polars as pl
from engine.bronze_processor import hash_pk_columns, hash_non_key_columns, deduplicate


def test_hash_pk_columns_single():
    df = pl.DataFrame({"ID": [1, 2, 3], "Name": ["A", "B", "C"]})
    result = hash_pk_columns(df, ["ID"])
    assert "HashedPKColumn" in result.columns
    assert result["HashedPKColumn"].n_unique() == 3


def test_hash_pk_columns_composite():
    df = pl.DataFrame({"K1": [1, 1, 2], "K2": ["a", "b", "a"], "Val": [10, 20, 30]})
    result = hash_pk_columns(df, ["K1", "K2"])
    assert result["HashedPKColumn"].n_unique() == 3


def test_hash_pk_columns_no_pks_uses_all():
    """When no PKs specified, hash all columns."""
    df = pl.DataFrame({"A": [1, 2], "B": ["x", "y"]})
    result = hash_pk_columns(df, [])
    assert "HashedPKColumn" in result.columns
    assert result["HashedPKColumn"].n_unique() == 2


def test_deduplicate():
    df = pl.DataFrame({
        "HashedPKColumn": ["abc", "abc", "def"],
        "Val": [1, 2, 3],
    })
    result = deduplicate(df)
    assert len(result) == 2


def test_hash_non_key_columns():
    df = pl.DataFrame({
        "ID": [1, 2],
        "HashedPKColumn": ["h1", "h2"],
        "Name": ["A", "B"],
        "Val": [10, 20],
    })
    result = hash_non_key_columns(df, ["ID"])
    assert "HashedNonKeyColumns" in result.columns
    assert result["HashedNonKeyColumns"].n_unique() == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest engine/tests/test_bronze_processor.py -v`
Expected: FAIL — `ImportError: cannot import name 'hash_pk_columns'`

- [ ] **Step 3: Implement bronze_processor.py**

```python
"""
FMD v3 Engine — Local Bronze Processor.

Replicates NB_FMD_LOAD_LANDING_BRONZE logic in pure Python:
    LZ Parquet → hash PKs → deduplicate → change-detect → Delta merge → Bronze lakehouse.

Uses polars for DataFrame operations and deltalake for Delta table I/O.
"""

import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import List, Optional

import polars as pl

from engine.models import BronzeEntity, EngineConfig, RunResult
from engine.auth import TokenProvider, SCOPE_ONELAKE
from engine.onelake_io import OneLakeIO

log = logging.getLogger("fmd.bronze")


# ---------------------------------------------------------------------------
# Pure transformation functions (stateless, testable)
# ---------------------------------------------------------------------------

def clean_column_names(df: pl.DataFrame) -> pl.DataFrame:
    """Strip whitespace from column names (matches notebook line 548)."""
    rename_map = {c: c.strip() for c in df.columns if c != c.strip()}
    return df.rename(rename_map) if rename_map else df


def hash_pk_columns(df: pl.DataFrame, pk_columns: list[str]) -> pl.DataFrame:
    """Add HashedPKColumn — SHA-256 hash of PK columns concatenated with ||.

    If no valid PKs found in the DataFrame, falls back to hashing ALL columns.
    Matches notebook lines 595-596.
    """
    # Filter to PK columns that actually exist in the DataFrame
    valid_pks = [c for c in pk_columns if c in df.columns]
    if not valid_pks:
        valid_pks = df.columns  # fallback: all columns

    # Concatenate PKs with || separator, cast all to string first
    concat_expr = pl.concat_str(
        [pl.col(c).cast(pl.Utf8).fill_null("") for c in valid_pks],
        separator="||",
    )
    return df.with_columns(
        concat_expr.hash(seed=0, seed_1=1, seed_2=2, seed_3=3)
        .cast(pl.Utf8)
        .alias("HashedPKColumn")
    )


def deduplicate(df: pl.DataFrame) -> pl.DataFrame:
    """Remove duplicate rows by HashedPKColumn. Matches notebook lines 617-619."""
    return df.unique(subset=["HashedPKColumn"], keep="first")


def hash_non_key_columns(df: pl.DataFrame, pk_columns: list[str]) -> pl.DataFrame:
    """Add HashedNonKeyColumns — hash of all non-PK columns for change detection.

    Matches notebook lines 925-932.
    """
    non_key = [c for c in df.columns
               if c not in pk_columns and c not in ("HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate")]
    if not non_key:
        non_key = [c for c in df.columns if c != "HashedPKColumn"]

    concat_expr = pl.concat_str(
        [pl.col(c).cast(pl.Utf8).fill_null("") for c in non_key],
        separator="||",
    )
    return df.with_columns(
        concat_expr.hash(seed=10, seed_1=11, seed_2=12, seed_3=13)
        .cast(pl.Utf8)
        .alias("HashedNonKeyColumns")
    )


def add_record_load_date(df: pl.DataFrame) -> pl.DataFrame:
    """Add RecordLoadDate timestamp column."""
    return df.with_columns(
        pl.lit(datetime.now(timezone.utc)).alias("RecordLoadDate")
    )


# ---------------------------------------------------------------------------
# Bronze Processor class
# ---------------------------------------------------------------------------

class BronzeProcessor:
    """Process entities from Landing Zone parquet → Bronze Delta tables.

    Usage::

        bp = BronzeProcessor(config, token_provider)
        result = bp.process_entity(entity, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._io = OneLakeIO(config, token_provider)
        self._token_provider = token_provider

    def process_entity(self, entity: BronzeEntity, run_id: str) -> RunResult:
        """Process a single entity: LZ parquet → Bronze Delta table.

        Steps:
        1. Read parquet from LZ lakehouse
        2. Clean column names
        3. Hash PKs → HashedPKColumn
        4. Deduplicate on PK hash
        5. Hash non-PKs → HashedNonKeyColumns
        6. Add RecordLoadDate
        7. Delta merge (or initial write) to Bronze lakehouse
        """
        t0 = time.perf_counter()
        workspace_id = entity.workspace_guid or self._config.workspace_data_id

        log.info("[%s] Bronze: processing entity %d (%s.%s)",
                 run_id[:8], entity.bronze_entity_id, entity.namespace, entity.source_name)

        # Step 1: Read LZ parquet
        df = self._io.read_parquet(workspace_id, entity.lz_parquet_path)
        if df is None or len(df) == 0:
            return RunResult(
                entity_id=entity.bronze_entity_id,
                layer="bronze",
                status="skipped",
                error="No data in LZ parquet file",
                error_suggestion="Ensure Landing Zone has been loaded first.",
            )

        rows_read = len(df)

        # Steps 2-6: Transform
        df = clean_column_names(df)
        df = hash_pk_columns(df, entity.pk_columns)
        df = deduplicate(df)
        df = hash_non_key_columns(df, entity.pk_columns)
        df = add_record_load_date(df)

        rows_after_dedup = len(df)

        # Step 7: Write to Bronze Delta table
        table_path = entity.delta_table_path
        existing = self._io.read_delta(workspace_id, table_path)

        if existing is None:
            # First load — write directly
            log.info("[%s] Bronze %s: first load, writing %d rows",
                     run_id[:8], entity.source_name, len(df))
            success = self._io.write_delta(workspace_id, table_path, df, mode="overwrite")
        else:
            # Merge: insert new + update changed + delete missing (full load only)
            df = self._merge_bronze(existing, df, entity.is_incremental)
            log.info("[%s] Bronze %s: merged, writing %d rows",
                     run_id[:8], entity.source_name, len(df))
            success = self._io.write_delta(workspace_id, table_path, df, mode="overwrite")

        elapsed = time.perf_counter() - t0

        if not success:
            return RunResult(
                entity_id=entity.bronze_entity_id,
                layer="bronze",
                status="failed",
                rows_read=rows_read,
                duration_seconds=round(elapsed, 2),
                error="Failed to write Delta table to Bronze lakehouse",
            )

        return RunResult(
            entity_id=entity.bronze_entity_id,
            layer="bronze",
            status="succeeded",
            rows_read=rows_read,
            rows_written=rows_after_dedup,
            duration_seconds=round(elapsed, 2),
        )

    def _merge_bronze(
        self, existing: pl.DataFrame, incoming: pl.DataFrame, is_incremental: bool
    ) -> pl.DataFrame:
        """Merge incoming data with existing Bronze Delta table.

        Full load: insert new + update changed + delete missing.
        Incremental: insert new + update changed (no deletes).

        Rather than using Delta's merge operation (which requires complex
        predicate pushdown over ADLS), we do a polars-native merge and
        overwrite the entire table. This is simpler and works reliably
        with OneLake's ADLS backend.
        """
        # Ensure both DataFrames have HashedPKColumn
        if "HashedPKColumn" not in existing.columns:
            return incoming  # existing table has no hash — just overwrite

        if is_incremental:
            # Keep all existing rows, update/insert from incoming
            # Join on PK hash to find matches
            matched = existing.join(
                incoming.select(["HashedPKColumn", "HashedNonKeyColumns"]),
                on="HashedPKColumn",
                how="left",
                suffix="_new",
            )
            # Rows where incoming has different content → replace with incoming version
            changed_pks = matched.filter(
                pl.col("HashedNonKeyColumns_new").is_not_null()
                & (pl.col("HashedNonKeyColumns") != pl.col("HashedNonKeyColumns_new"))
            )["HashedPKColumn"]

            # New rows (in incoming but not in existing)
            existing_pks = existing["HashedPKColumn"]
            new_rows = incoming.filter(~pl.col("HashedPKColumn").is_in(existing_pks))

            # Build result: existing minus changed + incoming changed + new
            unchanged = existing.filter(~pl.col("HashedPKColumn").is_in(changed_pks))
            updated = incoming.filter(pl.col("HashedPKColumn").is_in(changed_pks))

            # Align schemas before concat
            result = pl.concat([unchanged, updated, new_rows], how="diagonal_relaxed")
            return result

        else:
            # Full load — incoming IS the truth, just return it
            # (the overwrite mode handles the rest)
            return incoming
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest engine/tests/test_bronze_processor.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add engine/bronze_processor.py engine/tests/test_bronze_processor.py
git commit -m "feat(engine): add local Bronze processor — LZ parquet to Bronze Delta"
```

---

## Chunk 3: Silver Processor

### Task 5: Silver processor — SCD Type 2 logic

**Files:**
- Create: `engine/silver_processor.py`
- Create: `engine/tests/test_silver_processor.py`

The silver processor replicates `NB_FMD_LOAD_BRONZE_SILVER`:
1. Read Bronze Delta table
2. Hash PKs + non-PKs (already done in Bronze, but re-verify)
3. Add SCD Type 2 columns: IsCurrent, RecordStartDate, RecordEndDate, RecordModifiedDate, IsDeleted
4. Compare with existing Silver: detect inserts, updates, soft deletes
5. Build four change DataFrames (inserts, updates_new, updates_old, deletes)
6. Union changes → Delta merge to Silver lakehouse

- [ ] **Step 1: Write failing test for SCD Type 2 detection**

Create `engine/tests/test_silver_processor.py`:

```python
"""Tests for Silver processor — SCD Type 2 change detection."""
import polars as pl
from datetime import datetime, timezone
from engine.silver_processor import detect_changes


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def test_detect_inserts():
    """New rows in incoming that don't exist in Silver."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1"],
        "IsCurrent": [True],
        "IsDeleted": [False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00")],
        "Name": ["Alice"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1", "pk2"],
        "HashedNonKeyColumns": ["h1", "h2"],
        "Name": ["Alice", "Bob"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(inserts) == 1
    assert inserts["HashedPKColumn"][0] == "pk2"
    assert len(updates_new) == 0
    assert len(deletes) == 0


def test_detect_updates():
    """Rows where content hash changed."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1_old"],
        "IsCurrent": [True],
        "IsDeleted": [False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00")],
        "Name": ["Alice"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1_new"],
        "Name": ["Alice Updated"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(inserts) == 0
    assert len(updates_new) == 1  # new version
    assert len(updates_old) == 1  # old version marked not current
    assert updates_old["IsCurrent"][0] == False
    assert updates_new["IsCurrent"][0] == True


def test_detect_soft_deletes():
    """Rows in Silver but missing from incoming → soft delete."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1", "pk2"],
        "HashedNonKeyColumns": ["h1", "h2"],
        "IsCurrent": [True, True],
        "IsDeleted": [False, False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00"), _ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00"), _ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00"), _ts("2026-01-01T00:00:00")],
        "Name": ["Alice", "Bob"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1"],
        "Name": ["Alice"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(deletes) == 1
    assert deletes["HashedPKColumn"][0] == "pk2"
    assert deletes["IsDeleted"][0] == True
    assert deletes["IsCurrent"][0] == False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest engine/tests/test_silver_processor.py -v`
Expected: FAIL — `ImportError: cannot import name 'detect_changes'`

- [ ] **Step 3: Implement silver_processor.py**

```python
"""
FMD v3 Engine — Local Silver Processor with SCD Type 2.

Replicates NB_FMD_LOAD_BRONZE_SILVER logic in pure Python:
    Bronze Delta → SCD Type 2 change detection → Silver Delta.

SCD Type 2 columns:
    IsCurrent (bool)       — True for the latest version of each record
    RecordStartDate (ts)   — When this version became effective
    RecordEndDate (ts)     — When this version was superseded (9999-12-31 for current)
    RecordModifiedDate (ts)— Last modification timestamp
    IsDeleted (bool)       — Soft delete flag (True if record was removed from source)
"""

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import polars as pl

from engine.models import SilverEntity, EngineConfig, RunResult
from engine.auth import TokenProvider
from engine.onelake_io import OneLakeIO

log = logging.getLogger("fmd.silver")

_FAR_FUTURE = datetime(9999, 12, 31, tzinfo=timezone.utc)
_SCD_COLUMNS = ["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted"]


# ---------------------------------------------------------------------------
# Pure transformation functions (stateless, testable)
# ---------------------------------------------------------------------------

def add_scd_columns(df: pl.DataFrame) -> pl.DataFrame:
    """Add SCD Type 2 columns to incoming data (new records).

    Matches notebook lines 813-818.
    """
    now = datetime.now(timezone.utc)
    return df.with_columns(
        pl.lit(True).alias("IsCurrent"),
        pl.lit(now).alias("RecordStartDate"),
        pl.lit(now).alias("RecordModifiedDate"),
        pl.lit(_FAR_FUTURE).alias("RecordEndDate"),
        pl.lit(False).alias("IsDeleted"),
    )


def detect_changes(
    existing: pl.DataFrame,
    incoming: pl.DataFrame,
) -> Tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """Detect inserts, updates, and soft deletes for SCD Type 2.

    Returns (inserts, updates_new, updates_old, deletes) — four DataFrames.

    Logic (matches notebook lines 920-1076):
        - inserts: rows in incoming but NOT in existing (by PK hash)
        - updates_new: rows where PK exists but content hash changed → new version
        - updates_old: matching old versions → mark IsCurrent=False, set RecordEndDate
        - deletes: rows in existing (IsCurrent=True, IsDeleted=False) but NOT in incoming
    """
    now = datetime.now(timezone.utc)

    # Filter existing to current, non-deleted rows only
    current_existing = existing.filter(
        (pl.col("IsCurrent") == True) & (pl.col("IsDeleted") == False)
    )
    existing_pks = current_existing["HashedPKColumn"]
    incoming_pks = incoming["HashedPKColumn"]

    # --- Inserts: in incoming but not in existing ---
    inserts = incoming.filter(~pl.col("HashedPKColumn").is_in(existing_pks))
    inserts = add_scd_columns(inserts)

    # --- Find matched rows (same PK) ---
    matched = current_existing.join(
        incoming.select(["HashedPKColumn", "HashedNonKeyColumns"]),
        on="HashedPKColumn",
        how="inner",
        suffix="_incoming",
    )

    # --- Updates: PK exists but content hash changed ---
    changed = matched.filter(
        pl.col("HashedNonKeyColumns") != pl.col("HashedNonKeyColumns_incoming")
    )
    changed_pks = changed["HashedPKColumn"] if len(changed) > 0 else pl.Series("HashedPKColumn", [], dtype=pl.Utf8)

    # updates_old: existing rows being superseded
    updates_old = current_existing.filter(
        pl.col("HashedPKColumn").is_in(changed_pks)
    ).with_columns(
        pl.lit(False).alias("IsCurrent"),
        pl.lit(now - timedelta(milliseconds=1)).alias("RecordEndDate"),
        pl.lit(now).alias("RecordModifiedDate"),
    )

    # updates_new: incoming rows replacing the old versions
    updates_new = incoming.filter(
        pl.col("HashedPKColumn").is_in(changed_pks)
    )
    updates_new = add_scd_columns(updates_new)

    # --- Soft deletes: in existing but not in incoming ---
    deletes = current_existing.filter(
        ~pl.col("HashedPKColumn").is_in(incoming_pks)
    ).with_columns(
        pl.lit(False).alias("IsCurrent"),
        pl.lit(True).alias("IsDeleted"),
        pl.lit(now).alias("RecordEndDate"),
        pl.lit(now).alias("RecordModifiedDate"),
    )

    return inserts, updates_new, updates_old, deletes


# ---------------------------------------------------------------------------
# Silver Processor class
# ---------------------------------------------------------------------------

class SilverProcessor:
    """Process entities from Bronze Delta → Silver Delta with SCD Type 2.

    Usage::

        sp = SilverProcessor(config, token_provider)
        result = sp.process_entity(entity, run_id)
    """

    def __init__(self, config: EngineConfig, token_provider: TokenProvider):
        self._config = config
        self._io = OneLakeIO(config, token_provider)

    def process_entity(self, entity: SilverEntity, run_id: str) -> RunResult:
        """Process a single entity: Bronze Delta → Silver Delta with SCD Type 2.

        Steps:
        1. Read Bronze Delta table
        2. Read existing Silver Delta table (if any)
        3. If no Silver exists → initial load with SCD columns
        4. If Silver exists → detect changes → union change sets → overwrite
        """
        t0 = time.perf_counter()
        workspace_id = entity.workspace_guid or self._config.workspace_data_id

        log.info("[%s] Silver: processing entity %d (%s.%s)",
                 run_id[:8], entity.silver_entity_id, entity.namespace, entity.source_name)

        # Step 1: Read Bronze Delta
        bronze_df = self._io.read_delta(workspace_id, entity.bronze_delta_path)
        if bronze_df is None or len(bronze_df) == 0:
            return RunResult(
                entity_id=entity.silver_entity_id,
                layer="silver",
                status="skipped",
                error="No data in Bronze Delta table",
                error_suggestion="Ensure Bronze has been loaded first.",
            )

        rows_read = len(bronze_df)

        # Step 2: Read existing Silver
        silver_path = entity.delta_table_path
        existing_silver = self._io.read_delta(workspace_id, silver_path)

        if existing_silver is None or len(existing_silver) == 0:
            # Step 3: Initial load — add SCD columns and write
            log.info("[%s] Silver %s: first load, writing %d rows",
                     run_id[:8], entity.source_name, len(bronze_df))
            result_df = add_scd_columns(bronze_df)
            success = self._io.write_delta(workspace_id, silver_path, result_df, mode="overwrite")
        else:
            # Step 4: SCD Type 2 change detection
            inserts, updates_new, updates_old, deletes = detect_changes(
                existing_silver, bronze_df
            )

            changes_count = len(inserts) + len(updates_new) + len(deletes)
            log.info("[%s] Silver %s: %d inserts, %d updates, %d deletes",
                     run_id[:8], entity.source_name,
                     len(inserts), len(updates_new), len(deletes))

            if changes_count == 0:
                # No changes — skip write
                elapsed = time.perf_counter() - t0
                return RunResult(
                    entity_id=entity.silver_entity_id,
                    layer="silver",
                    status="succeeded",
                    rows_read=rows_read,
                    rows_written=0,
                    duration_seconds=round(elapsed, 2),
                )

            # Build final Silver table:
            # = existing (minus updated old versions, minus deleted) + updates_old + updates_new + inserts + deletes
            # Actually: keep ALL existing history rows, just update the current versions
            changed_or_deleted_pks = pl.concat([
                updates_old.select("HashedPKColumn"),
                deletes.select("HashedPKColumn"),
            ], how="vertical")["HashedPKColumn"] if (len(updates_old) > 0 or len(deletes) > 0) else pl.Series(dtype=pl.Utf8)

            # Keep historical rows untouched, remove current versions that are being updated/deleted
            unchanged = existing_silver.filter(
                ~(
                    (pl.col("IsCurrent") == True)
                    & pl.col("HashedPKColumn").is_in(changed_or_deleted_pks)
                )
            )

            # Union all pieces
            parts = [unchanged]
            if len(updates_old) > 0:
                parts.append(updates_old)
            if len(updates_new) > 0:
                parts.append(updates_new)
            if len(inserts) > 0:
                parts.append(inserts)
            if len(deletes) > 0:
                parts.append(deletes)

            result_df = pl.concat(parts, how="diagonal_relaxed")
            success = self._io.write_delta(workspace_id, silver_path, result_df, mode="overwrite")

        elapsed = time.perf_counter() - t0

        if not success:
            return RunResult(
                entity_id=entity.silver_entity_id,
                layer="silver",
                status="failed",
                rows_read=rows_read,
                duration_seconds=round(elapsed, 2),
                error="Failed to write Delta table to Silver lakehouse",
            )

        return RunResult(
            entity_id=entity.silver_entity_id,
            layer="silver",
            status="succeeded",
            rows_read=rows_read,
            rows_written=len(result_df) if 'result_df' in dir() else rows_read,
            duration_seconds=round(elapsed, 2),
        )
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest engine/tests/test_silver_processor.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add engine/silver_processor.py engine/tests/test_silver_processor.py
git commit -m "feat(engine): add local Silver processor with SCD Type 2 change detection"
```

---

## Chunk 4: Wire Into Orchestrator

### Task 6: Build bronze/silver worklists from SQLite

**Files:**
- Modify: `engine/orchestrator.py`

The orchestrator needs methods to build `BronzeEntity` and `SilverEntity` lists from SQLite, similar to `get_worklist()` for LZ entities.

- [ ] **Step 1: Add get_bronze_worklist and get_silver_worklist methods**

Add to `engine/orchestrator.py` after `get_worklist()` (after line 412):

```python
    def get_bronze_worklist(self, entity_ids: Optional[List[int]] = None) -> List["BronzeEntity"]:
        """Fetch active bronze entities from SQLite, joined with LZ metadata."""
        from engine.models import BronzeEntity

        sql = """
            SELECT
                be.BronzeLayerEntityId,
                be.LandingzoneEntityId,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                le.SourceSchema,
                le.SourceName,
                be.PrimaryKeys,
                le.IsIncremental,
                ? AS BronzeLakehouseGuid,
                ? AS WorkspaceGuid,
                le.FileName AS LZFileName,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS LZNamespace,
                ? AS LZLakehouseGuid,
                be.IsActive
            FROM bronze_entities be
            INNER JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId
            INNER JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
            WHERE be.IsActive = 1
        """
        params = (
            self.config.bronze_lakehouse_id,
            self.config.workspace_data_id,
            self.config.lz_lakehouse_id,
        )

        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            sql += f" AND be.BronzeLayerEntityId IN ({placeholders})"
            params = params + tuple(entity_ids)

        rows = self._cpdb_query(sql, params)
        entities = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                continue
            entities.append(BronzeEntity(
                bronze_entity_id=int(row["BronzeLayerEntityId"]),
                lz_entity_id=int(row["LandingzoneEntityId"]),
                namespace=row.get("Namespace", ""),
                source_schema=row.get("SourceSchema", "dbo"),
                source_name=source_name,
                primary_keys=row.get("PrimaryKeys", "") or "",
                is_incremental=bool(row.get("IsIncremental", False)),
                lakehouse_guid=row.get("BronzeLakehouseGuid", ""),
                workspace_guid=row.get("WorkspaceGuid", ""),
                lz_file_name=row.get("LZFileName", f"{source_name}.parquet"),
                lz_namespace=row.get("LZNamespace", ""),
                lz_lakehouse_guid=row.get("LZLakehouseGuid", ""),
            ))

        log.info("Bronze worklist: %d entities", len(entities))
        return entities

    def get_silver_worklist(self, entity_ids: Optional[List[int]] = None) -> List["SilverEntity"]:
        """Fetch active silver entities from SQLite, joined with bronze metadata."""
        from engine.models import SilverEntity

        sql = """
            SELECT
                se.SilverLayerEntityId,
                se.BronzeLayerEntityId,
                COALESCE(NULLIF(ds.Namespace, ''), ds.Name) AS Namespace,
                le.SourceName,
                be.PrimaryKeys,
                le.IsIncremental,
                ? AS SilverLakehouseGuid,
                ? AS WorkspaceGuid,
                ? AS BronzeLakehouseGuid,
                se.IsActive
            FROM silver_entities se
            INNER JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
            INNER JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId
            INNER JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
            WHERE se.IsActive = 1
        """
        params = (
            self.config.silver_lakehouse_id,
            self.config.workspace_data_id,
            self.config.bronze_lakehouse_id,
        )

        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            sql += f" AND se.SilverLayerEntityId IN ({placeholders})"
            params = params + tuple(entity_ids)

        rows = self._cpdb_query(sql, params)
        entities = []
        for row in rows:
            source_name = str(row.get("SourceName", "") or "").strip()
            if not source_name:
                continue
            entities.append(SilverEntity(
                silver_entity_id=int(row["SilverLayerEntityId"]),
                bronze_entity_id=int(row["BronzeLayerEntityId"]),
                namespace=row.get("Namespace", ""),
                source_name=source_name,
                primary_keys=row.get("PrimaryKeys", "") or "",
                is_incremental=bool(row.get("IsIncremental", False)),
                lakehouse_guid=row.get("SilverLakehouseGuid", ""),
                workspace_guid=row.get("WorkspaceGuid", ""),
                bronze_lakehouse_guid=row.get("BronzeLakehouseGuid", ""),
            ))

        log.info("Silver worklist: %d entities", len(entities))
        return entities
```

- [ ] **Step 2: Commit**

```bash
git add engine/orchestrator.py
git commit -m "feat(engine): add bronze/silver worklist queries from SQLite"
```

---

### Task 7: Wire local bronze/silver into run() and build_plan()

**Files:**
- Modify: `engine/orchestrator.py`

- [ ] **Step 1: Add _run_bronze_local and _run_silver_local methods**

Add to `engine/orchestrator.py` (before the `_run_landing_zone` method, around line 594):

```python
    # ------------------------------------------------------------------
    # Local Bronze processing
    # ------------------------------------------------------------------

    def _run_bronze_local(self, run_id: str) -> List[RunResult]:
        """Process all active bronze entities locally.

        Reads LZ parquet from OneLake → transforms → writes Delta to Bronze lakehouse.
        Uses the same thread pool + adaptive throttle pattern as LZ processing.
        """
        from engine.bronze_processor import BronzeProcessor

        bronze_entities = self.get_bronze_worklist()
        if not bronze_entities:
            log.warning("[%s] No active bronze entities found", run_id[:8])
            return []

        processor = BronzeProcessor(self.config, self._tokens)
        results: list[RunResult] = []

        log.info("[%s] Bronze local: processing %d entities", run_id[:8], len(bronze_entities))

        for entity in bronze_entities:
            if self._stop_requested:
                results.append(RunResult(
                    entity_id=entity.bronze_entity_id,
                    layer="bronze",
                    status="skipped",
                ))
                continue
            try:
                result = processor.process_entity(entity, run_id)
                results.append(result)
            except Exception as exc:
                log.error("[%s] Bronze entity %d failed: %s",
                          run_id[:8], entity.bronze_entity_id, exc)
                results.append(RunResult(
                    entity_id=entity.bronze_entity_id,
                    layer="bronze",
                    status="failed",
                    error=str(exc),
                ))

        succeeded = sum(1 for r in results if r.status == "succeeded")
        failed = sum(1 for r in results if r.status == "failed")
        log.info("[%s] Bronze local: %d succeeded, %d failed, %d skipped",
                 run_id[:8], succeeded, failed, len(results) - succeeded - failed)
        return results

    # ------------------------------------------------------------------
    # Local Silver processing
    # ------------------------------------------------------------------

    def _run_silver_local(self, run_id: str) -> List[RunResult]:
        """Process all active silver entities locally with SCD Type 2.

        Reads Bronze Delta → change detection → writes Silver Delta.
        """
        from engine.silver_processor import SilverProcessor

        silver_entities = self.get_silver_worklist()
        if not silver_entities:
            log.warning("[%s] No active silver entities found", run_id[:8])
            return []

        processor = SilverProcessor(self.config, self._tokens)
        results: list[RunResult] = []

        log.info("[%s] Silver local: processing %d entities", run_id[:8], len(silver_entities))

        for entity in silver_entities:
            if self._stop_requested:
                results.append(RunResult(
                    entity_id=entity.silver_entity_id,
                    layer="silver",
                    status="skipped",
                ))
                continue
            try:
                result = processor.process_entity(entity, run_id)
                results.append(result)
            except Exception as exc:
                log.error("[%s] Silver entity %d failed: %s",
                          run_id[:8], entity.silver_entity_id, exc)
                results.append(RunResult(
                    entity_id=entity.silver_entity_id,
                    layer="silver",
                    status="failed",
                    error=str(exc),
                ))

        succeeded = sum(1 for r in results if r.status == "succeeded")
        failed = sum(1 for r in results if r.status == "failed")
        log.info("[%s] Silver local: %d succeeded, %d failed, %d skipped",
                 run_id[:8], succeeded, failed, len(results) - succeeded - failed)
        return results
```

- [ ] **Step 2: Modify run() to dispatch local bronze/silver**

Replace the bronze/silver sections in `run()` (lines 244-258 of `orchestrator.py`):

**BEFORE:**
```python
            # Bronze — trigger Fabric notebook
            bronze_duration = 0.0
            if not layers or "bronze" in layers:
                bronze_t = time.time()
                bronze_result = self._notebooks.run_bronze(run_id)
                results.append(bronze_result)
                bronze_duration = time.time() - bronze_t

            # Silver — trigger Fabric notebook
            silver_duration = 0.0
            if not layers or "silver" in layers:
                silver_t = time.time()
                silver_result = self._notebooks.run_silver(run_id)
                results.append(silver_result)
                silver_duration = time.time() - silver_t
```

**AFTER:**
```python
            # Bronze
            bronze_duration = 0.0
            if not layers or "bronze" in layers:
                bronze_t = time.time()
                if effective_method == "local":
                    bronze_results = self._run_bronze_local(run_id)
                    results.extend(bronze_results)
                else:
                    bronze_result = self._notebooks.run_bronze(run_id)
                    results.append(bronze_result)
                bronze_duration = time.time() - bronze_t

            # Silver
            silver_duration = 0.0
            if not layers or "silver" in layers:
                silver_t = time.time()
                if effective_method == "local":
                    silver_results = self._run_silver_local(run_id)
                    results.extend(silver_results)
                else:
                    silver_result = self._notebooks.run_silver(run_id)
                    results.append(silver_result)
                silver_duration = time.time() - silver_t
```

- [ ] **Step 3: Update build_plan() for local bronze/silver**

In `build_plan()`, update the bronze and silver sections (around lines 500-534) to respect `effective_method`:

Replace the bronze section:
```python
        if "bronze" in active_layers:
            if effective_method == "local":
                layer_plan.append({
                    "layer": "bronze",
                    "action": "Read LZ parquet → hash PKs → change-detect → write Bronze Delta",
                    "method": "local",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": None,
                    "details": "Local Python processing: polars + deltalake. Per-entity Delta merge to OneLake Bronze lakehouse.",
                })
            else:
                nb_id = self.config.notebook_bronze_id
                layer_plan.append({
                    "layer": "bronze",
                    "action": "Trigger NB_FMD_LOAD_LANDING_BRONZE via NB_FMD_PROCESSING_PARALLEL_MAIN",
                    "method": "notebook",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": nb_id or None,
                    "details": f"Notebook {nb_id or '(auto-discover)'} processes each entity: read parquet from LZ → write Delta table to Bronze lakehouse",
                })
                if not nb_id:
                    warnings.append("Bronze notebook ID not configured — will attempt auto-discovery")
```

Replace the silver section similarly:
```python
        if "silver" in active_layers:
            if effective_method == "local":
                layer_plan.append({
                    "layer": "silver",
                    "action": "Read Bronze Delta → SCD Type 2 change detection → write Silver Delta",
                    "method": "local",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": None,
                    "details": "Local Python processing: polars + deltalake. SCD Type 2 merge with IsCurrent/RecordStartDate/RecordEndDate/IsDeleted.",
                })
            else:
                nb_id = self.config.notebook_silver_id
                layer_plan.append({
                    "layer": "silver",
                    "action": "Trigger NB_FMD_LOAD_BRONZE_SILVER via NB_FMD_PROCESSING_PARALLEL_MAIN",
                    "method": "notebook",
                    "entity_count": len(entities),
                    "batch_size": self.config.batch_size,
                    "chunk_rows": None,
                    "notebook_id": nb_id or None,
                    "details": f"Notebook {nb_id or '(auto-discover)'} processes each entity: SCD Type 2 merge from Bronze → Silver Delta table",
                })
                if not nb_id:
                    warnings.append("Silver notebook ID not configured — will attempt auto-discovery")
```

- [ ] **Step 4: Add imports at top of orchestrator.py**

Add to imports (only needed for type hints; actual imports are lazy):
```python
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from engine.models import BronzeEntity, SilverEntity
```

- [ ] **Step 5: Run existing engine tests to verify no regressions**

Run: `python -m pytest engine/tests/ -v`
Expected: ALL PASS (or at least no new failures)

- [ ] **Step 6: Commit**

```bash
git add engine/orchestrator.py
git commit -m "feat(engine): wire local bronze/silver processing into orchestrator"
```

---

### Task 8: Smoke test — end-to-end local bronze/silver

**Files:**
- No new files — manual verification

- [ ] **Step 1: Verify engine status shows local mode**

```bash
curl -s http://127.0.0.1:8787/api/engine/settings | python -m json.tool
```
Expected: `"load_method": "local"`

- [ ] **Step 2: Test plan mode with bronze/silver**

```bash
curl -s -X POST http://127.0.0.1:8787/api/engine/run \
  -H "Content-Type: application/json" \
  -d '{"mode": "plan", "layers": ["bronze", "silver"]}' | python -m json.tool
```
Expected: Plan output showing `"method": "local"` for both bronze and silver layers.

- [ ] **Step 3: Run a single entity through bronze**

Pick one entity (e.g. ETQ entity #30 = small table) and run just bronze:
```bash
curl -s -X POST http://127.0.0.1:8787/api/engine/run \
  -H "Content-Type: application/json" \
  -d '{"mode": "run", "layers": ["bronze"], "entity_ids": [30]}'
```
Watch engine logs for: `Bronze local: processing 1 entities`

- [ ] **Step 4: Run a single entity through silver**

Same entity through silver:
```bash
curl -s -X POST http://127.0.0.1:8787/api/engine/run \
  -H "Content-Type: application/json" \
  -d '{"mode": "run", "layers": ["silver"], "entity_ids": [30]}'
```
Watch for: `Silver local: processing 1 entities`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(engine): local bronze/silver processing — complete implementation"
```

---

## Summary

| Task | Component | Estimated Complexity |
|------|-----------|---------------------|
| 1 | Add deltalake dep | Trivial |
| 2 | BronzeEntity/SilverEntity models | Small |
| 3 | OneLake I/O helpers | Medium |
| 4 | Bronze processor | Medium |
| 5 | Silver processor (SCD Type 2) | Medium-Large |
| 6 | Worklist queries | Small |
| 7 | Wire into orchestrator | Medium |
| 8 | Smoke test | Verification |

**Key architectural decisions:**
- **Overwrite-based merge** instead of Delta's native merge — simpler, avoids ADLS predicate pushdown complexity. Read existing → compute changes in polars → overwrite entire table. For tables with millions of rows this would need optimization, but for the current 1,666 entities with typical enterprise table sizes, it's fine.
- **Sequential entity processing** for now (no thread pool for bronze/silver). OneLake writes are the bottleneck, not CPU. Can add parallelism later if needed.
- **Same hash approach as notebooks** (polars hash instead of SHA-256/MD5) — the hashes don't need to be cross-compatible with existing notebook-created tables since we're starting fresh.
