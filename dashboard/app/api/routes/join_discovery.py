"""
FMD Join Discovery API Routes

Endpoints to query and explore cross-source join opportunities discovered
by the metadata analyzer.

Usage:
  GET /api/join-discovery/status — Check analysis status
  GET /api/join-discovery/candidates — Get all join candidates
  GET /api/join-discovery/cross-source — Get cross-source join paths
  GET /api/join-discovery/table/<source>/<table> — Get joins for a specific table
  GET /api/join-discovery/lineage/<source>/<table> — Get full data lineage
  POST /api/join-discovery/validate-join — Validate a join candidate
  POST /api/join-discovery/run-analysis — Trigger full analysis
"""

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional, List, Dict
from datetime import datetime

from engine.metadata_analyzer import MetadataAnalyzer, SOURCE_SYSTEMS
from engine.config import load_config

log = logging.getLogger("fmd.api.join_discovery")

ANALYSIS_DB_PATH = Path("./analysis/join_discovery.db")
METADATA_PATH = Path("./analysis/join_discovery_metadata.json")


def get_join_discovery_status(params: dict) -> dict:
    """Get status of join discovery analysis."""
    try:
        if ANALYSIS_DB_PATH.exists():
            stat = ANALYSIS_DB_PATH.stat()
            with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
                cursor = conn.cursor()

                # Get summary stats
                cursor.execute("SELECT COUNT(*) FROM join_candidates")
                total_candidates = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM join_candidates WHERE is_cross_source = 1")
                cross_source = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM tables")
                total_tables = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM columns")
                total_columns = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(DISTINCT join_type) FROM join_candidates")
                join_types = cursor.fetchone()[0]

                return {
                    "status": "ready",
                    "last_updated": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "statistics": {
                        "total_tables_analyzed": total_tables,
                        "total_columns_analyzed": total_columns,
                        "total_join_candidates": total_candidates,
                        "cross_source_candidates": cross_source,
                        "join_types": join_types
                    },
                    "analysis_artifacts": {
                        "database": str(ANALYSIS_DB_PATH),
                        "metadata_json": str(METADATA_PATH),
                        "html_report": str(Path("./analysis/join_discovery_analysis.html"))
                    }
                }
        else:
            return {
                "status": "not_analyzed",
                "message": "Run /api/join-discovery/run-analysis to generate join discovery data"
            }
    except Exception as e:
        log.error(f"Error getting status: {e}")
        return {"status": "error", "error": str(e)}


def get_join_candidates(params: dict) -> List[dict]:
    """Get all join candidates, optionally filtered."""
    try:
        join_type = params.get("join_type")
        min_confidence = float(params.get("min_confidence", 0.0))
        cross_source_only = params.get("cross_source_only", "false").lower() == "true"
        limit = int(params.get("limit", 100))

        with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            query = "SELECT * FROM join_candidates WHERE confidence_score >= ?"
            args = [min_confidence]

            if join_type:
                query += " AND join_type = ?"
                args.append(join_type)

            if cross_source_only:
                query += " AND is_cross_source = 1"

            query += " ORDER BY confidence_score DESC LIMIT ?"
            args.append(limit)

            cursor.execute(query, args)

            return [dict(row) for row in cursor.fetchall()]

    except Exception as e:
        log.error(f"Error getting candidates: {e}")
        return []


def get_cross_source_joins(params: dict) -> dict:
    """Get cross-source join opportunities grouped by system pairs."""
    try:
        with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute("""
            SELECT
                source_system,
                target_system,
                join_type,
                COUNT(*) as candidate_count,
                AVG(confidence_score) as avg_confidence,
                MAX(confidence_score) as max_confidence
            FROM join_candidates
            WHERE is_cross_source = 1
            GROUP BY source_system, target_system, join_type
            ORDER BY source_system, target_system, avg_confidence DESC
            """)

            result = {}
            for row in cursor.fetchall():
                key = f"{row['source_system']} ↔ {row['target_system']}"
                if key not in result:
                    result[key] = {
                        "source_system": row['source_system'],
                        "target_system": row['target_system'],
                        "by_type": {},
                        "total_candidates": 0
                    }

                result[key]["by_type"][row['join_type']] = {
                    "candidates": row['candidate_count'],
                    "avg_confidence": round(row['avg_confidence'], 2),
                    "max_confidence": round(row['max_confidence'], 2)
                }
                result[key]["total_candidates"] += row['candidate_count']

            return result

    except Exception as e:
        log.error(f"Error getting cross-source joins: {e}")
        return {}


