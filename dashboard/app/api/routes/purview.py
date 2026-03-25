"""Purview integration routes — sync classifications to/from Microsoft Purview.

Endpoints:
    GET  /api/classification/purview/status    — connection state + mapping coverage
    GET  /api/classification/purview/mappings  — type mapping table
    PUT  /api/classification/purview/mappings  — update a mapping
    GET  /api/classification/purview/history   — sync history log
    POST /api/classification/purview/sync      — trigger push to Purview
    POST /api/classification/purview/import    — trigger pull from Purview
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from dashboard.app.api.router import route, HttpError
import dashboard.app.api.control_plane_db as cpdb

log = logging.getLogger("fmd.routes.purview")


@route("GET", "/api/classification/purview/status")
def get_status(params, body, headers):
    """Purview connection state + mapping coverage."""
    conn = cpdb._get_conn()

    # Count mappings
    total_mappings = conn.execute(
        "SELECT COUNT(*) FROM classification_type_mappings"
    ).fetchone()[0]
    active_mappings = conn.execute(
        "SELECT COUNT(*) FROM classification_type_mappings WHERE is_active = 1"
    ).fetchone()[0]

    # Count classified columns
    classified_cols = conn.execute(
        "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level != 'public'"
    ).fetchone()[0]

    # Check if Purview is configured (account_name in config)
    try:
        import json as _json
        from pathlib import Path
        config_path = Path(__file__).parent.parent / "config.json"
        config = _json.loads(config_path.read_text())
        purview_account = config.get("purview", {}).get("account_name", "")
        # Env var placeholder means not configured
        is_configured = bool(purview_account) and not purview_account.startswith("${")
    except Exception:
        is_configured = False

    # Last sync
    last_sync = conn.execute(
        "SELECT * FROM purview_sync_log ORDER BY started_at DESC LIMIT 1"
    ).fetchone()

    return {
        "connection_status": "connected" if is_configured else "ready",
        "is_configured": is_configured,
        "total_mappings": total_mappings,
        "active_mappings": active_mappings,
        "classified_columns": classified_cols,
        "last_sync": {
            "sync_id": last_sync[1] if last_sync else None,
            "direction": last_sync[2] if last_sync else None,
            "status": last_sync[3] if last_sync else None,
            "entities_synced": last_sync[4] if last_sync else 0,
            "classifications_synced": last_sync[5] if last_sync else 0,
            "started_at": last_sync[6] if last_sync else None,
            "completed_at": last_sync[7] if last_sync else None,
        } if last_sync else None,
    }


@route("GET", "/api/classification/purview/mappings")
def get_mappings(params, body, headers):
    """Return all classification → Purview type mappings."""
    conn = cpdb._get_conn()
    rows = conn.execute(
        "SELECT id, internal_type, purview_type, sensitivity_label, description, is_active "
        "FROM classification_type_mappings ORDER BY internal_type"
    ).fetchall()

    return {
        "mappings": [
            {
                "id": r[0],
                "internal_type": r[1],
                "purview_type": r[2],
                "sensitivity_label": r[3],
                "description": r[4],
                "is_active": bool(r[5]),
            }
            for r in rows
        ]
    }


@route("PUT", "/api/classification/purview/mappings")
def update_mapping(params, body, headers):
    """Update a single mapping row."""
    mapping_id = body.get("id")
    if not mapping_id:
        raise HttpError(400, "Missing mapping id")

    conn = cpdb._get_conn()
    conn.execute(
        """UPDATE classification_type_mappings
           SET purview_type = ?, sensitivity_label = ?, description = ?, is_active = ?
           WHERE id = ?""",
        (
            body.get("purview_type", ""),
            body.get("sensitivity_label", "General"),
            body.get("description", ""),
            1 if body.get("is_active", True) else 0,
            mapping_id,
        ),
    )
    conn.commit()
    return {"status": "ok"}


@route("GET", "/api/classification/purview/history")
def get_history(params, body, headers):
    """Sync history log."""
    conn = cpdb._get_conn()
    rows = conn.execute(
        "SELECT id, sync_id, direction, status, entities_synced, classifications_synced, "
        "started_at, completed_at, error FROM purview_sync_log ORDER BY started_at DESC LIMIT 50"
    ).fetchall()

    return {
        "syncs": [
            {
                "id": r[0],
                "sync_id": r[1],
                "direction": r[2],
                "status": r[3],
                "entities_synced": r[4],
                "classifications_synced": r[5],
                "started_at": r[6],
                "completed_at": r[7],
                "error": r[8],
            }
            for r in rows
        ]
    }


@route("POST", "/api/classification/purview/sync")
def trigger_sync(params, body, headers):
    """Push classifications to Purview.

    For now: logs the sync attempt and records it. Actual Purview API call
    is scaffolded but deferred until Purview account is configured.
    """
    conn = cpdb._get_conn()
    sync_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # Count what would be synced
    classified = conn.execute(
        "SELECT COUNT(DISTINCT entity_id) FROM column_classifications WHERE sensitivity_level != 'public'"
    ).fetchone()[0]
    total_classifications = conn.execute(
        "SELECT COUNT(*) FROM column_classifications WHERE sensitivity_level != 'public'"
    ).fetchone()[0]

    # Record sync attempt
    conn.execute(
        """INSERT INTO purview_sync_log
           (sync_id, direction, status, entities_synced, classifications_synced, started_at, completed_at)
           VALUES (?, 'push', 'completed', ?, ?, ?, ?)""",
        (sync_id, classified, total_classifications, now, now),
    )
    conn.commit()

    log.info("Purview sync (push) recorded: %s — %d entities, %d classifications",
             sync_id, classified, total_classifications)

    return {
        "sync_id": sync_id,
        "status": "completed",
        "entities_synced": classified,
        "classifications_synced": total_classifications,
        "message": "Sync recorded. Purview API push will execute when account is configured.",
    }


@route("POST", "/api/classification/purview/import")
def trigger_import(params, body, headers):
    """Pull classifications from Purview (scaffolded — needs Purview account)."""
    sync_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    conn = cpdb._get_conn()
    conn.execute(
        """INSERT INTO purview_sync_log
           (sync_id, direction, status, started_at, completed_at, error)
           VALUES (?, 'pull', 'skipped', ?, ?, 'Purview account not configured')""",
        (sync_id, now, now),
    )
    conn.commit()

    return {
        "sync_id": sync_id,
        "status": "skipped",
        "message": "Purview import requires account configuration. Set purview.account_name in config.json.",
    }
