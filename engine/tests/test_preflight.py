"""Unit tests for engine/preflight.py — no network or VPN required.

Tests the PreflightChecker, CheckResult, and PreflightReport classes
using mocked dependencies (TokenProvider, SourceConnection, OneLakeLoader).
"""

from unittest.mock import MagicMock, patch
import pytest

from engine.preflight import CheckResult, PreflightReport, PreflightChecker
from engine.models import Entity, EngineConfig


# ---------------------------------------------------------------------------
# CheckResult
# ---------------------------------------------------------------------------

def test_check_result_passed():
    r = CheckResult(name="test", passed=True, message="ok", duration_ms=10.0)
    assert r.passed is True
    assert r.name == "test"
    assert r.duration_ms == 10.0


def test_check_result_failed():
    r = CheckResult(name="test", passed=False, message="error occurred")
    assert r.passed is False
    assert r.duration_ms == 0.0


# ---------------------------------------------------------------------------
# PreflightReport
# ---------------------------------------------------------------------------

def test_report_starts_passed():
    r = PreflightReport()
    assert r.passed is True
    assert r.checks == []
    assert r.total_duration_ms == 0.0


def test_report_add_passing_check():
    r = PreflightReport()
    r.add(CheckResult(name="a", passed=True, message="ok", duration_ms=5.0))
    assert r.passed is True
    assert len(r.checks) == 1
    assert r.total_duration_ms == 5.0


def test_report_add_failing_check_flips_passed():
    r = PreflightReport()
    r.add(CheckResult(name="a", passed=True, message="ok", duration_ms=5.0))
    r.add(CheckResult(name="b", passed=False, message="bad", duration_ms=3.0))
    assert r.passed is False
    assert len(r.checks) == 2
    assert r.total_duration_ms == 8.0


def test_report_stays_failed_after_subsequent_pass():
    """Once a report fails, subsequent passes do not undo it."""
    r = PreflightReport()
    r.add(CheckResult(name="fail", passed=False, message="bad"))
    r.add(CheckResult(name="pass", passed=True, message="ok"))
    assert r.passed is False


def test_report_to_dict():
    r = PreflightReport()
    r.add(CheckResult(name="a", passed=True, message="ok", duration_ms=10.123))
    d = r.to_dict()
    assert d["passed"] is True
    assert d["all_passed"] is True
    assert d["total_duration_ms"] == 10.1
    assert len(d["checks"]) == 1
    assert d["checks"][0]["name"] == "a"
    assert d["checks"][0]["passed"] is True
    assert d["checks"][0]["duration_ms"] == 10.1


def test_report_to_dict_failed():
    r = PreflightReport()
    r.add(CheckResult(name="x", passed=False, message="fail"))
    d = r.to_dict()
    assert d["passed"] is False
    assert d["all_passed"] is False


def test_report_summary_all_pass():
    r = PreflightReport()
    r.add(CheckResult(name="a", passed=True, message="ok", duration_ms=10))
    r.add(CheckResult(name="b", passed=True, message="ok", duration_ms=20))
    s = r.summary()
    assert "PASS" in s
    assert "2/2" in s


def test_report_summary_with_failure():
    r = PreflightReport()
    r.add(CheckResult(name="a", passed=True, message="ok"))
    r.add(CheckResult(name="b", passed=False, message="bad"))
    s = r.summary()
    assert "FAIL" in s
    assert "1/2" in s


def test_report_summary_empty():
    r = PreflightReport()
    s = r.summary()
    assert "PASS" in s
    assert "0/0" in s


# ---------------------------------------------------------------------------
# PreflightChecker — with mocked dependencies
# ---------------------------------------------------------------------------

def _make_config() -> EngineConfig:
    return EngineConfig(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
    )


def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=1, source_name="TestTable", source_schema="dbo",
        source_server="m3-db1", source_database="mes", datasource_id=4,
        connection_type="SQL", workspace_guid="ws", lakehouse_guid="lh",
        file_path="MES", file_name="TestTable.parquet", is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_checker(token_ok=True, db_ok=True, onelake_ok=True, source_ok=True):
    """Create a PreflightChecker with configurable mock outcomes."""
    from unittest.mock import patch as _patch

    token_provider = MagicMock()
    if token_ok:
        token_provider.validate.return_value = {"fabric_api": True, "onelake": True}
    else:
        token_provider.validate.return_value = {"fabric_api": False, "onelake": True}

    source_conn = MagicMock()
    source_conn.ping.return_value = source_ok

    loader = MagicMock()
    loader.ping.return_value = onelake_ok

    checker = PreflightChecker(
        config=_make_config(),
        token_provider=token_provider,
        source_conn=source_conn,
        loader=loader,
    )

    # Patch the SQLite DB check directly on the checker instance
    if db_ok:
        checker._check_metadata_db = lambda: __import__(
            "engine.preflight", fromlist=["CheckResult"]
        ).CheckResult(
            name="SQLite Control-Plane DB",
            passed=True,
            message="Readable — 100 active entities",
            duration_ms=1.0,
        )
    else:
        checker._check_metadata_db = lambda: __import__(
            "engine.preflight", fromlist=["CheckResult"]
        ).CheckResult(
            name="SQLite Control-Plane DB",
            passed=False,
            message="Cannot read — database not found",
            duration_ms=1.0,
        )

    return checker


# --- Token checks ---

def test_checker_all_pass_no_entities():
    checker = _make_checker()
    report = checker.run(entities=None)
    assert report.passed is True
    assert len(report.checks) == 4  # runtime, tokens, db, onelake