def get_table_joins(params: dict) -> dict:
    """Get all join candidates for a specific table."""
    try:
        source = params.get("source")
        table = params.get("table")

        if not source or not table:
            return {"error": "source and table parameters required"}

        with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Get table metadata
            cursor.execute("""
            SELECT t.*, s.server, s.database, s.schema_name
            FROM tables t
            JOIN sources s ON t.source_id = s.source_id
            WHERE s.source_name = ? AND t.table_name = ?
            """, (source, table))

            table_row = cursor.fetchone()
            if not table_row:
                return {"error": f"Table {source}.{table} not found"}

            # Get columns
            cursor.execute("""
            SELECT * FROM columns
            WHERE table_id = ?
            ORDER BY column_ordinal
            """, (table_row['table_id'],))

            columns = [dict(row) for row in cursor.fetchall()]

            # Get join candidates (as source)
            cursor.execute("""
            SELECT * FROM join_candidates
            WHERE source_table LIKE ?
            ORDER BY confidence_score DESC
            """, (f"%.{table}",))

            outbound_joins = [dict(row) for row in cursor.fetchall()]

            # Get join candidates (as target)
            cursor.execute("""
            SELECT * FROM join_candidates
            WHERE target_table LIKE ?
            ORDER BY confidence_score DESC
            """, (f"%.{table}",))

            inbound_joins = [dict(row) for row in cursor.fetchall()]

            return {
                "source": source,
                "table": table,
                "metadata": {
                    "type": table_row['table_type'],
                    "row_count": table_row['row_count'],
                    "column_count": table_row['column_count'],
                    "server": table_row['server'],
                    "database": table_row['database'],
                    "schema": table_row['schema_name']
                },
                "columns": columns,
                "outbound_joins": {
                    "description": f"Joins from {table} to other tables",
                    "candidates": outbound_joins,
                    "count": len(outbound_joins)
                },
                "inbound_joins": {
                    "description": f"Joins into {table} from other tables",
                    "candidates": inbound_joins,
                    "count": len(inbound_joins)
                },
                "total_join_paths": len(outbound_joins) + len(inbound_joins)
            }

    except Exception as e:
        log.error(f"Error getting table joins: {e}")
        return {"error": str(e)}


def get_data_lineage(params: dict) -> dict:
    """Get complete data lineage/journey for a table through join paths."""
    try:
        source = params.get("source")
        table = params.get("table")
        max_depth = int(params.get("max_depth", 3))

        if not source or not table:
            return {"error": "source and table parameters required"}

        # BFS to find all paths
        visited = set()
        paths = []

        def explore_path(curr_table: str, curr_source: str, path: List[dict], depth: int):
            if depth > max_depth or (curr_source, curr_table) in visited:
                return

            visited.add((curr_source, curr_table))

            with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Find outbound joins
                cursor.execute("""
                SELECT * FROM join_candidates
                WHERE source_table LIKE ?
                ORDER BY confidence_score DESC
                LIMIT 10
                """, (f"%.{curr_table}",))

                for row in cursor.fetchall():
                    next_source = row['target_system']
                    next_table = row['target_table'].split('.')[-1]

                    new_path = path + [dict(row)]

                    if depth < max_depth:
                        explore_path(next_table, next_source, new_path, depth + 1)
                    else:
                        paths.append(new_path)

        explore_path(table, source, [], 0)

        # Build lineage tree
        return {
            "source": source,
            "table": table,
            "lineage_paths": paths[:20],  # Limit to top 20 paths
            "total_paths_discovered": len(paths),
            "max_depth": max_depth,
            "description": f"Data lineage showing all possible join paths from {source}.{table}"
        }

    except Exception as e:
        log.error(f"Error getting lineage: {e}")
        return {"error": str(e)}


