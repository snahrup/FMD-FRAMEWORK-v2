"""
FMD v3 Engine — Data models.

All structured data flows through these dataclasses.
No ORM, no framework — just typed Python objects with JSON serialisation.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional, List
import json


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

    @property
    def qualified_name(self) -> str:
        """Fully qualified source table: [schema].[table]."""
        return f"[{self.source_schema}].[{self.source_name}]"

    @property
    def onelake_folder(self) -> str:
        """OneLake folder path segment: {Namespace}/{Schema}_{Table}/"""
        ns = self.namespace or self.source_database
        return f"{ns}/{self.source_schema}_{self.source_name}"

    def build_source_query(self) -> str:
        """Build the extraction SQL — full or incremental."""
        base = f"SELECT * FROM {self.qualified_name}"
        if self.is_incremental and self.watermark_column and self.last_load_value:
            return f"{base} WHERE [{self.watermark_column}] > '{self.last_load_value}'"
        return base


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

    # Notebook item IDs in CODE workspace (for triggering)
    notebook_bronze_id: str = ""
    notebook_silver_id: str = ""

    # Operational tunables
    batch_size: int = 12                    # concurrent entity extractions (bumped from 8, 15 was too aggressive for VPN)
    chunk_rows: int = 500_000               # rows per Parquet chunk for large tables
    copy_timeout_seconds: int = 14_400      # 4 hours max per entity
    notebook_timeout_seconds: int = 21_600  # 6 hours max for notebook run
    query_timeout: int = 120                # seconds — max time for a single SQL query before abort

    # Source SQL driver (on-prem)
    source_sql_driver: str = "ODBC Driver 18 for SQL Server"

    # Pipeline mode — "local" (pyodbc/parquet) or "pipeline" (Fabric Copy Activity)
    load_method: str = "local"               # "local" | "pipeline"
    pipeline_fallback: bool = True           # auto-fallback to local on pipeline failure
    pipeline_copy_sql_id: str = ""           # GUID of deployed PL_FMD_LDZ_COPY_SQL
    pipeline_workspace_id: str = ""          # workspace where COPY_SQL pipeline lives


# ---------------------------------------------------------------------------
# Plan output — returned by mode="plan"
# ---------------------------------------------------------------------------

@dataclass
class LoadPlan:
    """What would happen if you ran the engine right now."""

    run_id: str
    entity_count: int
    incremental_count: int
    full_load_count: int
    layers: List[str]
    entities: List[dict] = field(default_factory=list)
    estimated_rows: int = 0

    def to_dict(self) -> dict:
        return asdict(self)
