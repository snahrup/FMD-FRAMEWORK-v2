"""
FMD v3 Engine — Comprehensive Cross-Source Join Discovery & Analysis

Analyzes all source databases to:
1. Extract table/column metadata
2. Discover within-source foreign key relationships
3. Identify cross-source join candidates
4. Generate a queryable join discovery database
5. Support granular table-level analysis with roll-up capability

Run standalone: python -m engine.metadata_analyzer --full-scan --output-report
"""

import json
import logging
import sqlite3
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple, Set
from collections import defaultdict
import re

import pyodbc

from engine.connections import SourceConnection
from engine.config import load_config
from engine.models import EngineConfig

log = logging.getLogger("fmd.metadata_analyzer")

# Regex for validating SQL identifiers (alphanumeric, underscore, dot, brackets, spaces)
_SAFE_SQL_IDENT = re.compile(r'^[\w\.\[\] ]+$')


# ===========================================================================
# Data Models for Metadata Analysis
# ===========================================================================

@dataclass
class ColumnMetadata:
    """Column information from source table."""
    table_name: str
    column_name: str
    data_type: str
    is_nullable: bool
    column_id: int  # SQL Server ordinal position
    character_max_length: Optional[int] = None
    numeric_precision: Optional[int] = None
    numeric_scale: Optional[int] = None
    is_primary_key: bool = False
    is_foreign_key: bool = False
    is_identity: bool = False

    def serialize(self) -> dict:
        return asdict(self)


@dataclass
class TableMetadata:
    """Table/view information from source database."""
    database_name: str
    source_system: str  # e.g., "MES", "M3 ERP"
    schema_name: str
    table_name: str
    table_type: str  # TABLE, VIEW
    row_count: Optional[int] = None
    columns: List[ColumnMetadata] = field(default_factory=list)
    primary_keys: List[str] = field(default_factory=list)
    foreign_keys: Dict[str, Tuple[str, str]] = field(default_factory=dict)  # {fk_col: (ref_table, ref_col)}

    def serialize(self) -> dict:
        data = asdict(self)
        data['columns'] = [c.serialize() for c in self.columns]
        return data


@dataclass
class JoinCandidate:
    """A potential join between two tables (same or different sources)."""
    source_table: str  # "MES.dbo.CUSCONGB"
    target_table: str  # "M3.dbo.CITCON"
    source_column: str
    target_column: str
    join_type: str  # "FK_CONSTRAINT", "NAME_MATCH", "DATA_PATTERN", "BUSINESS_DOMAIN"
    confidence_score: float  # 0.0-1.0
    reason: str  # Why this join was suggested
    is_cross_source: bool
    source_system_src: str
    source_system_tgt: str

    def serialize(self) -> dict:
        return asdict(self)


@dataclass
class CrossSourceJoinPath:
    """A complete path for joining tables across multiple sources."""
    path_id: str
    steps: List[JoinCandidate]  # Sequential joins
    description: str
    total_confidence: float
    enables_analysis: List[str]  # e.g., ["Customer Financial Analysis", "Order Fulfillment Tracking"]


# ===========================================================================
# Source Connection Definitions
# ===========================================================================

SOURCE_SYSTEMS = {
    "MES": {
        "server": "m3-db1",
        "database": "mes",
        "schema": "dbo",
        "description": "Manufacturing Execution System - 586 tables, ~445 entities loaded"
    },
    "ETQ": {
        "server": "M3-DB3",
        "database": "ETQStagingPRD",
        "schema": "dbo",
        "description": "Environmental, Health & Safety - 29 tables, ~29 entities loaded"
    },
    "M3 ERP": {
        "server": "sqllogshipprd",
        "database": "m3fdbprd",
        "schema": "dbo",
        "description": "M3 ERP Production - 3,973 tables, ~596 entities loaded"
    },
    "M3 Cloud": {
        "server": "sql2016live",
        "database": "DI_PRD_Staging",
        "schema": "dbo",
        "description": "M3 Cloud Staging - 188 tables, ~187 entities loaded"
    }
}

