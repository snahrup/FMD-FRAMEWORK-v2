"""
Post OPTIVA pipeline status comments to Jira MT tasks.
"""
import json
import urllib.request
import urllib.error
import base64

JIRA_BASE = "https://ip-corporation.atlassian.net/rest/api/3"
AUTH = base64.b64encode(b"snahrup@ip-corporation.com:ATATT3xFfGF0e0hfY2CPF0n87AJjKN69UHwJnkPVwSb_ng_7qC_0LKaL_hghfdvmDhcD2wLjWQiKbUxmztrny3OrkUGNCMWhalRb6L8vHrvS0vXO60fEZEIMkXRqvdwfmsTf5gqoJH-wH-dNLP5qvJSSArpiBOQ_2uUExXNP0Tif-cqRHWR-EU4=53C31CE6").decode()


def post_comment(issue_key, body_adf):
    url = f"{JIRA_BASE}/issue/{issue_key}/comment"
    data = json.dumps({"body": body_adf}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Basic {AUTH}")
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read().decode())
        print(f"  OK  {issue_key} -> comment {result.get('id')} created at {result.get('created', '')[:19]}")
        return result.get("id")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:500]
        print(f"  FAIL {issue_key} → {e.code}: {err}")
        return None


def add_worklog(issue_key, seconds, comment_text, started="2026-02-27T09:00:00.000+0000"):
    url = f"{JIRA_BASE}/issue/{issue_key}/worklog"
    data = json.dumps({
        "timeSpentSeconds": seconds,
        "started": started,
        "comment": {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_text}]}]
        }
    }).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Basic {AUTH}")
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read().decode())
        print(f"  OK  {issue_key} -> worklog {result.get('id')} ({seconds//3600}h)")
        return result.get("id")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:400]
        print(f"  FAIL worklog {issue_key} → {e.code}: {err}")
        return None


