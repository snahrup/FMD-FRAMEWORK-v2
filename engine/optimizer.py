"""
FMD v3 Engine — Load optimization: PK discovery + watermark detection.

Encapsulates the logic for:
  1. Primary key discovery (via sys.indexes queries)
  2. Watermark column detection (datetime/identity columns with priority scoring)
  3. Entity classification (incremental vs full load)

This module provides PURE LOGIC and SQL generation — no database connections,
no Fabric API calls, no network I/O.  Pass in raw query results, get back
typed optimization results.

Watermark priority (lower = better):
  rowversion/timestamp  → SKIP (binary can't compare as varchar)
  *Modified*/*Updated*  datetime → priority 2
  *Created*/*Inserted*  datetime → priority 3
  identity column       → priority 4
  other datetime        → priority 5+
  (Only priority ≤ 3 auto-qualify as incremental)

Usage::

    from engine.optimizer import classify_entity, build_pk_query, build_watermark_query

    # Generate SQL for source databases
    pk_sql = build_pk_query()
    wm_sql = build_watermark_query()

    # After running those queries, classify each entity
    result = classify_entity(
        entity_id=42,
        schema="dbo",
        table="Orders",
        pk_columns=["OrderId"],
        watermark_candidates=[
            {"column": "ModifiedDate", "type": "datetime2", "is_identity": False},
            {"column": "CreatedDate", "type": "datetime", "is_identity": False},
        ],
    )
    print(result.is_incremental)  # True
    print(result.watermark_column)  # "ModifiedDate"
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Column name patterns indicating modification timestamps (priority 2)
MODIFIED_PATTERNS = ("modif", "updat", "chang", "last_")

# Column name patterns indicating creation timestamps (priority 3)
CREATED_PATTERNS = ("creat", "insert", "added")

# Datetime SQL types eligible for watermark detection
DATETIME_TYPES = frozenset({
    "datetime", "datetime2", "datetimeoffset", "smalldatetime",
})

# Binary types that CANNOT be used as watermarks (varchar comparison fails)
BINARY_WATERMARK_TYPES = frozenset({"timestamp", "rowversion"})

# Maximum priority for a column to qualify as incremental
# Priority 2: Modified/Updated datetime (best)
# Priority 3: Created datetime (good)
# Priority 4: Identity column (usable — nearly every table has one)
MAX_INCREMENTAL_PRIORITY = 4


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class WatermarkCandidate:
    """A potential watermark column discovered from source metadata."""
    column: str
    data_type: str
    priority: int
    is_identity: bool = False

    @property
    def qualifies_as_incremental(self) -> bool:
        """True if this candidate's priority qualifies for automatic incremental load."""
        return self.priority <= MAX_INCREMENTAL_PRIORITY


@dataclass
class OptimizationResult:
    """Optimization analysis result for a single entity."""
    entity_id: int
    schema: str
    table: str
    primary_keys: Optional[str] = None
    watermark_column: Optional[str] = None
    watermark_type: Optional[str] = None
    watermark_priority: Optional[int] = None
    is_incremental: bool = False
    candidates: List[WatermarkCandidate] = field(default_factory=list)

    @property
    def has_primary_keys(self) -> bool:
        return bool(self.primary_keys)

    def to_dict(self) -> dict:
        return {
            "id": self.entity_id,
            "schema": self.schema,
            "name": self.table,
            "primary_keys": self.primary_keys,
            "watermark_col": self.watermark_column,
            "watermark_type": self.watermark_type,
            "watermark_priority": self.watermark_priority,
            "is_incremental": self.is_incremental,
            "watermark_candidates": [
                {
                    "column": c.column,
                    "type": c.data_type,
                    "priority": c.priority,
                    "is_identity": c.is_identity,
                }
                for c in self.candidates
            ],
        }


@dataclass
class OptimizationSummary:
    """Aggregate summary of optimization across all entities."""
    total_entities: int = 0
    entities_with_pks: int = 0
    entities_incremental: int = 0
    entities_full_load: int = 0
    results: List[OptimizationResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total_entities": self.total_entities,
            "entities_with_pks": self.entities_with_pks,
            "entities_incremental": self.entities_incremental,
            "entities_full_load": self.entities_full_load,
            "results": [r.to_dict() for r in self.results],
        }


# ---------------------------------------------------------------------------
# SQL generation — queries to run against source databases
# ---------------------------------------------------------------------------

