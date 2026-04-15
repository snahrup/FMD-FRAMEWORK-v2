"""Pipeline integrity audit routes.

Provides an evidence-first view of the managed pipeline state so operators can
differentiate:
1. entities that are clean in the latest state,
2. entities that only succeeded historically, and
3. entities that have never completed the chain.
"""

from collections import defaultdict

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.router import route
from dashboard.app.api.routes.load_center import _build_canonical_pipeline_truth


_SUCCESS_STATUSES = {"succeeded", "loaded", "success", "complete", "completed"}


def _is_success(status: str | None) -> bool:
    return str(status or "").strip().lower() in _SUCCESS_STATUSES


@route("GET", "/api/pipeline-integrity")
def get_pipeline_integrity(params: dict) -> dict:
    """Return a deterministic integrity report for active entities."""
    truth = _build_canonical_pipeline_truth(include_history=True)
    latest_lookup = truth.get("latestLookup", {})
    history_lookup = truth.get("historyLookup", {})
    registered = truth.get("registered", [])

    include_entities = str(
        params.get("includeEntities") or params.get("include") or ""
    ).strip().lower() in {"1", "true", "yes", "entities", "all"}
    source_filter = str(params.get("source") or "").strip().lower()
    limit_raw = str(params.get("limit") or "200").strip()
    limit = int(limit_raw) if limit_raw.isdigit() else 200

    by_source: dict[str, dict] = defaultdict(lambda: {
        "source": "",
        "displayName": "",
        "inScope": 0,
        "latestClean": 0,
        "historicalFullChain": 0,
        "historicalOnly": 0,
        "latestLandingSuccess": 0,
        "latestBronzeSuccess": 0,
        "latestSilverSuccess": 0,
        "latestLandingFailed": 0,
        "latestBronzeFailed": 0,
        "latestSilverFailed": 0,
    })

    summary = {
        "inScope": 0,
        "latestFullChain": 0,
        "historicalFullChain": 0,
        "historicalOnly": 0,
        "missingLandingHistory": 0,
        "missingBronzeHistory": 0,
        "missingSilverHistory": 0,
        "latestLandingSuccess": 0,
        "latestBronzeSuccess": 0,
        "latestSilverSuccess": 0,
    }

    entities: list[dict] = []

    for entity in registered:
        source_name = str(entity.get("source_name") or "").strip()
        source_display = str(entity.get("source_display") or source_name).strip()
        if source_filter and source_filter not in {source_name.lower(), source_display.lower()}:
            continue

        data_source_id = int(entity.get("data_source_id") or 0)
        schema = str(entity.get("schema") or "").strip().lower()
        table = str(entity.get("table_name") or "").strip().lower()
        if not data_source_id or not schema or not table:
            continue

        summary["inScope"] += 1
        source_bucket = by_source[source_name]
        source_bucket["source"] = source_name
        source_bucket["displayName"] = source_display
        source_bucket["inScope"] += 1

        latest_statuses: dict[str, str | None] = {}
        latest_times: dict[str, str | None] = {}
        history_success: dict[str, bool] = {}

        for layer_key in ("lz", "bronze", "silver"):
            key = (layer_key, data_source_id, schema, table)
            latest_row = latest_lookup.get(key)
            latest_status = str(latest_row.get("Status") or "").lower() if latest_row else None
            latest_statuses[layer_key] = latest_status
            latest_times[layer_key] = latest_row.get("LoadEndDateTime") if latest_row else None
            history_success[layer_key] = key in history_lookup

        latest_clean = all(_is_success(latest_statuses[layer_key]) for layer_key in ("lz", "bronze", "silver"))
        historical_full_chain = all(history_success[layer_key] for layer_key in ("lz", "bronze", "silver"))

        if latest_clean:
            summary["latestFullChain"] += 1
            source_bucket["latestClean"] += 1
        if historical_full_chain:
            summary["historicalFullChain"] += 1
            source_bucket["historicalFullChain"] += 1
            if not latest_clean:
                summary["historicalOnly"] += 1
                source_bucket["historicalOnly"] += 1

        if not history_success["lz"]:
            summary["missingLandingHistory"] += 1
        elif not history_success["bronze"]:
            summary["missingBronzeHistory"] += 1
        elif not history_success["silver"]:
            summary["missingSilverHistory"] += 1

        if _is_success(latest_statuses["lz"]):
            summary["latestLandingSuccess"] += 1
            source_bucket["latestLandingSuccess"] += 1
        elif latest_statuses["lz"] == "failed":
            source_bucket["latestLandingFailed"] += 1

        if _is_success(latest_statuses["bronze"]):
            summary["latestBronzeSuccess"] += 1
            source_bucket["latestBronzeSuccess"] += 1
        elif latest_statuses["bronze"] == "failed":
            source_bucket["latestBronzeFailed"] += 1

        if _is_success(latest_statuses["silver"]):
            summary["latestSilverSuccess"] += 1
            source_bucket["latestSilverSuccess"] += 1
        elif latest_statuses["silver"] == "failed":
            source_bucket["latestSilverFailed"] += 1

        if include_entities:
            entities.append({
                "entityId": int(entity.get("entity_id") or 0),
                "dataSourceId": data_source_id,
                "source": source_name,
                "displayName": source_display,
                "schema": entity.get("schema") or "",
                "table": entity.get("table_name") or "",
                "latestLandingStatus": latest_statuses["lz"],
                "latestBronzeStatus": latest_statuses["bronze"],
                "latestSilverStatus": latest_statuses["silver"],
                "latestLandingAt": latest_times["lz"],
                "latestBronzeAt": latest_times["bronze"],
                "latestSilverAt": latest_times["silver"],
                "historicalLanding": history_success["lz"],
                "historicalBronze": history_success["bronze"],
                "historicalSilver": history_success["silver"],
                "latestClean": latest_clean,
                "historicalFullChain": historical_full_chain,
                "historicalOnly": historical_full_chain and not latest_clean,
            })

    entities.sort(key=lambda row: (
        0 if row.get("historicalOnly") else 1,
        row.get("displayName") or "",
        row.get("schema") or "",
        row.get("table") or "",
    ))

    runs = cpdb.get_engine_runs(limit=1)
    last_run = runs[0] if runs else None

    return {
        "summary": summary,
        "bySource": sorted(by_source.values(), key=lambda row: row["displayName"] or row["source"]),
        "entities": entities[:limit] if include_entities else [],
        "lastRun": {
            "runId": last_run.get("RunId"),
            "status": last_run.get("Status"),
            "startedAt": last_run.get("StartedAt"),
            "endedAt": last_run.get("EndedAt"),
            "completedUnits": last_run.get("CompletedUnits"),
            "succeededEntities": last_run.get("SucceededEntities"),
            "failedEntities": last_run.get("FailedEntities"),
            "skippedEntities": last_run.get("SkippedEntities"),
            "heartbeatAt": last_run.get("HeartbeatAt"),
            "currentLayer": last_run.get("CurrentLayer"),
        } if last_run else None,
        "evidence": {
            "latestTruth": "get_mapped_engine_task_log(latest_only=True)",
            "historicalTruth": "get_mapped_engine_task_log(latest_only=True, success_only=True)",
        },
    }
