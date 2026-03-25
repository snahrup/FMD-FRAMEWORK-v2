"""
FMD v3 Engine — Data models.

All structured data flows through these dataclasses.
No ORM, no framework — just typed Python objects with JSON serialisation.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional, List
import json
import re


# ---------------------------------------------------------------------------
# Core entity model (one row from execution.vw_LoadSourceToLandingzone)
# ---------------------------------------------------------------------------

@dataclass
class Entity:
    """A single table/view to extract from a source SQL server."""

    id: int
    source_name: str
    source_schema: str
    source_server: str
    source_database: str
    datasource_id: int
    connection_type: str
    workspace_guid: str
    lakehouse_guid: str
    file_path: str
    file_name: str
    is_incremental: bool
    watermark_column: Optional[str] = None
    last_load_value: Optional[str] = None
    primary_keys: Optional[str] = None
    is_active: bool = True
    namespace: Optional[str] = None          # e.g. "MES", "ETQ" — for OneLake path
    connection_guid: str = ""                # Fabric Connection GUID for pipeline mode

    _SAFE_IDENT = re.compile(r'^[\w\.\[\] ]+$')

    @property
    def qualified_name(self) -> str:
        """Fully qualified source table: [schema].[table].

        Validates identifiers with regex, then bracket-escapes ] characters.
        """
        if not self._SAFE_IDENT.match(self.source_schema):
            raise ValueError(f"Unsafe schema identifier: {self.source_schema!r}")
        if not self._SAFE_IDENT.match(self.source_name):
            raise ValueError(f"Unsafe table identifier: {self.source_name!r}")
        safe_schema = self.source_schema.replace("]", "]]")
        safe_name = self.source_name.replace("]", "]]")
        return "[" + safe_schema + "].[" + safe_name + "]"

    @property
    def onelake_folder(self) -> str:
        """OneLake folder = just the namespace. See ARCHITECTURE.md."""
        return self.namespace or self.source_database

    def build_source_query(self) -> tuple[str, list]:
        """Build the extraction SQL — full or incremental.

        Returns (sql, params) tuple for parameterized execution via pyodbc.
        Table/column names stay as identifiers; the watermark VALUE uses a ?
        placeholder to prevent SQL injection.  Fixes: CRITICAL BUG #2
        """
        base = "SELECT * FROM " + self.qualified_name
        if self.is_incremental and self.watermark_column and self.last_load_value:
            if not self._SAFE_IDENT.match(self.watermark_column):
                raise ValueError("Unsafe watermark column: " + repr(self.watermark_column))
            safe_wm = self.watermark_column.replace("]", "]]")
            return base + " WHERE [" + safe_wm + "] > ?", [self.last_load_value]
        return base, []

    def build_source_query_display(self) -> str:
        """Human-readable version of the extraction query (for logging / audit).

        NOT for execution — use build_source_query() with cursor.execute(sql, params).
        """
        base = "SELECT * FROM " + self.qualified_name
        if self.is_incremental and self.watermark_column and self.last_load_value:
            if not self._SAFE_IDENT.match(self.watermark_column):
                raise ValueError(f"Unsafe watermark column: {self.watermark_column!r}")
            safe_wm = self.watermark_column.replace("]", "]]")
            escaped = self.last_load_value.replace("'", "''")
            return base + " WHERE [" + safe_wm + "] > '" + escaped + "'"
        return base


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
    lz_entity_id: int = 0              # LZ entity ID (for entity_status tracking)
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


# ---------------------------------------------------------------------------
# Run result — one per entity per layer
# ---------------------------------------------------------------------------

@dataclass
class RunResult:
    """Outcome of a single extract/load/notebook operation."""

    entity_id: int
    layer: str                              # landing | bronze | silver
    status: str                             # succeeded | failed | skipped
    rows_read: int = 0
    rows_written: int = 0
    bytes_transferred: int = 0
    duration_seconds: float = 0.0
    error: Optional[str] = None
    error_suggestion: Optional[str] = None  # plain-English hint for operators
    watermark_before: Optional[str] = None
    watermark_after: Optional[str] = None

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"


# ---------------------------------------------------------------------------
# Structured log envelope — every operation emits one of these
# ---------------------------------------------------------------------------

@dataclass
class LogEnvelope:
    """Structured log record.  ALWAYS valid JSON, ALWAYS populated.

    Designed to be stored in logging.AuditCopyActivity via sp_AuditCopyActivity
    and also written to the Python logger for local troubleshooting.
    """

    v: int                                  # schema version (currently 1)
    run_id: str
    entity_id: int
    layer: str
    action: str                             # extract | load | notebook | preflight
    source: dict = field(default_factory=dict)
    target: dict = field(default_factory=dict)
    watermark: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    error: Optional[dict] = None
    timestamps: dict = field(default_factory=dict)

    def to_json(self) -> str:
        """Serialise to JSON string — safe for SQL insertion."""
        return json.dumps(asdict(self), default=str)

    @classmethod
    def for_entity(
        cls,
        run_id: str,
        entity: "Entity",
        layer: str,
        action: str,
    ) -> "LogEnvelope":
        """Factory — pre-populate source/target/watermark from an Entity."""
        return cls(
            v=1,
            run_id=run_id,
            entity_id=entity.id,
            layer=layer,
            action=action,
            source={
                "server": entity.source_server,
                "database": entity.source_database,
                "schema": entity.source_schema,
                "table": entity.source_name,
            },
            target={
                "workspace": entity.workspace_guid,
                "lakehouse": entity.lakehouse_guid,
                "path": entity.file_path,
                "file": entity.file_name,
            },
            watermark={
                "column": entity.watermark_column,
                "before": entity.last_load_value,
                "after": None,
            },
            timestamps={
                "started": datetime.now(timezone.utc).isoformat(),
                "ended": None,
            },
        )


# ---------------------------------------------------------------------------
# Engine configuration (populated by config.py)
# ---------------------------------------------------------------------------

@dataclass
class EngineConfig:
    """All configuration the engine needs to run — no globals."""

    # Fabric SQL metadata DB
    sql_server: str
    sql_database: str
    sql_driver: str

    # Service Principal
    tenant_id: str
    client_id: str
    client_secret: str

    # Fabric workspace / lakehouse GUIDs
    workspace_data_id: str
    workspace_code_id: str
    lz_lakehouse_id: str
    bronze_lakehouse_id: str
    silver_lakehouse_id: str

    # OneLake ADLS endpoint
    onelake_account_url: str = "https://onelake.dfs.fabric.microsoft.com"

    # OneLake Explorer local mount path (filesystem mode — no auth needed)
    # When set, engine reads/writes via local filesystem instead of ADLS SDK.
    # OneLake Explorer syncs changes to Fabric automatically.
    # Example: "C:\\Users\\sasnahrup\\OneLake - Microsoft\\INTEGRATION DATA (D)"
    onelake_mount_path: str = ""

    # Notebook item IDs in CODE workspace (for triggering)
    notebook_bronze_id: str = ""
    notebook_silver_id: str = ""
    notebook_processing_id: str = ""     # NB_FMD_PROCESSING_PARALLEL_MAIN
    notebook_maintenance_id: str = ""    # NB_FMD_MAINTENANCE_AGENT

    # Operational tunables
    batch_size: int = 12                    # concurrent entity extractions (bumped from 8, 15 was too aggressive for VPN)
    chunk_rows: int = 500_000               # rows per Parquet chunk for large tables
    copy_timeout_seconds: int = 14_400      # 4 hours max per entity
    notebook_timeout_seconds: int = 21_600  # 6 hours max for notebook run
    query_timeout: int = 300                # seconds — max time for a single SQL query before abort (raised from 120: large MES tables need 3-5min)

    # Source SQL driver (on-prem)
    source_sql_driver: str = "ODBC Driver 18 for SQL Server"

    # Pipeline mode — "local" (pyodbc/parquet) or "pipeline" (Fabric Copy Activity)
    load_method: str = "local"               # "local" | "pipeline"
    pipeline_fallback: bool = True           # auto-fallback to local on pipeline failure
    pipeline_copy_sql_id: str = ""           # GUID of deployed PL_FMD_LDZ_COPY_SQL
    pipeline_workspace_id: str = ""          # workspace where COPY_SQL pipeline lives

    # Delta table maintenance
    delta_compact_interval: int = 10         # compact after every N writes per table
    delta_vacuum_retention_days: int = 7     # VACUUM retention period in days

    def __post_init__(self):
        """Validate configuration at instantiation.

        CRITICAL: Fails fast on missing required fields.
        Prevents silent 30-second timeouts with unclear error messages.

        Fixes: CRITICAL BUG #1
        """
        required_fields = {
            'sql_server': self.sql_server,
            'sql_database': self.sql_database,
            'tenant_id': self.tenant_id,
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'workspace_data_id': self.workspace_data_id,
            'workspace_code_id': self.workspace_code_id,
            'lz_lakehouse_id': self.lz_lakehouse_id,
            'bronze_lakehouse_id': self.bronze_lakehouse_id,
            'silver_lakehouse_id': self.silver_lakehouse_id,
        }

        missing = [name for name, value in required_fields.items() if not value or not str(value).strip()]
        if missing:
            raise ValueError(
                f"Configuration error: The following required fields are empty or missing:\n"
                f"  {', '.join(missing)}\n\n"
                f"Check dashboard/app/api/config.json and ensure all fields are populated."
            )

        # Validate integer tunables are reasonable
        if self.batch_size <= 0:
            raise ValueError(f"batch_size must be > 0, got {self.batch_size}")
        if self.chunk_rows <= 0:
            raise ValueError(f"chunk_rows must be > 0, got {self.chunk_rows}")
        if self.query_timeout <= 0:
            raise ValueError(f"query_timeout must be > 0, got {self.query_timeout}")


# ---------------------------------------------------------------------------
# Plan output — returned by mode="plan"
# ---------------------------------------------------------------------------

@dataclass
class LoadPlan:
    """What would happen if you ran the engine right now.

    This is a COMPLETE simulation of a live run — every entity, every layer,
    every source, every notebook.  The frontend renders this as a detailed
    execution plan so users know EXACTLY what will happen before they commit.
    """

    run_id: str
    entity_count: int
    incremental_count: int
    full_load_count: int
    layers: List[str]
    entities: List[dict] = field(default_factory=list)
    estimated_rows: int = 0

    # ── Per-source breakdown ──
    sources: List[dict] = field(default_factory=list)

    # ── Per-layer execution plan ──
    layer_plan: List[dict] = field(default_factory=list)

    # ── Engine config snapshot ──
    config_snapshot: dict = field(default_factory=dict)

    # ── Warnings / issues detected during planning ──
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
