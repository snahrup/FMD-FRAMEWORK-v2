"""
Fast Extract — SQL Server → Local Parquet as fast as possible.

No OneLake, no dashboard, no audit logging. Just raw speed.
ConnectorX (Rust) + ThreadPoolExecutor + Snappy Parquet.

Usage:
    python scripts/fast_extract.py                         # all active entities
    python scripts/fast_extract.py --source MES            # one source
    python scripts/fast_extract.py --source MES --workers 16
    python scripts/fast_extract.py --limit 50              # first 50 entities
    python scripts/fast_extract.py --output ./parquet_out  # custom output dir
"""

import argparse
import io
import os
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ConnectorX for Rust-speed SQL reads
try:
    import connectorx as cx
    HAS_CX = True
except ImportError:
    HAS_CX = False

import polars as pl

# ── Config ──────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"

# Binary column types to skip
BINARY_TYPES = frozenset({
    "timestamp", "rowversion", "binary", "varbinary", "image",
    "geometry", "geography", "xml", "hierarchyid", "sql_variant",
})

# Source servers (short hostname → port)
SOURCE_SERVERS = {
    "m3-db1": 1433,
    "M3-DB3": 1433,
    "sqllogshipprd": 1433,
    "sql2016live": 1433,
}


def get_entities(source: str | None = None, limit: int | None = None) -> list[dict]:
    """Read active entities from the control plane SQLite DB."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row

    sql = """
        SELECT le.LandingzoneEntityId AS id,
               le.SourceName AS source_name,
               le.SourceSchema AS source_schema,
               le.FilePath AS namespace,
               c.ServerName AS server,
               c.DatabaseName AS database,
               ds.Name AS ds_name
        FROM lz_entities le
        JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
        JOIN connections c ON ds.ConnectionId = c.ConnectionId
        WHERE le.IsActive = 1
          AND c.ServerName != 'FabricSql'
          AND c.ServerName != ''
    """
    params = []
    if source:
        sql += " AND ds.Name = ?"
        params.append(source)
    sql += " ORDER BY ds.Name, le.SourceName"
    if limit:
        sql += f" LIMIT {limit}"

    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def cx_uri(server: str, database: str) -> str:
    """Build ConnectorX mssql:// URI with Windows Auth."""
    port = SOURCE_SERVERS.get(server, 1433)
    return f"mssql://{server}:{port}/{database}?trusted_connection=true&TrustServerCertificate=true"


def extract_one(entity: dict, output_dir: Path) -> dict:
    """Extract one table → Parquet file. Returns result dict."""
    t0 = time.perf_counter()
    eid = entity["id"]
    name = entity["source_name"].strip()
    ns = entity["namespace"] or entity["database"]
    schema = entity.get("source_schema") or "dbo"
    server = entity["server"]
    database = entity["database"]
    qualified = f"[{schema}].[{name}]"
    query = f"SELECT * FROM {qualified}"

    result = {
        "id": eid, "name": name, "namespace": ns,
        "server": server, "database": database,
        "status": "failed", "rows": 0, "bytes": 0, "duration": 0,
        "error": None, "method": "pyodbc",
    }

    try:
        # pyodbc is more reliable on Windows with SSPI — ConnectorX has bb8 timeout issues
        df = _extract_pyodbc(server, database, query)

        # Drop binary columns
        drop = [c for c in df.columns if c.lower() in BINARY_TYPES]
        if drop:
            df = df.drop(drop)

        rows = len(df)
        result["rows"] = rows

        if rows == 0:
            result["status"] = "succeeded"
            result["duration"] = round(time.perf_counter() - t0, 2)
            return result

        # Write Parquet
        out_path = output_dir / ns / f"{name}.parquet"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(out_path), compression="snappy")
        file_size = out_path.stat().st_size

        result["status"] = "succeeded"
        result["bytes"] = file_size
        result["duration"] = round(time.perf_counter() - t0, 2)

    except Exception as exc:
        result["error"] = str(exc)[:300]
        result["duration"] = round(time.perf_counter() - t0, 2)

    return result


_conn_pool: dict[str, "pyodbc.Connection"] = {}
_conn_pool_lock = threading.Lock()