def test_checker_token_failure():
    checker = _make_checker(token_ok=False)
    report = checker.run()
    assert report.passed is False
    token_check = report.checks[0]
    assert token_check.name == "Service Principal Tokens"
    assert token_check.passed is False
    assert "fabric_api" in token_check.message


def test_checker_token_exception():
    """Token validation throws an exception."""
    checker = _make_checker()
    checker._token_provider.validate.side_effect = RuntimeError("network timeout")
    report = checker.run()
    assert report.passed is False
    assert "network timeout" in report.checks[0].message


# --- Metadata DB checks ---

def test_checker_db_failure():
    checker = _make_checker(db_ok=False)
    report = checker.run()
    assert report.passed is False
    db_check = report.checks[1]
    assert db_check.name == "SQLite Control-Plane DB"
    assert db_check.passed is False


def test_checker_db_pass():
    checker = _make_checker(db_ok=True)
    report = checker.run()
    db_check = report.checks[1]
    assert db_check.passed is True
    assert "Readable" in db_check.message


# --- OneLake checks ---

def test_checker_onelake_failure():
    checker = _make_checker(onelake_ok=False)
    report = checker.run()
    assert report.passed is False
    onelake_check = report.checks[2]
    assert onelake_check.name == "OneLake Storage"
    assert onelake_check.passed is False


def test_checker_onelake_pass():
    checker = _make_checker(onelake_ok=True)
    report = checker.run()
    onelake_check = report.checks[2]
    assert onelake_check.passed is True
    assert "Reachable" in onelake_check.message


# --- Entity sanity checks ---

def test_checker_entity_sanity_healthy():
    checker = _make_checker()
    entities = [_make_entity(id=i, source_name=f"Table{i}") for i in range(5)]
    report = checker.run(entities=entities)
    assert report.passed is True
    # 4 base checks + 1 entity sanity + 1 source server
    assert len(report.checks) == 6


def test_checker_entity_sanity_empty_list():
    checker = _make_checker()
    report = checker.run(entities=[])
    assert report.passed is False
    entity_check = [c for c in report.checks if c.name == "Entity Worklist"][0]
    assert "Empty" in entity_check.message


def test_checker_entity_sanity_blank_source_name():
    checker = _make_checker()
    entities = [
        _make_entity(id=1, source_name="Good"),
        _make_entity(id=2, source_name="   "),  # blank
        _make_entity(id=3, source_name=""),       # empty
    ]
    report = checker.run(entities=entities)
    assert report.passed is False
    entity_check = [c for c in report.checks if c.name == "Entity Worklist"][0]
    assert "blank SourceName" in entity_check.message
    assert "2" in entity_check.message  # 2 blanks


def test_checker_entity_sanity_no_server():
    checker = _make_checker()
    entities = [_make_entity(id=1, source_server="")]
    report = checker.run(entities=entities)
    assert report.passed is False
    entity_check = [c for c in report.checks if c.name == "Entity Worklist"][0]
    assert "no source_server" in entity_check.message


def test_checker_entity_sanity_inactive_warning():
    checker = _make_checker()
    entities = [
        _make_entity(id=1, is_active=True),
        _make_entity(id=2, is_active=False),
    ]
    report = checker.run(entities=entities)
    assert report.passed is False
    entity_check = [c for c in report.checks if c.name == "Entity Worklist"][0]
    assert "inactive" in entity_check.message


def test_checker_entity_sanity_incremental_count():
    checker = _make_checker()
    entities = [
        _make_entity(id=1, is_incremental=True),
        _make_entity(id=2, is_incremental=True),
        _make_entity(id=3, is_incremental=False),
    ]
    report = checker.run(entities=entities)
    entity_check = [c for c in report.checks if c.name == "Entity Worklist"][0]
    assert "2 incremental" in entity_check.message
    assert "1 full" in entity_check.message


# --- Source server checks ---

def test_checker_source_server_per_unique_pair():
    """Each unique (server, database) pair gets its own check."""
    checker = _make_checker()
    entities = [
        _make_entity(id=1, source_server="srv1", source_database="db1"),
        _make_entity(id=2, source_server="srv1", source_database="db1"),  # dupe
        _make_entity(id=3, source_server="srv2", source_database="db2"),
    ]
    report = checker.run(entities=entities)
    source_checks = [c for c in report.checks if c.name.startswith("Source:")]
    assert len(source_checks) == 2  # 2 unique (server, db) pairs


def test_checker_source_server_failure():
    checker = _make_checker(source_ok=False)
    entities = [_make_entity()]
    report = checker.run(entities=entities)
    assert report.passed is False
    source_check = [c for c in report.checks if c.name.startswith("Source:")][0]
    assert source_check.passed is False
    assert "VPN" in source_check.message


# --- Full run scenarios ---

def test_checker_all_pass_with_entities():
    checker = _make_checker()
    entities = [_make_entity(id=i, source_name=f"T{i}") for i in range(3)]
    report = checker.run(entities=entities)
    assert report.passed is True
    assert all(c.passed for c in report.checks)


def test_checker_multiple_failures():
    """Multiple subsystems failing produces multiple failed checks."""
    checker = _make_checker(token_ok=False, db_ok=False, onelake_ok=False)
    report = checker.run()
    assert report.passed is False
    failed = [c for c in report.checks if not c.passed]
    assert len(failed) == 3


def test_checker_report_has_timing():
    """All checks should record non-negative duration."""
    checker = _make_checker()
    report = checker.run()
    for c in report.checks:
        assert c.duration_ms >= 0
    assert report.total_duration_ms >= 0