# ── MT-17 Comment: OPTIVA pipeline debugging & current run status ─────────────
mt17_comment = {
    "type": "doc",
    "version": 1,
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "OPTIVA Source Isolation & Pipeline Debugging — 2026-02-27"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Pivoted strategy today. Rather than hammering all four sources simultaneously, I isolated OPTIVA (DataSourceId=8, 480 entities) as a dedicated test run. The ForEach-kills-everything behavior I documented yesterday means a single bad entity in M3 ERP or MES can abort an entire run touching 1,255 tables. Better to nail one source at a time and build confidence before going broad again."}
            ]
        },
        {
            "type": "heading",
            "attrs": {"level": 4},
            "content": [{"type": "text", "text": "Root Causes Found and Fixed"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Three distinct failure modes surfaced through forensic analysis of the previous overnight runs:"}
            ]
        },
        {
            "type": "orderedList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "text": "Stale PipelineLandingzoneEntity records", "marks": [{"type": "strong"}]},
                                {"type": "text", "text": " — Previous failed runs leave orphaned execution records in the metadata DB. On subsequent runs, the LZ pipeline sees those records as 'in flight' and skips re-processing, so entities appear successful when they actually never ran. Cleaned 775 stale entries from execution.PipelineLandingzoneEntity before this run."}
                            ]
                        }
                    ]
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "text": "Incremental column type mismatch — 185 entities", "marks": [{"type": "strong"}]},
                                {"type": "text", "text": " — The Load Optimization Engine detected rowversion and timestamp columns and flagged them as incremental watermarks. But the LZ Copy Activity stores watermark values as varchar in LandingzoneEntityLastLoadValue. When it tries to cast that varchar back to a timestamp/rowversion on the next run, it throws a conversion error. Reset all 185 affected entities to full load (LoadType='F', WatermarkColumn=NULL). These will be revisited once proper rowversion serialization is built into the metadata schema."}
                            ]
                        }
                    ]
                },
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "text": "OutOfMemoryException on 3 large OPTIVA tables", "marks": [{"type": "strong"}]},
                                {"type": "text", "text": " — FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, and FSDESCRIPTION (LzIds 1386, 1389, 1451) blow the Fabric executor memory ceiling during parquet conversion. Either extremely wide schemas or high-cardinality blob columns. Deactivated all three (IsActive=0); they need a chunked-read strategy or schema profiling before they can run cleanly."}
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "type": "heading",
            "attrs": {"level": 4},
            "content": [{"type": "text", "text": "Source Isolation via IsActive Flag"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "The isolation mechanism is elegant in its simplicity. The execution view "},
                {"type": "text", "text": "vw_LoadSourceToLandingzone", "marks": [{"type": "code"}]},
                {"type": "text", "text": " filters by "},
                {"type": "text", "text": "IsActive=1", "marks": [{"type": "code"}]},
                {"type": "text", "text": ". By deactivating all non-OPTIVA entities (MES 445, ETQ 29, M3 FDB 596, M3C 185), the pipeline naturally scopes to just the 477 active OPTIVA entities without any pipeline config changes. This is exactly the kind of metadata-driven flexibility the framework was designed for."}
            ]
        },
        {
            "type": "heading",
            "attrs": {"level": 4},
            "content": [{"type": "text", "text": "Current Run Status"}]
        },
        {
            "type": "table",
            "attrs": {"isNumberColumnEnabled": False, "layout": "default"},
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableHeader", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Source"}]}]},
                        {"type": "tableHeader", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Active Entities"}]}]},
                        {"type": "tableHeader", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Deactivated"}]}]},
                        {"type": "tableHeader", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Status"}]}]}
                    ]
                },
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "OPTIVA (DS 8)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "477"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "3 (OOM)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "LZ running — approx 40 min in"}]}]}
                    ]
                },
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "MES (DS 4)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "0"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "445 (isolated)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Staged for next run"}]}]}
                    ]
                },
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "ETQ (DS 9)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "0"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "29 (isolated)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Staged for next run"}]}]}
                    ]
                },
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "M3 FDB (DS 6)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "0"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "596 (isolated)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Staged for next run"}]}]}
                    ]
                },
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "M3C (DS 7)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "0"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "185 (isolated)"}]}]},
                        {"type": "tableCell", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Staged for next run"}]}]}
                    ]
                }
            ]
        },
        {
            "type": "heading",
            "attrs": {"level": 4},
            "content": [{"type": "text", "text": "Incremental Load Configuration (OPTIVA)"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "120 of 480 OPTIVA entities (25%) are configured for incremental loading. The remaining 360 are full-load only — either no suitable watermark column exists, the column is a rowversion type that needs special handling, or the entity is in the OOM-deactivated bucket. Gap report script is ready to run post-completion to compare expected entity counts against actual Delta tables in the lakehouse before Bronze kicks off."}
            ]
        },
        {
            "type": "heading",
            "attrs": {"level": 4},
            "content": [{"type": "text", "text": "Architectural Note: FE_ENTITY ForEach Has No Fault Tolerance"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Worth documenting: the "},
                {"type": "text", "text": "FE_ENTITY", "marks": [{"type": "code"}]},
                {"type": "text", "text": " ForEach in the LZ pipeline has no continueOnError. One entity exception kills the entire run. Fine for dev, but this will need a fix before production — either try/catch wrapping on the inner Copy Activity or a dead-letter routing pattern. For now the IsActive deactivation workaround handles it. Incremental strategy validation continues under "},
                {
                    "type": "inlineCard",
                    "attrs": {"url": "https://ip-corporation.atlassian.net/browse/MT-57"}
                },
                {"type": "text", "text": "."}
            ]
        }
    ]
}

# ── MT-37 Comment: OPTIVA scale-up details ────────────────────────────────────
mt37_comment = {
    "type": "doc",
    "version": 1,
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "OPTIVA-Only Run — Source Isolation Approach — 2026-02-27"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "After the multi-source overnight run exposed three different failure categories, I narrowed focus to OPTIVA exclusively. 477 entities active, all non-OPTIVA sources deactivated via IsActive=0. This lets us prove the LZ -> Bronze path is clean for one source before reactivating the rest."}
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "The three deactivated OPTIVA entities (FSACTIONWEVENTPARAM, FSACTIONWIPRESULTS, FSDESCRIPTION) are OOM failures — these need dedicated handling and will be tracked separately. The 185 entities that had timestamp/rowversion watermark columns have been reset to full load to clear the varchar casting errors. That's a schema-level fix that belongs in a future iteration of the Load Optimization Engine, not a blocker for the current run."}
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "LZ pipeline kicked off with 477 active OPTIVA entities. After it completes, the gap report runs to verify all parquet files landed before Bronze is triggered. Full-scale test for all sources resumes once OPTIVA proves out end-to-end. See "},
                {
                    "type": "inlineCard",
                    "attrs": {"url": "https://ip-corporation.atlassian.net/browse/MT-17"}
                },
                {"type": "text", "text": " for full debug context."}
            ]
        }
    ]
}