def build_pk_query() -> str:
    """Return the SQL query to discover primary keys from a source database.

    Run this against each on-prem source SQL Server. The result set has three
    columns: (schema_name, table_name, column_name), ordered by key ordinal.

    Group results by (schema, table) and join column names with ',' to get
    the PK string per entity.
    """
    return """
        SELECT s.name AS schema_name,
               t.name AS table_name,
               c.name AS column_name
        FROM sys.indexes i
        JOIN sys.index_columns ic
            ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c
            ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        JOIN sys.tables t
            ON i.object_id = t.object_id
        JOIN sys.schemas s
            ON t.schema_id = s.schema_id
        WHERE i.is_primary_key = 1
        ORDER BY s.name, t.name, ic.key_ordinal
    """.strip()


def build_watermark_query() -> str:
    """Return the SQL query to discover watermark candidate columns.

    Run this against each on-prem source SQL Server. Returns columns that are
    either datetime-family types or identity columns. The result set has five
    columns: (schema_name, table_name, column_name, type_name, is_identity).
    """
    return """
        SELECT s.name AS schema_name,
               t.name AS table_name,
               c.name AS column_name,
               tp.name AS type_name,
               COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') AS is_identity
        FROM sys.columns c
        JOIN sys.tables t ON c.object_id = t.object_id
        JOIN sys.schemas s ON t.schema_id = s.schema_id
        JOIN sys.types tp
            ON c.system_type_id = tp.system_type_id
            AND c.user_type_id = tp.user_type_id
        WHERE (
            tp.name IN ('datetime','datetime2','datetimeoffset','smalldatetime')
            OR COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') = 1
        )
    """.strip()


# ---------------------------------------------------------------------------
# Pure logic — no I/O
# ---------------------------------------------------------------------------

def score_watermark_column(column_name: str, data_type: str, is_identity: bool) -> Optional[int]:
    """Compute the priority score for a watermark candidate column.

    Returns None if the column should be skipped (binary types).
    Lower priority = better watermark candidate.

    Parameters
    ----------
    column_name : str
        The column name from the source table.
    data_type : str
        The SQL Server data type name.
    is_identity : bool
        True if the column is an identity column.

    Returns
    -------
    int or None
        Priority score (2-6), or None if the column should be skipped.
    """
    dtype_lower = data_type.lower().strip()

    # Skip binary types — they can't be compared as varchar in WHERE clauses
    if dtype_lower in BINARY_WATERMARK_TYPES:
        return None

    col_lower = column_name.lower()

    if dtype_lower in DATETIME_TYPES:
        if any(kw in col_lower for kw in MODIFIED_PATTERNS):
            return 2  # Modified/Updated datetime — best candidate
        if any(kw in col_lower for kw in CREATED_PATTERNS):
            return 3  # Created datetime — good candidate
        return 5  # Generic datetime — poor candidate (often not monotonic)

    if is_identity:
        return 4  # Identity — usable but not ideal for time-based incremental

    return 6  # Unknown type that passed the query filter


def format_primary_keys(columns: List[str]) -> str:
    """Format a list of PK column names into the comma-separated string stored in metadata.

    Parameters
    ----------
    columns : list of str
        Column names in key ordinal order.

    Returns
    -------
    str
        Comma-separated PK string, e.g. "OrderId,LineNumber".
    """
    return ",".join(c.strip() for c in columns if c and c.strip())


def parse_pk_rows(rows: List[Tuple[str, str, str]]) -> Dict[Tuple[str, str], List[str]]:
    """Parse raw PK query results into a lookup dict.

    Parameters
    ----------
    rows : list of (schema, table, column) tuples
        Raw result from build_pk_query().

    Returns
    -------
    dict
        Mapping of (schema, table) → [column1, column2, ...] in ordinal order.
    """
    pk_map: Dict[Tuple[str, str], List[str]] = {}
    for schema, table, column in rows:
        pk_map.setdefault((schema, table), []).append(column)
    return pk_map


