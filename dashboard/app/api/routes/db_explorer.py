"""Database Explorer — browse SQLite tables, schemas, and run read-only queries.

SECURITY NOTES:
- Table names in FROM/PRAGMA use f-string interpolation because SQLite doesn't
  support parameterized table names. All table names are validated against
  sqlite_master before use, preventing arbitrary table injection.
- The read-only SQL console allows only SELECT/PRAGMA statements. SQLite's
  cursor.execute() runs only one statement (no stacked queries), which prevents
  "SELECT 1; DROP TABLE x" attacks. load_extension() is disabled by default in
  Python's sqlite3 module unless explicitly enabled.
"""
from dashboard.app.api.router import route, HttpError
from dashboard.app.api import db


def _validate_table_name(table: str) -> bool:
    """Verify table exists in sqlite_master. Prevents f-string SQL injection."""
    exists = db.query(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return bool(exists)


@route("GET", "/api/db-explorer/tables")
def list_tables(params):
    rows = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    result = []
    for r in rows:
        count = db.query(f"SELECT COUNT(*) as cnt FROM [{r['name']}]")
        result.append({"name": r["name"], "row_count": count[0]["cnt"]})
    return result


@route("GET", "/api/db-explorer/table/{name}")
def get_table_data(params):
    table = params["name"]
    page = int(params.get("page", 1))
    per_page = min(int(params.get("per_page", 50)), 500)
    offset = (page - 1) * per_page

    if not _validate_table_name(table):
        raise HttpError("Table not found", 404)

    rows = db.query(f"SELECT * FROM [{table}] LIMIT ? OFFSET ?", (per_page, offset))
    total = db.query(f"SELECT COUNT(*) as cnt FROM [{table}]")
    return {"rows": rows, "total": total[0]["cnt"], "page": page, "per_page": per_page}


@route("GET", "/api/db-explorer/table/{name}/schema")
def get_table_schema(params):
    table = params["name"]
    if not _validate_table_name(table):
        raise HttpError("Table not found", 404)
    rows = db.query(f"PRAGMA table_info([{table}])")
    return [{"name": r["name"], "type": r["type"], "notnull": r["notnull"], "pk": r["pk"]} for r in rows]


@route("POST", "/api/db-explorer/query")
def execute_query(params):
    """Read-only SQL console. Only SELECT and PRAGMA allowed."""
    sql = params.get("sql", "").strip()
    if not sql:
        raise HttpError("sql is required", 400)
    normalized = sql.upper().lstrip()
    if not normalized.startswith("SELECT") and not normalized.startswith("PRAGMA"):
        raise HttpError("Only SELECT and PRAGMA queries allowed", 400)
    rows = db.query(sql)
    return {"rows": rows, "count": len(rows)}
