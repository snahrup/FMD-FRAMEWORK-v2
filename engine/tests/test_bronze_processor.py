"""Tests for bronze processor — hash + dedup + merge logic."""
import polars as pl
from engine.bronze_processor import hash_pk_columns, hash_non_key_columns, deduplicate


def test_hash_pk_columns_single():
    df = pl.DataFrame({"ID": [1, 2, 3], "Name": ["A", "B", "C"]})
    result = hash_pk_columns(df, ["ID"])
    assert "HashedPKColumn" in result.columns
    assert result["HashedPKColumn"].n_unique() == 3


def test_hash_pk_columns_composite():
    df = pl.DataFrame({"K1": [1, 1, 2], "K2": ["a", "b", "a"], "Val": [10, 20, 30]})
    result = hash_pk_columns(df, ["K1", "K2"])
    assert result["HashedPKColumn"].n_unique() == 3


def test_hash_pk_columns_no_pks_uses_all():
    """When no PKs specified, hash all columns."""
    df = pl.DataFrame({"A": [1, 2], "B": ["x", "y"]})
    result = hash_pk_columns(df, [])
    assert "HashedPKColumn" in result.columns
    assert result["HashedPKColumn"].n_unique() == 2


def test_deduplicate():
    df = pl.DataFrame({
        "HashedPKColumn": ["abc", "abc", "def"],
        "Val": [1, 2, 3],
    })
    result = deduplicate(df)
    assert len(result) == 2


def test_hash_non_key_columns():
    df = pl.DataFrame({
        "ID": [1, 2],
        "HashedPKColumn": ["h1", "h2"],
        "Name": ["A", "B"],
        "Val": [10, 20],
    })
    result = hash_non_key_columns(df, ["ID"])
    assert "HashedNonKeyColumns" in result.columns
    assert result["HashedNonKeyColumns"].n_unique() == 2
