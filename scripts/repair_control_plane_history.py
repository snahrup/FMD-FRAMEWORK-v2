"""Repair historical engine_runs anomalies in the local control-plane DB.

Targets the defects identified in the forensic audit:
  - corrupt Layers strings (e.g. "l,a,n,d,i,n,g,,,b,r,o,n,z,e")
  - terminal runs missing EndedAt
  - terminal runs with EndedAt earlier than StartedAt
  - TotalDurationSeconds drifting away from StartedAt/EndedAt
  - stranded extracting rows on runs that are already terminal

Dry-run by default. Pass --apply to persist changes.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

import dashboard.app.api.control_plane_db as cpdb


TERMINAL_STATUSES = {
    "succeeded",
    "failed",
    "interrupted",
    "aborted",
    "cancelled",
    "canceled",
}


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt_ts(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _latest_task_timestamp(conn, run_id: str) -> datetime | None:
    row = conn.execute(
        "SELECT MAX(created_at) AS ts FROM engine_task_log WHERE RunId = ?",
        (run_id,),
    ).fetchone()
    return _parse_ts(row["ts"]) if row and row["ts"] else None


def _repair_rows(apply: bool) -> int:
    conn = cpdb._get_conn()
    updated = 0
    try:
        rows = conn.execute(
            "SELECT RunId, Status, StartedAt, EndedAt, HeartbeatAt, TotalDurationSeconds, Layers "
            "FROM engine_runs "
            "ORDER BY COALESCE(StartedAt, EndedAt, updated_at) DESC"
        ).fetchall()

        for row in rows:
            run_id = str(row["RunId"])
            status = str(row["Status"] or "").strip().lower()
            started = _parse_ts(row["StartedAt"])
            ended = _parse_ts(row["EndedAt"])
            heartbeat = _parse_ts(row["HeartbeatAt"])
            last_task = _latest_task_timestamp(conn, run_id)
            changes: dict[str, object] = {}

            normalized_layers = cpdb._normalize_run_layers_value(row["Layers"])
            raw_layers = str(row["Layers"] or "").strip()
            if normalized_layers and normalized_layers != raw_layers:
                changes["Layers"] = normalized_layers

            terminal = status in TERMINAL_STATUSES
            valid_times = [ts for ts in (heartbeat, last_task, started) if ts is not None]

            if terminal:
                if ended is not None and started is not None and ended >= started:
                    valid_times.append(ended)
                candidate_end = max(valid_times) if valid_times else ended
                if candidate_end is not None and (ended is None or (started and ended < started)):
                    ended = candidate_end
                    changes["EndedAt"] = _fmt_ts(candidate_end)

                if apply:
                    conn.execute(
                        "UPDATE engine_task_log "
                        "SET Status = 'failed', "
                        "    ErrorMessage = COALESCE(NULLIF(ErrorMessage, ''), 'Recovered historical stranded extracting row'), "
                        "    ErrorSuggestion = COALESCE(NULLIF(ErrorSuggestion, ''), 'This row was closed by repair_control_plane_history.py') "
                        "WHERE RunId = ? AND LOWER(COALESCE(Status, '')) = 'extracting'",
                        (run_id,),
                    )

            if started is not None and ended is not None and ended >= started:
                expected_duration = round((ended - started).total_seconds(), 2)
                current_duration = float(row["TotalDurationSeconds"] or 0)
                if abs(expected_duration - current_duration) > 1.0:
                    changes["TotalDurationSeconds"] = expected_duration

            if not changes:
                continue

            updated += 1
            print(f"{run_id[:8]}: {changes}")
            if apply:
                assignments = ", ".join(f"{column} = ?" for column in changes)
                params = list(changes.values()) + [run_id]
                conn.execute(
                    f"UPDATE engine_runs SET {assignments} WHERE RunId = ?",
                    params,
                )

        if apply:
            conn.commit()
        return updated
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair historical engine_runs anomalies")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist the repairs instead of printing the planned updates",
    )
    args = parser.parse_args()

    updated = _repair_rows(apply=args.apply)
    action = "Applied" if args.apply else "Planned"
    print(f"{action} repairs for {updated} run(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