def validate_join(params: dict) -> dict:
    """Validate a join candidate by running a test query on source systems."""
    try:
        source_table = params.get("source_table")  # "MES.dbo.CUSCONGB"
        target_table = params.get("target_table")  # "M3.dbo.CUSCON"
        source_column = params.get("source_column")
        target_column = params.get("target_column")

        if not all([source_table, target_table, source_column, target_column]):
            return {"error": "All join parameters required"}

        # Parse table specs
        src_parts = source_table.split(".")
        src_system = src_parts[0]
        src_table = src_parts[-1]

        tgt_parts = target_table.split(".")
        tgt_system = tgt_parts[0]
        tgt_table = tgt_parts[-1]

        if src_system not in SOURCE_SYSTEMS or tgt_system not in SOURCE_SYSTEMS:
            return {"error": "Invalid source systems"}

        # For cross-source joins, we can only validate within same source
        if src_system == tgt_system:
            # Can run a test join query
            from engine.connections import SourceConnection
            from engine.config import load_config

            config = load_config()
            conn_mgr = SourceConnection(config)
            src_info = SOURCE_SYSTEMS[src_system]

            try:
                with conn_mgr.connect(src_info["server"], src_info["database"]) as conn:
                    cursor = conn.cursor()

                    # Test if columns exist and have compatible data
                    cursor.execute(f"""
                    SELECT TOP 10
                        s.[{source_column}],
                        t.[{target_column}],
                        COUNT(*) as match_count
                    FROM [{src_info['schema']}].[{src_table}] s
                    LEFT JOIN [{src_info['schema']}].[{tgt_table}] t
                        ON s.[{source_column}] = t.[{target_column}]
                    GROUP BY s.[{source_column}], t.[{target_column}]
                    HAVING COUNT(*) > 0
                    ORDER BY COUNT(*) DESC
                    """)

                    sample_data = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]

                    return {
                        "status": "valid",
                        "join_path": f"{source_table} → {target_table}",
                        "test_query_result": {
                            "matches_found": len(sample_data),
                            "sample_data": sample_data
                        }
                    }
            except Exception as e:
                return {
                    "status": "error",
                    "error": f"Failed to validate join: {str(e)}"
                }
        else:
            # Cross-source — suggest mapping columns by examining metadata
            with sqlite3.connect(ANALYSIS_DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Get column data types
                cursor.execute("""
                SELECT c.column_name, c.data_type
                FROM columns c
                JOIN tables t ON c.table_id = t.table_id
                JOIN sources s ON t.source_id = s.source_id
                WHERE s.source_name = ? AND t.table_name = ? AND c.column_name = ?
                """, (src_system, src_table, source_column))

                src_col_info = cursor.fetchone()

                cursor.execute("""
                SELECT c.column_name, c.data_type
                FROM columns c
                JOIN tables t ON c.table_id = t.table_id
                JOIN sources s ON t.source_id = s.source_id
                WHERE s.source_name = ? AND t.table_name = ? AND c.column_name = ?
                """, (tgt_system, tgt_table, target_column))

                tgt_col_info = cursor.fetchone()

                if not src_col_info or not tgt_col_info:
                    return {"error": "Column not found"}

                return {
                    "status": "cross_source",
                    "join_path": f"{source_table} → {target_table}",
                    "note": "Cross-source join — actual validation requires ETL pipeline execution",
                    "column_compatibility": {
                        "source_column": {
                            "name": src_col_info['column_name'],
                            "data_type": src_col_info['data_type']
                        },
                        "target_column": {
                            "name": tgt_col_info['column_name'],
                            "data_type": tgt_col_info['data_type']
                        },
                        "types_compatible": src_col_info['data_type'].lower() in tgt_col_info['data_type'].lower() or
                                           tgt_col_info['data_type'].lower() in src_col_info['data_type'].lower()
                    }
                }

    except Exception as e:
        log.error(f"Error validating join: {e}")
        return {"error": str(e)}


def run_analysis(params: dict) -> dict:
    """Trigger a new full analysis run."""
    try:
        log.info("🚀 Starting join discovery analysis...")

        config = load_config()
        analyzer = MetadataAnalyzer(config)
        result = analyzer.analyze_all_sources()

        log.info(f"✅ Analysis complete: {result}")

        return {
            "status": "success",
            "message": "Join discovery analysis completed",
            "result": result
        }

    except Exception as e:
        log.error(f"Error running analysis: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


# Router mapping
ROUTES = {
    "GET": {
        "/api/join-discovery/status": get_join_discovery_status,
        "/api/join-discovery/candidates": get_join_candidates,
        "/api/join-discovery/cross-source": get_cross_source_joins,
        "/api/join-discovery/table": get_table_joins,
        "/api/join-discovery/lineage": get_data_lineage,
    },
    "POST": {
        "/api/join-discovery/validate": validate_join,
        "/api/join-discovery/run-analysis": run_analysis,
    }
}
