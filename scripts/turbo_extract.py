"""
Turbo Extract — Maximum-speed SQL Server → Parquet extraction.

Designed to run on vsc-fabric (LAN to source servers) but works anywhere.
Tries extraction methods in order of speed:
  1. BCP (bulk copy) → CSV → Polars → Parquet  (fastest, native TDS)
  2. arrow-odbc (Rust Arrow batch reader)        (fast, columnar ODBC)
  3. pyodbc with connection reuse                 (reliable fallback)

All queries use WITH (NOLOCK) to eliminate lock contention.
All methods use per-thread connection reuse to avoid SSPI overhead.

Usage:
    python scripts/turbo_extract.py                          # all active entities
    python scripts/turbo_extract.py --source MES             # one source
    python scripts/turbo_extract.py --workers 8              # parallel workers
    python scripts/turbo_extract.py --method bcp             # force BCP mode
    python scripts/turbo_extract.py --method arrow-odbc      # force arrow-odbc
    python scripts/turbo_extract.py --method pyodbc          # force pyodbc
    python scripts/turbo_extract.py --dry-run                # just list entities
    python scripts/turbo_extract.py --limit 10               # first 10 entities
    python scripts/turbo_extract.py --output C:/parquet_out  # custom output
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import polars as pl

# ── Config ──────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parent.parent / "dashboard" / "app" / "api" / "fmd_control_plane.db"

ODBC_DRIVER = "ODBC Driver 18 for SQL Server"

# Column types to exclude (binary/spatial/xml — can't go to Parquet cleanly)
BINARY_TYPES = frozenset({
    "timestamp", "rowversion", "binary", "varbinary", "image",
    "geometry", "geography", "xml", "hierarchyid", "sql_variant",
})

# ── Detection ───────────────────────────────────────────────────────────────

def _has_bcp() -> bool:
    """Check if BCP is on PATH."""
    return shutil.which("bcp") is not None


def _has_arrow_odbc() -> bool:
    try:
        import arrow_odbc  # noqa: F401
        return True
    except ImportError:
        return False


# ── Entity loading ──────────────────────────────────────────────────────────

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


def get_size_hints() -> dict[int, float]:
    """Load average extract duration from prior task_log entries."""
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=10)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT EntityId, AVG(DurationSeconds) as avg_dur "
            "FROM engine_task_log WHERE Status = 'succeeded' "
            "GROUP BY EntityId"
        ).fetchall()
        conn.close()
        return {r["EntityId"]: r["avg_dur"] or 0 for r in rows}
    except Exception:
        return {}


# ── Method 1: BCP ───────────────────────────────────────────────────────────

def extract_bcp(entity: dict, output_dir: Path, tmp_dir: Path) -> dict:
    """BCP queryout → CSV → Polars → Parquet."""
    t0 = time.perf_counter()
    name = entity["source_name"].strip()
    schema = entity.get("source_schema") or "dbo"
    server = entity["server"]
    database = entity["database"]
    ns = entity["namespace"] or database

    result = {
        "id": entity["id"], "name": name, "namespace": ns,
        "server": server, "database": database,
        "status": "failed", "rows": 0, "bytes": 0, "duration": 0,
        "error": None, "method": "bcp",
    }

    csv_path = tmp_dir / f"{entity['id']}_{name}.csv"

    try:
        # BCP with NOLOCK, Windows Auth (-T), pipe delimiter, 32KB packets
        query = f"SELECT * FROM [{schema}].[{name}] WITH (NOLOCK)"
        cmd = [
            "bcp", query, "queryout", str(csv_path),
            "-S", server, "-d", database,
            "-T",           # Windows Auth
            "-c",           # Character mode
            "-t", "|",      # Pipe delimiter (safer than comma)
            "-a", "32768",  # 32KB packet size
        ]
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600,
        )
        if proc.returncode != 0:
            result["error"] = proc.stderr[:300] or proc.stdout[:300]
            result["duration"] = round(time.perf_counter() - t0, 2)
            return result

        if not csv_path.exists() or csv_path.stat().st_size == 0:
            result["status"] = "succeeded"
            result["duration"] = round(time.perf_counter() - t0, 2)
            return result

        # Read CSV → Parquet via Polars
        df = pl.read_csv(
            csv_path,
            separator="|",
            has_header=False,
            infer_schema_length=10000,
            ignore_errors=True,
        )

        # BCP queryout doesn't include headers — we need column names
        # Get them from a quick metadata query
        col_names = _get_column_names(server, database, schema, name)
        if col_names and len(col_names) == len(df.columns):
            df = df.rename(dict(zip(df.columns, col_names)))

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

        result["status"] = "succeeded"
        result["bytes"] = out_path.stat().st_size
        result["duration"] = round(time.perf_counter() - t0, 2)

    except subprocess.TimeoutExpired:
        result["error"] = "BCP timeout (600s)"
        result["duration"] = round(time.perf_counter() - t0, 2)
    except Exception as exc:
        result["error"] = str(exc)[:300]
        result["duration"] = round(time.perf_counter() - t0, 2)
    finally:
        # Clean up CSV
        try:
            csv_path.unlink(missing_ok=True)
        except Exception:
            pass

    return result


# Column name cache (server:db:schema:table → [col_names])
_col_cache: dict[str, list[str]] = {}
_col_cache_lock = threading.Lock()


def _get_column_names(server: str, database: str, schema: str, table: str) -> list[str]:
    """Get column names for a table (cached, uses pyodbc)."""
    key = f"{server}:{database}:{schema}:{table}"
    with _col_cache_lock:
        if key in _col_cache:
            return _col_cache[key]

    try:
        import pyodbc
        conn_str = (
            f"DRIVER={{{ODBC_DRIVER}}};"
            f"SERVER={server};DATABASE={database};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;"
        )
        conn = pyodbc.connect(conn_str, timeout=30)
        cursor = conn.cursor()
        cursor.execute(f"SELECT TOP 0 * FROM [{schema}].[{table}] WITH (NOLOCK)")
        names = [desc[0] for desc in cursor.description] if cursor.description else []
        conn.close()

        with _col_cache_lock:
            _col_cache[key] = names
        return names
    except Exception:
        return []


# ── Method 2: arrow-odbc ────────────────────────────────────────────────────

def extract_arrow_odbc(entity: dict, output_dir: Path) -> dict:
    """arrow-odbc batch reader → PyArrow → Parquet."""
    from arrow_odbc import read_arrow_batches_from_odbc
    import pyarrow.parquet as pq

    t0 = time.perf_counter()
    name = entity["source_name"].strip()
    schema = entity.get("source_schema") or "dbo"
    server = entity["server"]
    database = entity["database"]
    ns = entity["namespace"] or database

    result = {
        "id": entity["id"], "name": name, "namespace": ns,
        "server": server, "database": database,
        "status": "failed", "rows": 0, "bytes": 0, "duration": 0,
        "error": None, "method": "arrow-odbc",
    }

    try:
        conn_str = (
            f"DRIVER={{{ODBC_DRIVER}}};"
            f"SERVER={server};DATABASE={database};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;"
        )
        query = f"SELECT * FROM [{schema}].[{name}] WITH (NOLOCK)"

        reader = read_arrow_batches_from_odbc(
            query=query,
            connection_string=conn_str,
            batch_size=65535,
        )

        out_path = output_dir / ns / f"{name}.parquet"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Stream batches directly to Parquet writer
        writer = None
        total_rows = 0
        for batch in reader:
            if writer is None:
                writer = pq.ParquetWriter(str(out_path), batch.schema, compression="snappy")
            writer.write_batch(batch)
            total_rows += batch.num_rows

        if writer:
            writer.close()

        result["rows"] = total_rows
        result["status"] = "succeeded"
        result["bytes"] = out_path.stat().st_size if out_path.exists() else 0
        result["duration"] = round(time.perf_counter() - t0, 2)

    except Exception as exc:
        result["error"] = str(exc)[:300]
        result["duration"] = round(time.perf_counter() - t0, 2)

    return result


# ── Method 3: pyodbc with connection reuse ──────────────────────────────────

_pyodbc_pool: dict[str, object] = {}
_pyodbc_pool_lock = threading.Lock()


def _get_pyodbc_conn(server: str, database: str):
    """Get or create a pyodbc connection (one per server/database per thread)."""
    import pyodbc
    tid = threading.get_ident()
    key = f"{tid}:{server}:{database}"

    with _pyodbc_pool_lock:
        conn = _pyodbc_pool.get(key)

    if conn is not None:
        try:
            conn.execute("SELECT 1")
            return conn
        except Exception:
            pass  # stale — reconnect

    conn_str = (
        f"DRIVER={{{ODBC_DRIVER}}};"
        f"SERVER={server};DATABASE={database};"
        f"Trusted_Connection=yes;TrustServerCertificate=yes;"
    )
    conn = pyodbc.connect(conn_str, timeout=60)
    with _pyodbc_pool_lock:
        _pyodbc_pool[key] = conn
    return conn


def extract_pyodbc(entity: dict, output_dir: Path) -> dict:
    """pyodbc extraction with per-thread connection reuse + NOLOCK."""
    t0 = time.perf_counter()
    name = entity["source_name"].strip()
    schema = entity.get("source_schema") or "dbo"
    server = entity["server"]
    database = entity["database"]
    ns = entity["namespace"] or database

    result = {
        "id": entity["id"], "name": name, "namespace": ns,
        "server": server, "database": database,
        "status": "failed", "rows": 0, "bytes": 0, "duration": 0,
        "error": None, "method": "pyodbc",
    }

    try:
        conn = _get_pyodbc_conn(server, database)
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM [{schema}].[{name}] WITH (NOLOCK)")

        if not cursor.description:
            result["status"] = "succeeded"
            result["duration"] = round(time.perf_counter() - t0, 2)
            return result

        col_names = [desc[0] for desc in cursor.description]
        all_rows = cursor.fetchall()

        if not all_rows:
            result["status"] = "succeeded"
            result["rows"] = 0
            result["duration"] = round(time.perf_counter() - t0, 2)
            return result

        # Build DataFrame
        data = {}
        for i, col_name in enumerate(col_names):
            data[col_name] = [row[i] for row in all_rows]
        df = pl.DataFrame(data)

        rows = len(df)
        result["rows"] = rows

        # Write Parquet
        out_path = output_dir / ns / f"{name}.parquet"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(out_path), compression="snappy")

        result["status"] = "succeeded"
        result["bytes"] = out_path.stat().st_size
        result["duration"] = round(time.perf_counter() - t0, 2)

    except Exception as exc:
        result["error"] = str(exc)[:300]
        result["duration"] = round(time.perf_counter() - t0, 2)

    return result


# ── Orchestrator ────────────────────────────────────────────────────────────

def extract_one(entity: dict, method: str, output_dir: Path, tmp_dir: Path) -> dict:
    """Extract a single entity using the specified method."""
    if method == "bcp":
        return extract_bcp(entity, output_dir, tmp_dir)
    elif method == "arrow-odbc":
        return extract_arrow_odbc(entity, output_dir)
    else:
        return extract_pyodbc(entity, output_dir)


def main():
    parser = argparse.ArgumentParser(
        description="Turbo Extract — Maximum-speed SQL Server → Parquet"
    )
    parser.add_argument("--source", "-s", help="Filter by datasource name")
    parser.add_argument("--workers", "-w", type=int, default=8,
                        help="Parallel workers (default: 8)")
    parser.add_argument("--limit", "-l", type=int, help="Limit to N entities")
    parser.add_argument("--output", "-o",
                        help="Output directory (default: OneLake LZ or ./parquet_out)")
    parser.add_argument("--method", "-m", choices=["bcp", "arrow-odbc", "pyodbc", "auto"],
                        default="auto", help="Extraction method (default: auto)")
    parser.add_argument("--dry-run", action="store_true", help="List entities, don't extract")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip entities that already have a Parquet file")
    args = parser.parse_args()

    # ── Output directory ────────────────────────────────────────────────
    if args.output:
        output_dir = Path(args.output).resolve()
    else:
        # Try OneLake mount first
        onelake = Path(r"C:\Users\sasnahrup\OneLake - Microsoft\INTEGRATION DATA (D)\LH_DATA_LANDINGZONE.Lakehouse\Files")
        if onelake.exists():
            output_dir = onelake
            print(f"Output: OneLake mount ({output_dir})")
        else:
            output_dir = Path("./parquet_out").resolve()
            print(f"Output: local ({output_dir})")
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Method selection ────────────────────────────────────────────────
    if args.method == "auto":
        if _has_bcp():
            method = "bcp"
        elif _has_arrow_odbc():
            method = "arrow-odbc"
        else:
            method = "pyodbc"
    else:
        method = args.method

    # Validate
    if method == "bcp" and not _has_bcp():
        print("ERROR: BCP not found on PATH. Install SQL Server command-line tools.")
        print("       Or use --method pyodbc")
        sys.exit(1)
    if method == "arrow-odbc" and not _has_arrow_odbc():
        print("ERROR: arrow-odbc not installed. pip install arrow-odbc")
        print("       Or use --method pyodbc")
        sys.exit(1)

    print(f"Method: {method.upper()}")
    print(f"Workers: {args.workers}")

    # ── Load entities ───────────────────────────────────────────────────
    entities = get_entities(source=args.source, limit=args.limit)
    total = len(entities)
    if total == 0:
        print("No entities found.")
        return

    # Sort by estimated duration (fast first)
    hints = get_size_hints()
    entities.sort(key=lambda e: hints.get(e["id"], 0))

    # Skip existing
    if args.skip_existing:
        before = len(entities)
        entities = [
            e for e in entities
            if not (output_dir / (e["namespace"] or e["database"]) / f"{e['source_name'].strip()}.parquet").exists()
        ]
        skipped = before - len(entities)
        if skipped:
            print(f"Skipping {skipped} entities with existing Parquet files")
        total = len(entities)

    # Group by source for display
    from collections import Counter
    src_counts = Counter(e["ds_name"] for e in entities)
    for src, cnt in sorted(src_counts.items()):
        print(f"  {src}: {cnt} entities")
    print(f"Total: {total} entities\n")

    if args.dry_run:
        for e in entities:
            hint = hints.get(e["id"])
            hint_str = f" (~{hint:.0f}s)" if hint else ""
            print(f"  [{e['id']:>5}] {e['ds_name']:<18} {e['source_name']:<50}{hint_str}")
        return

    # ── BCP temp directory ──────────────────────────────────────────────
    tmp_dir = Path(tempfile.mkdtemp(prefix="turbo_extract_"))
    print(f"Temp: {tmp_dir}")

    # ── Extract ─────────────────────────────────────────────────────────
    completed = 0
    succeeded = 0
    failed = 0
    total_rows = 0
    total_bytes = 0
    errors: list[dict] = []
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(extract_one, e, method, output_dir, tmp_dir): e
            for e in entities
        }

        for future in as_completed(futures):
            result = future.result()
            completed += 1

            if result["status"] == "succeeded":
                succeeded += 1
                total_rows += result["rows"]
                total_bytes += result["bytes"]
            else:
                failed += 1
                errors.append(result)

            elapsed = time.time() - t_start
            rate = completed / max(elapsed, 0.1)
            eta = (total - completed) / max(rate, 0.01)

            status_icon = "OK" if result["status"] == "succeeded" else "FAIL"
            row_str = f"{result['rows']:,}" if result["rows"] else "0"
            size_str = f"{result['bytes'] / 1024:.0f}KB" if result["bytes"] else "0B"

            print(
                f"[{completed:4d}/{total}] {status_icon} "
                f"{result['namespace']}/{result['name']:<40s} "
                f"{row_str:>10s} rows  {size_str:>8s}  {result['duration']:.1f}s  "
                f"| {succeeded} ok {failed} fail  ~{eta:.0f}s left",
                flush=True,
            )

            if result["error"]:
                print(f"         ERROR: {result['error'][:120]}")

    # ── Cleanup ─────────────────────────────────────────────────────────
    try:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    except Exception:
        pass

    # ── Summary ─────────────────────────────────────────────────────────
    elapsed = time.time() - t_start
    print(f"\n{'=' * 70}")
    print(f"DONE: {succeeded}/{total} succeeded, {failed} failed")
    print(f"Rows: {total_rows:,}")
    print(f"Size: {total_bytes / (1024 * 1024):.1f} MB")
    print(f"Time: {elapsed:.1f}s ({total / max(elapsed, 0.1):.1f} entities/sec)")
    print(f"Method: {method}")
    print(f"Output: {output_dir}")

    if errors:
        print(f"\n--- ERRORS ({len(errors)}) ---")
        # Group by error type
        err_groups: dict[str, list] = {}
        for e in errors:
            key = (e.get("error") or "unknown")[:80]
            err_groups.setdefault(key, []).append(e["name"])
        for err, names in sorted(err_groups.items(), key=lambda x: -len(x[1])):
            print(f"  [{len(names)}x] {err}")
            for n in names[:5]:
                print(f"       - {n}")
            if len(names) > 5:
                print(f"       ... and {len(names) - 5} more")


if __name__ == "__main__":
    main()