def parse_watermark_rows(
    rows: List[Tuple[str, str, str, str, int]],
) -> Dict[Tuple[str, str], List[WatermarkCandidate]]:
    """Parse raw watermark query results into scored candidates.

    Skips binary types (rowversion/timestamp) automatically.

    Parameters
    ----------
    rows : list of (schema, table, column, type_name, is_identity) tuples
        Raw result from build_watermark_query().

    Returns
    -------
    dict
        Mapping of (schema, table) → [WatermarkCandidate, ...] sorted by priority.
    """
    wm_map: Dict[Tuple[str, str], List[WatermarkCandidate]] = {}
    for schema, table, column, dtype, is_id in rows:
        priority = score_watermark_column(column, dtype, bool(is_id))
        if priority is None:
            continue  # Binary type — skip
        candidate = WatermarkCandidate(
            column=column,
            data_type=dtype,
            priority=priority,
            is_identity=bool(is_id),
        )
        wm_map.setdefault((schema, table), []).append(candidate)

    # Sort candidates within each table by priority
    for key in wm_map:
        wm_map[key].sort(key=lambda c: c.priority)

    return wm_map


def classify_entity(
    entity_id: int,
    schema: str,
    table: str,
    pk_columns: Optional[List[str]] = None,
    watermark_candidates: Optional[List[dict]] = None,
) -> OptimizationResult:
    """Classify a single entity based on its PK and watermark metadata.

    This is the core classification function. It takes raw metadata and returns
    a fully classified OptimizationResult.

    Parameters
    ----------
    entity_id : int
        The LandingzoneEntityId.
    schema : str
        Source table schema.
    table : str
        Source table name.
    pk_columns : optional list of str
        Primary key column names (in ordinal order).
    watermark_candidates : optional list of dict
        Each dict has keys: column, type, is_identity. These are scored and
        the best candidate is selected.

    Returns
    -------
    OptimizationResult
        Complete optimization analysis for this entity.
    """
    result = OptimizationResult(
        entity_id=entity_id,
        schema=schema,
        table=table,
    )

    # PKs
    if pk_columns:
        result.primary_keys = format_primary_keys(pk_columns)

    # Watermark scoring
    if watermark_candidates:
        scored = []
        for wm in watermark_candidates:
            col = wm.get("column", "")
            dtype = wm.get("type", "")
            is_id = bool(wm.get("is_identity", False))
            priority = score_watermark_column(col, dtype, is_id)
            if priority is not None:
                scored.append(WatermarkCandidate(
                    column=col,
                    data_type=dtype,
                    priority=priority,
                    is_identity=is_id,
                ))

        scored.sort(key=lambda c: c.priority)
        result.candidates = scored

        if scored and scored[0].qualifies_as_incremental:
            best = scored[0]
            result.watermark_column = best.column
            result.watermark_type = best.data_type
            result.watermark_priority = best.priority
            result.is_incremental = True

    return result