# Common join patterns — column name patterns that typically indicate joins
JOIN_PATTERNS = {
    # Customer/Account related
    "cust": ["CUSCONGB", "CUSCON", "OE_CUSTOMER", "CUSTOMER"],
    "acct": ["ACCOUNT", "ACCOUNTING", "ACCT"],
    "vendor": ["VENDOR", "SUPPVENDM"],
    "supplier": ["SUPPLIER", "SUPPVENDM"],

    # Order/Transaction related
    "order": ["ORDERS", "ORDHEAD", "ORDLINE", "SALESORDER", "ORDHDR"],
    "line": ["LINE", "ORDERLINE", "DETAIL"],
    "invoice": ["INVOICE", "EINVOICE"],
    "shipment": ["SHIPMENT", "SHIP"],
    "receipt": ["RECEIPT", "PRRECPT"],

    # Product/Item related
    "item": ["ITEM", "PRODUCT", "ITEMZONE", "ITEMNHST"],
    "sku": ["SKU", "MATERIAL"],
    "inventory": ["INVENTORY", "INVLOC", "INVSTOCK"],

    # Location related
    "location": ["LOCATION", "LOC", "WAREHOUSE", "FACILITY"],
    "site": ["SITE", "PLANT", "WHSLOC"],
    "address": ["ADDRESS", "ADDR"],

    # Time/Period related
    "period": ["PERIOD", "FISCAL_PERIOD"],
    "date": ["DATE", "DATEKEY"],
}

# ID pattern matching — common ID column suffixes
ID_PATTERNS = [
    r"^(.+?)(?:_ID|ID)$",  # CUSTOMER_ID, PRODUCTID
    r"^ID(.+)$",           # IDCUST (reverse)
    r"^(.+?)(?:_NO|NO|_NUM|NUM)$",  # CUSTOMER_NO, ITEM_NUM
]

# Common cross-source mappings (known business relationships)
KNOWN_CROSS_SOURCE_JOINS = {
    ("MES", "M3 ERP"): [
        ("CUSCONGB", "OCUSCON", "CUSCON", "OCUSNO"),  # Customer
        ("ORDHEAD", "OORDHEAD", "ORDNUM", "ORDNUM"),  # Order
        ("ORDLINE", "OORDLINE", "ORDNUM", "ORDNUM"),  # Order Line
    ],
    ("M3 ERP", "M3 Cloud"): [
        ("OCUSCON", "Customer", "OCUSNO", "CustomerNumber"),
        ("OORDHEAD", "SalesOrder", "ORDNUM", "OrderNumber"),
    ],
    ("MES", "ETQ"): [
        # ETQ typically maps to MES equipment/operations
        ("CUSCONGB", "CUSTOMER", "CUSCON", "CUSTOMER_ID"),
    ]
}


# ===========================================================================
# Metadata Analyzer Class
# ===========================================================================

