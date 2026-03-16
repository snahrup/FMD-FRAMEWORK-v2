"""Tests for Silver processor — SCD Type 2 change detection."""
import polars as pl
from datetime import datetime, timezone
from engine.silver_processor import detect_changes


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def test_detect_inserts():
    """New rows in incoming that don't exist in Silver."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1"],
        "IsCurrent": [True],
        "IsDeleted": [False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00")],
        "Name": ["Alice"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1", "pk2"],
        "HashedNonKeyColumns": ["h1", "h2"],
        "Name": ["Alice", "Bob"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(inserts) == 1
    assert inserts["HashedPKColumn"][0] == "pk2"
    assert len(updates_new) == 0
    assert len(deletes) == 0


def test_detect_updates():
    """Rows where content hash changed."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1_old"],
        "IsCurrent": [True],
        "IsDeleted": [False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00")],
        "Name": ["Alice"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1_new"],
        "Name": ["Alice Updated"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(inserts) == 0
    assert len(updates_new) == 1  # new version
    assert len(updates_old) == 1  # old version marked not current
    assert updates_old["IsCurrent"][0] == False
    assert updates_new["IsCurrent"][0] == True


def test_detect_soft_deletes():
    """Rows in Silver but missing from incoming → soft delete."""
    existing = pl.DataFrame({
        "HashedPKColumn": ["pk1", "pk2"],
        "HashedNonKeyColumns": ["h1", "h2"],
        "IsCurrent": [True, True],
        "IsDeleted": [False, False],
        "RecordStartDate": [_ts("2026-01-01T00:00:00"), _ts("2026-01-01T00:00:00")],
        "RecordEndDate": [_ts("9999-12-31T00:00:00"), _ts("9999-12-31T00:00:00")],
        "RecordModifiedDate": [_ts("2026-01-01T00:00:00"), _ts("2026-01-01T00:00:00")],
        "Name": ["Alice", "Bob"],
    })
    incoming = pl.DataFrame({
        "HashedPKColumn": ["pk1"],
        "HashedNonKeyColumns": ["h1"],
        "Name": ["Alice"],
    })
    inserts, updates_new, updates_old, deletes = detect_changes(existing, incoming)
    assert len(deletes) == 1
    assert deletes["HashedPKColumn"][0] == "pk2"
    assert deletes["IsDeleted"][0] == True
    assert deletes["IsCurrent"][0] == False