def _get_pyodbc_conn(server: str, database: str):
    """Get or create a pyodbc connection (one per server/database pair per thread)."""
    import pyodbc
    tid = threading.get_ident()
    key = f"{tid}:{server}:{database}"

    with _conn_pool_lock:
        conn = _conn_pool.get(key)

    if conn is not None:
        try:
            conn.execute("SELECT 1")
            return conn
        except Exception:
            pass  # stale — reconnect

    conn_str = (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Trusted_Connection=yes;"
        f"TrustServerCertificate=yes;"
    )
    conn = pyodbc.connect(conn_str, timeout=60)
    with _conn_pool_lock:
        _conn_pool[key] = conn
    return conn


def _extract_pyodbc(server: str, database: str, query: str) -> pl.DataFrame:
    """pyodbc extraction with per-thread connection pooling."""
    conn = _get_pyodbc_conn(server, database)
    cursor = conn.cursor()
    cursor.execute(query)

    if not cursor.description:
        return pl.DataFrame()

    col_names = [desc[0] for desc in cursor.description]
    all_rows = cursor.fetchall()

    if not all_rows:
        return pl.DataFrame()

    data = {}
    for i, name in enumerate(col_names):
        data[name] = [row[i] for row in all_rows]
    return pl.DataFrame(data)


def main():
    parser = argparse.ArgumentParser(description="Fast SQL Server → Parquet extraction")
    parser.add_argument("--source", "-s", help="Filter by source name (MES, ETQ, M3_ERP, M3C, OPTIVA)")
    parser.add_argument("--workers", "-w", type=int, default=16, help="Max parallel workers (default: 16)")
    parser.add_argument("--limit", "-l", type=int, help="Limit to N entities")
    parser.add_argument("--output", "-o", default="./parquet_out", help="Output directory (default: ./parquet_out)")
    args = parser.parse_args()

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"ConnectorX: {'YES (Rust speed)' if HAS_CX else 'NO (pyodbc fallback)'}")
    print(f"Output: {output_dir}")
    print(f"Workers: {args.workers}")

    # Load entities
    entities = get_entities(source=args.source, limit=args.limit)
    total = len(entities)
    if total == 0:
        print("No entities found.")
        return

    # Group by source for display
    sources = {}
    for e in entities:
        key = f"{e['server']}/{e['database']}"
        sources.setdefault(key, 0)
        sources[key] += 1
    for src, cnt in sources.items():
        print(f"  {src}: {cnt} entities")
    print(f"Total: {total} entities\n")

    # ── Extract ──────────────────────────────────────────────────────────
    completed = 0
    succeeded = 0
    failed = 0
    total_rows = 0
    total_bytes = 0
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(extract_one, e, output_dir): e for e in entities}

        for future in as_completed(futures):
            result = future.result()
            completed += 1

            if result["status"] == "succeeded":
                succeeded += 1
                total_rows += result["rows"]
                total_bytes += result["bytes"]
            else:
                failed += 1

            elapsed = time.time() - t_start
            rate = completed / max(elapsed, 0.1)
            eta = (total - completed) / max(rate, 0.01)

            status_icon = "OK" if result["status"] == "succeeded" else "FAIL"
            row_str = f"{result['rows']:,}" if result["rows"] else "0"
            size_str = f"{result['bytes'] / 1024:.0f}KB" if result["bytes"] else "0B"

            # Single-line progress
            print(
                f"[{completed:4d}/{total}] {status_icon} {result['namespace']}/{result['name']:<40s} "
                f"{row_str:>10s} rows  {size_str:>8s}  {result['duration']:.1f}s"
                f"  | {succeeded} ok {failed} fail  ~{eta:.0f}s left",
                flush=True,
            )

            if result["error"]:
                print(f"         ERROR: {result['error'][:120]}")

    # ── Summary ──────────────────────────────────────────────────────────
    elapsed = time.time() - t_start
    print(f"\n{'='*70}")
    print(f"DONE: {succeeded}/{total} succeeded, {failed} failed")
    print(f"Rows: {total_rows:,}")
    print(f"Size: {total_bytes / (1024*1024):.1f} MB")
    print(f"Time: {elapsed:.1f}s ({total / max(elapsed, 0.1):.1f} entities/sec)")
    print(f"Output: {output_dir}")
    print(f"Method: {'ConnectorX (Rust)' if HAS_CX else 'pyodbc'}")


if __name__ == "__main__":
    main()
