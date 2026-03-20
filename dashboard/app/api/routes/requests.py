"""Business Portal data requests routes — CRUD for data request submissions.

Endpoints:
    GET   /api/requests      — list all requests, ordered by created_at DESC
    POST  /api/requests      — create a new data request
    PATCH /api/requests/{id}  — update request status/admin response

Data source: SQLite via control_plane_db._get_conn()
Table: data_requests (created on module load, idempotent)
"""
import logging
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route, HttpError

log = logging.getLogger("fmd.routes.requests")

VALID_PRIORITIES = {"low", "medium", "high"}
VALID_STATUSES = {"submitted", "in_review", "approved", "completed", "declined"}


# ---------------------------------------------------------------------------
# Table creation (idempotent, runs on module import)
# ---------------------------------------------------------------------------

def _ensure_table():
    conn = cpdb._get_conn()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS data_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                source_name TEXT,
                description TEXT,
                justification TEXT,
                priority TEXT DEFAULT 'medium',
                status TEXT DEFAULT 'submitted',
                admin_response TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    finally:
        conn.close()


_ensure_table()


def _row_to_dict(row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return {
        "id": row["id"],
        "title": row["title"],
        "source_name": row["source_name"],
        "description": row["description"],
        "justification": row["justification"],
        "priority": row["priority"],
        "status": row["status"],
        "admin_response": row["admin_response"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ---------------------------------------------------------------------------
# GET /api/requests
# ---------------------------------------------------------------------------

@route("GET", "/api/requests")
def list_requests(params: dict) -> list:
    """List all data requests, newest first.

    Query params:
        status — optional filter (e.g. ?status=submitted)

    Returns list of request objects.
    """
    status_filter = params.get("status")
    conn = cpdb._get_conn()
    try:
        if status_filter and status_filter in VALID_STATUSES:
            rows = conn.execute(
                "SELECT * FROM data_requests WHERE status = ? ORDER BY created_at DESC",
                (status_filter,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM data_requests ORDER BY created_at DESC"
            ).fetchall()

        return [_row_to_dict(r) for r in rows]

    except Exception:
        log.exception("Failed to list data requests")
        raise HttpError("Failed to list data requests", 500)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# POST /api/requests
# ---------------------------------------------------------------------------

@route("POST", "/api/requests")
def create_request(params: dict) -> dict:
    """Create a new data request.

    Body params:
        title        — required
        source_name  — optional (source system name or 'Other / Not Sure')
        description  — optional
        justification — optional
        priority     — optional, one of: low, medium, high (default: medium)

    Returns the created request object with id.
    """
    title = (params.get("title") or "").strip()
    if not title:
        raise HttpError("Title is required", 400)

    source_name = (params.get("source_name") or "").strip() or None
    description = (params.get("description") or "").strip() or None
    justification = (params.get("justification") or "").strip() or None
    priority = (params.get("priority") or "medium").strip().lower()

    if priority not in VALID_PRIORITIES:
        raise HttpError(f"Priority must be one of: {', '.join(sorted(VALID_PRIORITIES))}", 400)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = cpdb._get_conn()
    try:
        cursor = conn.execute(
            """
            INSERT INTO data_requests (title, source_name, description, justification, priority, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?)
            """,
            (title, source_name, description, justification, priority, now, now),
        )
        conn.commit()
        request_id = cursor.lastrowid

        row = conn.execute(
            "SELECT * FROM data_requests WHERE id = ?", (request_id,)
        ).fetchone()

        return _row_to_dict(row)

    except Exception:
        log.exception("Failed to create data request")
        raise HttpError("Failed to create data request", 500)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# PATCH /api/requests/{id}
# ---------------------------------------------------------------------------

@route("PATCH", "/api/requests/{id}")
def update_request(params: dict) -> dict:
    """Update a data request's status and/or admin response.

    Path params:
        id — request ID

    Body params:
        status         — optional, one of: submitted, in_review, approved, completed, declined
        admin_response — optional, text response from admin

    Returns the updated request object.
    """
    request_id = params.get("id")
    if not request_id:
        raise HttpError("Request ID is required", 400)

    conn = cpdb._get_conn()
    try:
        existing = conn.execute(
            "SELECT * FROM data_requests WHERE id = ?", (request_id,)
        ).fetchone()

        if not existing:
            raise HttpError("Request not found", 404)

        new_status = params.get("status")
        admin_response = params.get("admin_response")
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        if new_status and new_status not in VALID_STATUSES:
            raise HttpError(f"Status must be one of: {', '.join(sorted(VALID_STATUSES))}", 400)

        # Build dynamic update
        updates = ["updated_at = ?"]
        values = [now]

        if new_status:
            updates.append("status = ?")
            values.append(new_status)

        if admin_response is not None:
            updates.append("admin_response = ?")
            values.append(admin_response)

        values.append(request_id)

        update_sql = "UPDATE data_requests SET " + ", ".join(updates) + " WHERE id = ?"
        conn.execute(update_sql, tuple(values))
        conn.commit()

        row = conn.execute(
            "SELECT * FROM data_requests WHERE id = ?", (request_id,)
        ).fetchone()

        return _row_to_dict(row)

    except HttpError:
        raise
    except Exception:
        log.exception("Failed to update data request %s", request_id)
        raise HttpError("Failed to update data request", 500)
    finally:
        conn.close()