def auto_optimize(source_conn, entities, cpdb_execute, cpdb_query) -> dict:
    """Auto-discover PKs and watermarks for entities missing them.

    Connects to each on-prem source, runs bulk discovery queries, and
    updates both the in-memory entity objects and the local SQLite DB.
    This is the "zero manual steps" integration point — called by the
    orchestrator before the LZ extract phase.

    Parameters
    ----------
    source_conn : SourceConnection
        Connection manager for on-prem sources.
    entities : list
        Entity objects from the worklist. Modified in-place.
    cpdb_execute : callable
        Execute SQL against local control-plane SQLite.
    cpdb_query : callable
        Query SQL against local control-plane SQLite.

    Returns
    -------
    dict with counts: {'pk_discovered': N, 'watermark_discovered': N, 'skipped': N, 'errors': N}
    """
    import logging as _log
    _logger = _log.getLogger("fmd.optimizer")

    # Find entities needing optimization
    needs_pk = [e for e in entities if not e.primary_keys]
    needs_wm = [e for e in entities if not e.watermark_column]

    need_ids = {e.id for e in needs_pk} | {e.id for e in needs_wm}
    if not need_ids:
        _logger.info("All %d entities already optimized — skipping discovery", len(entities))
        return {"pk_discovered": 0, "watermark_discovered": 0, "skipped": 0, "errors": 0}

    _logger.info("Auto-optimizing %d/%d entities (need PK: %d, need watermark: %d)",
                 len(need_ids), len(entities), len(needs_pk), len(needs_wm))

    # Group entities by (server, database) to batch queries
    by_source: dict = {}
    entity_map = {e.id: e for e in entities}
    for eid in need_ids:
        e = entity_map[eid]
        key = (e.source_server, e.source_database)
        by_source.setdefault(key, []).append(e)

    stats = {"pk_discovered": 0, "watermark_discovered": 0, "skipped": 0, "errors": 0}
    pk_sql = build_pk_query()
    wm_sql = build_watermark_query()

    for (server, database), group in by_source.items():
        if not server or not database:
            stats["skipped"] += len(group)
            continue

        try:
            with source_conn.connect(server, database, timeout=20) as conn:
                cursor = conn.cursor()

                # Bulk PK discovery — one query gets all PKs in the database
                try:
                    cursor.execute(pk_sql)
                    pk_rows = [(r[0], r[1], r[2]) for r in cursor.fetchall()]
                    pk_map_local = parse_pk_rows(pk_rows)
                except Exception as exc:
                    _logger.warning("PK bulk query failed on %s/%s: %s", server, database, str(exc)[:80])
                    pk_map_local = {}

                # Bulk watermark discovery
                try:
                    cursor.execute(wm_sql)
                    wm_rows = [(r[0], r[1], r[2], r[3], r[4]) for r in cursor.fetchall()]
                    wm_map_local = parse_watermark_rows(wm_rows)
                except Exception as exc:
                    _logger.warning("Watermark bulk query failed on %s/%s: %s", server, database, str(exc)[:80])
                    wm_map_local = {}

                cursor.close()

                # Apply results to entities
                for entity in group:
                    schema = entity.source_schema or "dbo"
                    table = entity.source_name
                    key = (schema, table)

                    # PK
                    if not entity.primary_keys:
                        pk_cols = pk_map_local.get(key, [])
                        if pk_cols:
                            pk_str = format_primary_keys(pk_cols)
                            entity.primary_keys = pk_str
                            try:
                                cpdb_execute(
                                    "UPDATE bronze_entities SET PrimaryKeys = ? "
                                    "WHERE LandingzoneEntityId = ?",
                                    (pk_str, entity.id),
                                )
                            except Exception:
                                pass
                            stats["pk_discovered"] += 1

                    # Watermark
                    if not entity.watermark_column:
                        candidates = wm_map_local.get(key, [])
                        if candidates and candidates[0].qualifies_as_incremental:
                            best = candidates[0]
                            entity.watermark_column = best.column
                            entity.is_incremental = True
                            try:
                                cpdb_execute(
                                    "UPDATE lz_entities SET IsIncremental = 1, "
                                    "IsIncrementalColumn = ? "
                                    "WHERE LandingzoneEntityId = ?",
                                    (best.column, entity.id),
                                )
                            except Exception:
                                pass
                            stats["watermark_discovered"] += 1

        except Exception as exc:
            _logger.warning("Failed to connect to %s/%s for optimization: %s",
                            server, database, str(exc)[:100])
            stats["errors"] += 1
            stats["skipped"] += len(group)

    _logger.info("Auto-optimization done: %d PKs, %d watermarks discovered, %d skipped, %d errors",
                 stats["pk_discovered"], stats["watermark_discovered"],
                 stats["skipped"], stats["errors"])
    return stats


def optimize_entities(
    entities: List[dict],
    pk_map: Dict[Tuple[str, str], List[str]],
    wm_map: Dict[Tuple[str, str], List[WatermarkCandidate]],
) -> OptimizationSummary:
    """Batch-classify a list of entities using pre-parsed PK and watermark maps.

    Parameters
    ----------
    entities : list of dict
        Each dict must have: id, schema, table (the entity metadata).
    pk_map : dict
        From parse_pk_rows() — (schema, table) → [pk_columns].
    wm_map : dict
        From parse_watermark_rows() — (schema, table) → [WatermarkCandidate].

    Returns
    -------
    OptimizationSummary
        Aggregate results with per-entity detail.
    """
    summary = OptimizationSummary()

    for entity in entities:
        eid = entity["id"]
        schema = entity["schema"]
        table = entity["table"]
        key = (schema, table)

        pk_cols = pk_map.get(key, [])
        candidates = wm_map.get(key, [])

        # Convert WatermarkCandidate objects to dicts for classify_entity
        wm_dicts = [
            {"column": c.column, "type": c.data_type, "is_identity": c.is_identity}
            for c in candidates
        ] if candidates else None

        result = classify_entity(
            entity_id=eid,
            schema=schema,
            table=table,
            pk_columns=pk_cols if pk_cols else None,
            watermark_candidates=wm_dicts,
        )

        summary.results.append(result)
        summary.total_entities += 1
        if result.has_primary_keys:
            summary.entities_with_pks += 1
        if result.is_incremental:
            summary.entities_incremental += 1
        else:
            summary.entities_full_load += 1

    return summary