# ── MT-36 Comment: Row count validation approach ──────────────────────────────
mt36_comment = {
    "type": "doc",
    "version": 1,
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "OPTIVA Row Count Validation Plan — 2026-02-27"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Row count validation for OPTIVA is more straightforward than M3 ERP since the OPTIVA SQL server doesn't have the sys.partitions=-1 issue. Once the LZ run completes, the gap report script compares:"}
            ]
        },
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Expected: 477 active entities should have corresponding parquet files in the LZ lakehouse"}]}]
                },
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Actual: query execution.PipelineLandingzoneEntity for completed records vs Delta tables present in Bronze"}]}]
                },
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Source counts: direct SELECT COUNT(*) queries to the OPTIVA SQL server for spot-check validation on high-value tables"}]}]
                }
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "The 3 deactivated OOM entities (LzIds 1386, 1389, 1451) are excluded from both the expected set and the validation. Deactivating them pre-run means they should simply not appear in any execution records for this pipeline run."}
            ]
        }
    ]
}

# ── MT-57 Comment: OPTIVA incremental strategy update ────────────────────────
mt57_comment = {
    "type": "doc",
    "version": 1,
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": "OPTIVA Incremental Strategy — Rowversion Issue & Resolution — 2026-02-27"}]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "Hit an important edge case with the OPTIVA incremental strategy. The Load Optimization Engine correctly identified rowversion and timestamp columns as the highest-priority watermark candidates (rowversion > modified datetime > created datetime > identity in the priority chain). But there's a fundamental data type problem: LandingzoneEntityLastLoadValue is a varchar column in the metadata DB. When the LZ Copy Activity tries to use a stored rowversion value as a watermark on the next incremental run, the cast from varchar to timestamp/rowversion fails."}
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "The fix for this run was pragmatic: reset all 185 affected entities to full load (LoadType='F', WatermarkColumn=NULL). This unblocks the current pipeline run while the proper fix gets designed. The right solution is either:"}
            ]
        },
        {
            "type": "orderedList",
            "content": [
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Store rowversion watermarks as bigint (SQL Server rowversion IS an 8-byte binary that can be cast to bigint) and handle the conversion in the Copy Activity parameterization"}]}]
                },
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Separate the watermark storage type per entity rather than a single varchar column — requires a metadata schema change"}]}]
                }
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "For OPTIVA specifically: 120 of 480 entities will run incrementally (datetime watermarks only, no rowversion issues). The other 357 run full load — either no watermark, or rowversion types reset to full. The 3 OOM entities are fully deactivated."}
            ]
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "The rowversion handling improvement will be captured as a follow-on enhancement to the Load Optimization Engine. It doesn't block the current pipeline validation work in "},
                {
                    "type": "inlineCard",
                    "attrs": {"url": "https://ip-corporation.atlassian.net/browse/MT-17"}
                },
                {"type": "text", "text": " and "},
                {
                    "type": "inlineCard",
                    "attrs": {"url": "https://ip-corporation.atlassian.net/browse/MT-37"}
                },
                {"type": "text", "text": "."}
            ]
        }
    ]
}


if __name__ == "__main__":
    print("Posting OPTIVA pipeline status comments to Jira MT tasks...")
    print()

    print("MT-17 — Build & Validate Landing Zone + Bronze Pipelines:")
    post_comment("MT-17", mt17_comment)
    add_worklog("MT-17", 7200, "OPTIVA source isolation: root cause analysis of 3 failure modes, cleaned stale records, reset 185 rowversion entities to full load, deactivated 3 OOM entities, kicked off OPTIVA-only LZ run (477 entities)")

    print()
    print("MT-37 — Scale up to full table set across all sources:")
    post_comment("MT-37", mt37_comment)
    add_worklog("MT-37", 3600, "Refined scale-up approach: OPTIVA isolated run with 477 entities, documented gap report validation plan post-completion")

    print()
    print("MT-36 — Validate row counts between source and Bronze tables:")
    post_comment("MT-36", mt36_comment)
    add_worklog("MT-36", 1800, "Designed OPTIVA row count validation approach: gap report vs execution records vs source direct counts")

    print()
    print("MT-57 — Historical Data Backfill & Incremental Load Strategy:")
    post_comment("MT-57", mt57_comment)
    add_worklog("MT-57", 3600, "Identified rowversion watermark casting bug (varchar storage mismatch), reset 185 entities to full load, documented two resolution paths for the metadata schema fix")

    print()
    print("Done.")