class MetadataAnalyzer:
    """Comprehensive metadata analysis across all source systems."""

    def __init__(self, config: EngineConfig, output_dir: Path = None):
        self.config = config
        self.conn_manager = SourceConnection(config)
        self.output_dir = output_dir or Path("./analysis")
        self.output_dir.mkdir(exist_ok=True)

        self.all_tables: Dict[str, TableMetadata] = {}  # {source_system: {table_name: metadata}}
        self.join_candidates: List[JoinCandidate] = []
        self.cross_source_paths: List[CrossSourceJoinPath] = []

    def analyze_all_sources(self) -> dict:
        """Orchestrate full analysis of all sources."""
        log.info("Starting comprehensive cross-source join analysis...")

        analysis_result = {
            "timestamp": datetime.utcnow().isoformat(),
            "sources_analyzed": [],
            "total_tables": 0,
            "total_columns": 0,
            "within_source_joins": 0,
            "cross_source_candidates": 0,
            "analysis_artifacts": []
        }

        # 1. Analyze each source system
        for source_name, conn_info in SOURCE_SYSTEMS.items():
            log.info(f"Analyzing source: {source_name}")
            try:
                tables = self._analyze_source(source_name, conn_info)
                if tables:
                    analysis_result["sources_analyzed"].append(source_name)
                    analysis_result["total_tables"] += len(tables)
            except Exception as e:
                log.error(f"Failed to analyze {source_name}: {e}")

        # 2. Discover within-source foreign key relationships
        log.info("Discovering within-source relationships...")
        self._discover_within_source_joins()
        analysis_result["within_source_joins"] = sum(
            len(t.foreign_keys) for tables_dict in self.all_tables.values()
            for t in tables_dict.values() if isinstance(tables_dict, dict)
        )

        # 3. Discover cross-source join candidates
        log.info("Discovering cross-source join candidates...")
        self._discover_cross_source_joins()
        analysis_result["cross_source_candidates"] = len(self.join_candidates)

        # 4. Generate reports and artifacts
        log.info("Generating analysis reports...")
        artifacts = self._generate_reports()
        analysis_result["analysis_artifacts"] = artifacts

        log.info("Analysis complete")
        return analysis_result

    def _analyze_source(self, source_name: str, conn_info: dict) -> Dict[str, TableMetadata]:
        """Analyze a single source system."""
        server = conn_info["server"]
        database = conn_info["database"]
        schema = conn_info["schema"]

        tables = {}

        try:
            with self.conn_manager.connect(server, database) as conn:
                cursor = conn.cursor()

                # Get all tables/views in the schema
                cursor.execute("""
                    SELECT TABLE_NAME, TABLE_TYPE
                    FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_SCHEMA = ?
                    ORDER BY TABLE_NAME
                """, schema)

                table_list = cursor.fetchall()
                log.info(f"  Found {len(table_list)} tables/views in {source_name}")

                for table_name, table_type in table_list:
                    try:
                        table_meta = self._extract_table_metadata(
                            cursor, source_name, database, schema, table_name, table_type
                        )
                        tables[table_name] = table_meta
                    except Exception as e:
                        log.warning(f"  Skipped {table_name}: {e}")
                        continue

                # Store in master dict
                self.all_tables[source_name] = tables
                return tables

        except Exception as e:
            log.error(f"Connection failed for {source_name} ({server}/{database}): {e}")
            return {}

    def _extract_table_metadata(
        self, cursor, source_name: str, database: str, schema: str,
        table_name: str, table_type: str
    ) -> TableMetadata:
        """Extract full metadata for a single table."""

        # Get columns
        cursor.execute("""
            SELECT
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                ORDINAL_POSITION,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
        """, schema, table_name)

        columns = []
        for col_name, data_type, is_nullable, col_id, char_max, num_prec, num_scale in cursor.fetchall():
            col_meta = ColumnMetadata(
                table_name=table_name,
                column_name=col_name,
                data_type=data_type,
                is_nullable=is_nullable == "YES",
                column_id=col_id,
                character_max_length=char_max,
                numeric_precision=num_prec,
                numeric_scale=num_scale
            )
            columns.append(col_meta)

        # Get primary key columns
        primary_keys = []
        try:
            cursor.execute("""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME LIKE 'PK%'
            """, schema, table_name)
            primary_keys = [row[0] for row in cursor.fetchall()]
        except Exception as e:
            log.debug("Failed to query primary keys for %s.%s: %s", schema, table_name, e)

        # Get foreign key relationships
        foreign_keys = {}
        try:
            cursor.execute("""
                SELECT
                    RC.CONSTRAINT_NAME,
                    KCU1.COLUMN_NAME,
                    KCU2.TABLE_NAME,
                    KCU2.COLUMN_NAME
                FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS RC
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KCU1
                    ON RC.CONSTRAINT_NAME = KCU1.CONSTRAINT_NAME
                    AND KCU1.TABLE_SCHEMA = ?
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS KCU2
                    ON RC.UNIQUE_CONSTRAINT_NAME = KCU2.CONSTRAINT_NAME
                WHERE KCU1.TABLE_NAME = ?
            """, schema, table_name)

            for constraint_name, fk_col, ref_table, ref_col in cursor.fetchall():
                foreign_keys[fk_col] = (ref_table, ref_col)
        except Exception as e:
            log.debug("Failed to query foreign keys for %s.%s: %s", schema, table_name, e)

        # Mark columns as PK/FK
        for col in columns:
            if col.column_name in primary_keys:
                col.is_primary_key = True
            if col.column_name in foreign_keys:
                col.is_foreign_key = True

        # Get row count (approximate)
        row_count = None
        if table_type == "TABLE":
            try:
                if not _SAFE_SQL_IDENT.match(schema) or not _SAFE_SQL_IDENT.match(table_name):
                    raise ValueError(f"Unsafe identifier: {schema}.{table_name}")
                # Table/schema are identifiers — cannot use ? params; sanitize brackets
                safe_schema = schema.replace("]", "]]")
                safe_table = table_name.replace("]", "]]")
                cursor.execute("SELECT COUNT(*) FROM [" + safe_schema + "].[" + safe_table + "]")
                row_count = cursor.fetchone()[0]
            except Exception as e:
                log.debug("Failed to get row count for %s.%s: %s", schema, table_name, e)

        return TableMetadata(
            database_name=database,
            source_system=source_name,
            schema_name=schema,
            table_name=table_name,
            table_type=table_type,
            row_count=row_count,
            columns=columns,
            primary_keys=primary_keys,
            foreign_keys=foreign_keys
        )

    def _discover_within_source_joins(self):
        """Discover foreign key relationships within each source."""
        for source_name, tables_dict in self.all_tables.items():
            log.info(f"  {source_name}: Analyzing {len(tables_dict)} tables for FKs...")

            for table_name, table_meta in tables_dict.items():
                for fk_col, (ref_table, ref_col) in table_meta.foreign_keys.items():
                    candidate = JoinCandidate(
                        source_table=f"{source_name}.dbo.{table_name}",
                        target_table=f"{source_name}.dbo.{ref_table}",
                        source_column=fk_col,
                        target_column=ref_col,
                        join_type="FK_CONSTRAINT",
                        confidence_score=1.0,
                        reason="SQL foreign key constraint",
                        is_cross_source=False,
                        source_system_src=source_name,
                        source_system_tgt=source_name
                    )
                    self.join_candidates.append(candidate)

    def _discover_cross_source_joins(self):
        """Discover potential join candidates across different sources."""

        # Start with known mappings
        for (src_system, tgt_system), mappings in KNOWN_CROSS_SOURCE_JOINS.items():
            for src_table, tgt_table, src_col, tgt_col in mappings:
                if (src_system in self.all_tables and
                    src_table in self.all_tables[src_system] and
                    tgt_system in self.all_tables and
                    tgt_table in self.all_tables[tgt_system]):

                    candidate = JoinCandidate(
                        source_table=f"{src_system}.dbo.{src_table}",
                        target_table=f"{tgt_system}.dbo.{tgt_table}",
                        source_column=src_col,
                        target_column=tgt_col,
                        join_type="BUSINESS_DOMAIN",
                        confidence_score=0.95,
                        reason="Known cross-system business mapping",
                        is_cross_source=True,
                        source_system_src=src_system,
                        source_system_tgt=tgt_system
                    )
                    self.join_candidates.append(candidate)

        # Discover ID column matches across sources
        self._discover_id_based_joins()

        # Discover semantic/business domain matches
        self._discover_semantic_joins()

    def _discover_id_based_joins(self):
        """Find potential joins based on matching ID column names and data types."""

        # Build index of all ID columns by base name and type
        id_index = defaultdict(list)  # {base_name: [(source, table, col, data_type), ...]}

        for source_name, tables_dict in self.all_tables.items():
            for table_name, table_meta in tables_dict.items():
                for col in table_meta.columns:
                    for pattern in ID_PATTERNS:
                        match = re.match(pattern, col.column_name, re.IGNORECASE)
                        if match:
                            base_name = match.group(1).upper()
                            id_index[base_name].append({
                                "source": source_name,
                                "table": table_name,
                                "column": col.column_name,
                                "data_type": col.data_type,
                                "is_pk": col.is_primary_key
                            })
                            break

        # Find matching IDs across sources
        for base_name, occurrences in id_index.items():
            if len(occurrences) > 1:
                # Group by data type
                by_type = defaultdict(list)
                for occ in occurrences:
                    by_type[occ["data_type"]].append(occ)

                # Find cross-source matches
                for data_type, matches in by_type.items():
                    cross_source = defaultdict(list)
                    for match in matches:
                        cross_source[match["source"]].append(match)

                    if len(cross_source) > 1:
                        # Candidate join
                        sources = list(cross_source.keys())
                        for src_sys in sources:
                            for tgt_sys in sources:
                                if src_sys < tgt_sys:  # Avoid duplicates
                                    for src_item in cross_source[src_sys]:
                                        for tgt_item in cross_source[tgt_sys]:
                                            confidence = 0.7  # ID match confidence
                                            if src_item["is_pk"] and tgt_item["is_pk"]:
                                                confidence = 0.85

                                            candidate = JoinCandidate(
                                                source_table=f"{src_sys}.dbo.{src_item['table']}",
                                                target_table=f"{tgt_sys}.dbo.{tgt_item['table']}",
                                                source_column=src_item["column"],
                                                target_column=tgt_item["column"],
                                                join_type="NAME_MATCH",
                                                confidence_score=confidence,
                                                reason=f"Matching ID pattern: {base_name} ({data_type})",
                                                is_cross_source=True,
                                                source_system_src=src_sys,
                                                source_system_tgt=tgt_sys
                                            )
                                            # Deduplicate
                                            if not self._candidate_exists(candidate):
                                                self.join_candidates.append(candidate)

    def _discover_semantic_joins(self):
        """Find potential joins based on semantic/business domain patterns."""

        # This is heuristic-based — look for tables with common naming patterns
        # that might represent the same business entity across systems

        semantic_groups = defaultdict(lambda: defaultdict(list))

        for source_name, tables_dict in self.all_tables.items():
            for table_name, table_meta in tables_dict.items():
                # Match against known patterns
                for domain, table_patterns in JOIN_PATTERNS.items():
                    for pattern in table_patterns:
                        if pattern.upper() in table_name.upper():
                            semantic_groups[domain][source_name].append({
                                "source": source_name,
                                "table": table_name,
                                "table_meta": table_meta
                            })

        # Find cross-source matches within same domain
        for domain, sources_dict in semantic_groups.items():
            if len(sources_dict) > 1:
                sources = list(sources_dict.keys())
                for src_idx, src_sys in enumerate(sources):
                    for tgt_sys in sources[src_idx + 1:]:
                        for src_item in sources_dict[src_sys]:
                            for tgt_item in sources_dict[tgt_sys]:
                                # Try to find matching ID columns
                                src_ids = [c for c in src_item["table_meta"].columns if c.is_primary_key or "ID" in c.column_name.upper()]
                                tgt_ids = [c for c in tgt_item["table_meta"].columns if c.is_primary_key or "ID" in c.column_name.upper()]

                                if src_ids and tgt_ids:
                                    candidate = JoinCandidate(
                                        source_table=f"{src_sys}.dbo.{src_item['table']}",
                                        target_table=f"{tgt_sys}.dbo.{tgt_item['table']}",
                                        source_column=src_ids[0].column_name,
                                        target_column=tgt_ids[0].column_name,
                                        join_type="DATA_PATTERN",
                                        confidence_score=0.6,
                                        reason=f"Semantic domain match: {domain}",
                                        is_cross_source=True,
                                        source_system_src=src_sys,
                                        source_system_tgt=tgt_sys
                                    )
                                    if not self._candidate_exists(candidate):
                                        self.join_candidates.append(candidate)

    def _candidate_exists(self, candidate: JoinCandidate) -> bool:
        """Check if a join candidate already exists."""
        return any(
            c.source_table == candidate.source_table and
            c.target_table == candidate.target_table and
            c.source_column == candidate.source_column and
            c.target_column == candidate.target_column
            for c in self.join_candidates
        )

    def _generate_reports(self) -> List[str]:
        """Generate analysis reports in multiple formats."""
        artifacts = []

        # 1. JSON Report — Raw data for API consumption
        json_report = {
            "metadata": {
                "generated_at": datetime.utcnow().isoformat(),
                "total_tables": sum(len(t) for t in self.all_tables.values()),
                "total_columns": sum(
                    sum(len(tbl.columns) for tbl in tables_dict.values())
                    for tables_dict in self.all_tables.values()
                ),
                "join_candidates": len(self.join_candidates)
            },
            "sources": {},
            "join_candidates": [c.serialize() for c in self.join_candidates],
            "cross_source_summary": self._build_cross_source_summary()
        }

        # Organize tables by source
        for source_name, tables_dict in self.all_tables.items():
            json_report["sources"][source_name] = {
                "table_count": len(tables_dict),
                "tables": {
                    t.table_name: t.serialize()
                    for t in tables_dict.values()
                }
            }

        json_path = self.output_dir / "join_discovery_metadata.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(json_report, f, indent=2, default=str)
        artifacts.append(str(json_path))
        log.info(f"JSON Report: {json_path}")

        # 2. HTML Report — Visual overview
        html_report = self._generate_html_report()
        html_path = self.output_dir / "join_discovery_analysis.html"
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_report)
        artifacts.append(str(html_path))
        log.info(f"HTML Report: {html_path}")

        # 3. SQLite Database — Queryable join discovery DB
        db_path = self.output_dir / "join_discovery.db"
        self._generate_sqlite_database(db_path)
        artifacts.append(str(db_path))
        log.info(f"SQLite DB: {db_path}")

        return artifacts

    def _build_cross_source_summary(self) -> dict:
        """Build a summary of cross-source join opportunities."""
        summary = {}

        for candidate in self.join_candidates:
            if candidate.is_cross_source:
                key = f"{candidate.source_system_src} ↔ {candidate.source_system_tgt}"
                if key not in summary:
                    summary[key] = {
                        "candidates": [],
                        "domains": set()
                    }
                summary[key]["candidates"].append({
                    "source_table": candidate.source_table,
                    "target_table": candidate.target_table,
                    "join_type": candidate.join_type,
                    "confidence": candidate.confidence_score
                })

        return {k: {"candidates": v["candidates"], "count": len(v["candidates"])} for k, v in summary.items()}

    def _generate_html_report(self) -> str:
        """Generate a visual HTML report of join discovery."""

        by_type = defaultdict(list)
        for c in self.join_candidates:
            by_type[c.join_type].append(c)

        html = f"""<!DOCTYPE html>
<html>
<head>
    <title>FMD Join Discovery Analysis</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #f5f5f5; }}
        .container {{ max-width: 1400px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
        h1 {{ color: #222; border-bottom: 3px solid #e84c3d; padding-bottom: 1rem; }}
        h2 {{ color: #333; margin-top: 2rem; }}
        h3 {{ color: #555; margin-top: 1.5rem; }}
        .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }}
        .stat {{ background: #f9f9f9; padding: 1rem; border-radius: 4px; border-left: 4px solid #e84c3d; }}
        .stat-value {{ font-size: 2em; font-weight: bold; color: #e84c3d; }}
        .stat-label {{ font-size: 0.9em; color: #666; }}
        table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
        th, td {{ padding: 0.75rem; text-align: left; border-bottom: 1px solid #ddd; }}
        th {{ background: #f0f0f0; font-weight: 600; }}
        tr:hover {{ background: #f9f9f9; }}
        .badge {{ display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85em; font-weight: 500; margin: 0.25rem; }}
        .badge-fk {{ background: #e8f4f8; color: #006b9f; }}
        .badge-match {{ background: #f0e8f8; color: #5b2c6f; }}
        .badge-domain {{ background: #e8f8e8; color: #2d5a2d; }}
        .badge-pattern {{ background: #f8f0e8; color: #5a4a2d; }}
        .confidence {{ display: inline-block; width: 100px; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; }}
        .confidence-bar {{ height: 100%; background: #4caf50; }}
        .high-conf {{ background: #4caf50; }}
        .med-conf {{ background: #ff9800; }}
        .low-conf {{ background: #f44336; }}
        .cross-source {{ background: #fff3e0; padding: 1rem; border-radius: 4px; margin: 1rem 0; border-left: 4px solid #ff9800; }}
        .source-system {{ display: inline-block; padding: 0.5rem 1rem; background: #eceff1; border-radius: 4px; margin: 0.25rem; font-weight: 500; font-size: 0.9em; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 FMD Cross-Source Join Discovery Analysis</h1>
        <p>Generated: {datetime.utcnow().isoformat()}</p>

        <div class="summary">
            <div class="stat">
                <div class="stat-value">{sum(len(t) for t in self.all_tables.values())}</div>
                <div class="stat-label">Total Tables Analyzed</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len([x for x in self.all_tables.keys()])}</div>
                <div class="stat-label">Source Systems</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len(self.join_candidates)}</div>
                <div class="stat-label">Join Candidates</div>
            </div>
            <div class="stat">
                <div class="stat-value">{len([c for c in self.join_candidates if c.is_cross_source])}</div>
                <div class="stat-label">Cross-Source Candidates</div>
            </div>
        </div>

        <h2>📊 Join Candidates by Type</h2>
"""

        for join_type in ["FK_CONSTRAINT", "BUSINESS_DOMAIN", "NAME_MATCH", "DATA_PATTERN"]:
            candidates = by_type.get(join_type, [])
            if not candidates:
                continue

            badge_class = {
                "FK_CONSTRAINT": "badge-fk",
                "BUSINESS_DOMAIN": "badge-domain",
                "NAME_MATCH": "badge-match",
                "DATA_PATTERN": "badge-pattern"
            }.get(join_type, "")

            html += f"""
        <h3><span class="badge {badge_class}">{join_type}</span> ({len(candidates)} candidates)</h3>
        <table>
            <tr>
                <th>Source Table</th>
                <th>Target Table</th>
                <th>Join Columns</th>
                <th>Confidence</th>
                <th>Reason</th>
            </tr>
"""

            for candidate in sorted(candidates, key=lambda x: x.confidence_score, reverse=True)[:50]:
                conf_pct = int(candidate.confidence_score * 100)
                conf_class = "high-conf" if candidate.confidence_score >= 0.8 else "med-conf" if candidate.confidence_score >= 0.6 else "low-conf"

                html += f"""
            <tr>
                <td>{candidate.source_table}</td>
                <td>{candidate.target_table}</td>
                <td><code>{candidate.source_column}</code> → <code>{candidate.target_column}</code></td>
                <td><span class="confidence"><span class="confidence-bar {conf_class}" style="width: {conf_pct}%"></span></span> {conf_pct}%</td>
                <td>{candidate.reason}</td>
            </tr>
"""

            html += """
        </table>
"""

        # Cross-source summary
        html += """
        <h2>🌍 Cross-Source Join Opportunities</h2>
"""

        cross_source_map = defaultdict(list)
        for candidate in self.join_candidates:
            if candidate.is_cross_source:
                key = (candidate.source_system_src, candidate.source_system_tgt)
                cross_source_map[key].append(candidate)

        for (src, tgt), candidates in sorted(cross_source_map.items()):
            html += f"""
        <div class="cross-source">
            <h3><span class="source-system">{src}</span> ↔ <span class="source-system">{tgt}</span></h3>
            <p><strong>{len(candidates)} join paths identified</strong></p>
            <ul>
"""
            for c in sorted(candidates, key=lambda x: x.confidence_score, reverse=True)[:10]:
                html += f"""
                <li>
                    <code>{c.source_table.split(".")[-1]} → {c.target_table.split(".")[-1]}</code>
                    ({c.source_column} = {c.target_column})
                    <span class="badge badge-{c.join_type.lower()}">{int(c.confidence_score*100)}%</span>
                </li>
"""
            html += """
            </ul>
        </div>
"""

        html += """
    </div>
</body>
</html>
"""

        return html

    def _generate_sqlite_database(self, db_path: Path):
        """Generate a queryable SQLite database of join discovery results."""

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create schema
        cursor.executescript("""
        CREATE TABLE IF NOT EXISTS sources (
            source_id INTEGER PRIMARY KEY,
            source_name TEXT UNIQUE,
            server TEXT,
            database TEXT,
            schema_name TEXT,
            table_count INTEGER,
            column_count INTEGER
        );

        CREATE TABLE IF NOT EXISTS tables (
            table_id INTEGER PRIMARY KEY,
            source_id INTEGER,
            table_name TEXT,
            table_type TEXT,
            row_count INTEGER,
            column_count INTEGER,
            FOREIGN KEY(source_id) REFERENCES sources(source_id)
        );

        CREATE TABLE IF NOT EXISTS columns (
            column_id INTEGER PRIMARY KEY,
            table_id INTEGER,
            column_name TEXT,
            data_type TEXT,
            is_nullable BOOLEAN,
            is_primary_key BOOLEAN,
            is_foreign_key BOOLEAN,
            column_ordinal INTEGER,
            FOREIGN KEY(table_id) REFERENCES tables(table_id)
        );

        CREATE TABLE IF NOT EXISTS join_candidates (
            candidate_id INTEGER PRIMARY KEY,
            source_table TEXT,
            target_table TEXT,
            source_column TEXT,
            target_column TEXT,
            join_type TEXT,
            confidence_score REAL,
            reason TEXT,
            is_cross_source BOOLEAN,
            source_system TEXT,
            target_system TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_join_candidates_source ON join_candidates(source_table);
        CREATE INDEX IF NOT EXISTS idx_join_candidates_target ON join_candidates(target_table);
        CREATE INDEX IF NOT EXISTS idx_join_candidates_cross ON join_candidates(is_cross_source, confidence_score DESC);
        CREATE INDEX IF NOT EXISTS idx_join_candidates_type ON join_candidates(join_type);
        """)

        # Populate sources
        for source_name, conn_info in SOURCE_SYSTEMS.items():
            if source_name in self.all_tables:
                tables_dict = self.all_tables[source_name]
                column_count = sum(len(t.columns) for t in tables_dict.values())

                cursor.execute("""
                INSERT INTO sources (source_name, server, database, schema_name, table_count, column_count)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    source_name,
                    conn_info["server"],
                    conn_info["database"],
                    conn_info["schema"],
                    len(tables_dict),
                    column_count
                ))

        # Populate tables and columns
        for source_name, tables_dict in self.all_tables.items():
            cursor.execute("SELECT source_id FROM sources WHERE source_name = ?", (source_name,))
            source_id = cursor.fetchone()[0]

            for table_name, table_meta in tables_dict.items():
                cursor.execute("""
                INSERT INTO tables (source_id, table_name, table_type, row_count, column_count)
                VALUES (?, ?, ?, ?, ?)
                """, (
                    source_id,
                    table_name,
                    table_meta.table_type,
                    table_meta.row_count,
                    len(table_meta.columns)
                ))

                table_id = cursor.lastrowid

                for col in table_meta.columns:
                    cursor.execute("""
                    INSERT INTO columns (table_id, column_name, data_type, is_nullable, is_primary_key, is_foreign_key, column_ordinal)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        table_id,
                        col.column_name,
                        col.data_type,
                        col.is_nullable,
                        col.is_primary_key,
                        col.is_foreign_key,
                        col.column_id
                    ))

        # Populate join candidates
        for candidate in self.join_candidates:
            cursor.execute("""
            INSERT INTO join_candidates
            (source_table, target_table, source_column, target_column, join_type, confidence_score, reason, is_cross_source, source_system, target_system)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                candidate.source_table,
                candidate.target_table,
                candidate.source_column,
                candidate.target_column,
                candidate.join_type,
                candidate.confidence_score,
                candidate.reason,
                candidate.is_cross_source,
                candidate.source_system_src,
                candidate.source_system_tgt
            ))

        conn.commit()
        conn.close()

        log.info(f"SQLite database created: {db_path}")


# ===========================================================================
# CLI Interface
# ===========================================================================

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(name)s | %(levelname)s | %(message)s"
    )

    config = load_config()
    analyzer = MetadataAnalyzer(config)

    # Run analysis
    result = analyzer.analyze_all_sources()

    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)
    print(f"Sources Analyzed: {', '.join(result['sources_analyzed'])}")
    print(f"Total Tables: {result['total_tables']}")
    print(f"Within-Source Joins (FKs): {result['within_source_joins']}")
    print(f"Cross-Source Candidates: {result['cross_source_candidates']}")
    print(f"\nArtifacts Generated:")
    for artifact in result['analysis_artifacts']:
        print(f"  {artifact}")
    print("="*80 + "\n")
