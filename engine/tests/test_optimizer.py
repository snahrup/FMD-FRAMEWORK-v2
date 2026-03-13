"""Unit tests for engine/optimizer.py — no network, no VPN, no database required.

Tests cover:
  - Watermark priority scoring (all patterns + edge cases)
  - PK formatting and parsing
  - Watermark row parsing and binary type exclusion
  - Entity classification (incremental vs full load)
  - Batch optimization
  - SQL query generation
"""

import pytest
from engine.optimizer import (
    WatermarkCandidate,
    OptimizationResult,
    OptimizationSummary,
    build_pk_query,
    build_watermark_query,
    score_watermark_column,
    format_primary_keys,
    parse_pk_rows,
    parse_watermark_rows,
    classify_entity,
    optimize_entities,
    MAX_INCREMENTAL_PRIORITY,
    DATETIME_TYPES,
    BINARY_WATERMARK_TYPES,
)


# ---------------------------------------------------------------------------
# score_watermark_column
# ---------------------------------------------------------------------------

class TestScoreWatermarkColumn:
    """Test the priority scoring logic for watermark candidates."""

    def test_modified_datetime_is_priority_2(self):
        assert score_watermark_column("ModifiedDate", "datetime2", False) == 2

    def test_updated_datetime_is_priority_2(self):
        assert score_watermark_column("LastUpdatedAt", "datetime", False) == 2

    def test_changed_datetime_is_priority_2(self):
        assert score_watermark_column("ChangedTimestamp", "datetime2", False) == 2

    def test_last_underscore_datetime_is_priority_2(self):
        assert score_watermark_column("last_modified", "datetime", False) == 2

    def test_created_datetime_is_priority_3(self):
        assert score_watermark_column("CreatedDate", "datetime", False) == 3

    def test_inserted_datetime_is_priority_3(self):
        assert score_watermark_column("InsertedAt", "datetime2", False) == 3

    def test_added_datetime_is_priority_3(self):
        assert score_watermark_column("DateAdded", "smalldatetime", False) == 3

    def test_identity_column_is_priority_4(self):
        assert score_watermark_column("Id", "int", True) == 4

    def test_generic_datetime_is_priority_5(self):
        assert score_watermark_column("SomeDate", "datetime", False) == 5

    def test_datetimeoffset_works(self):
        assert score_watermark_column("ModifiedAt", "datetimeoffset", False) == 2

    def test_smalldatetime_works(self):
        assert score_watermark_column("UpdatedOn", "smalldatetime", False) == 2

    def test_rowversion_returns_none(self):
        assert score_watermark_column("RowVer", "rowversion", False) is None

    def test_timestamp_returns_none(self):
        assert score_watermark_column("rec_timestamp", "timestamp", False) is None

    def test_case_insensitive_type(self):
        assert score_watermark_column("ModifiedDate", "DateTime2", False) == 2

    def test_case_insensitive_column_name(self):
        assert score_watermark_column("MODIFIEDDATE", "datetime", False) == 2

    def test_whitespace_in_type(self):
        assert score_watermark_column("Col", " timestamp ", False) is None

    def test_non_datetime_non_identity_gets_priority_6(self):
        assert score_watermark_column("SomeCol", "varchar", False) == 6


# ---------------------------------------------------------------------------
# WatermarkCandidate
# ---------------------------------------------------------------------------

class TestWatermarkCandidate:
    def test_qualifies_at_priority_2(self):
        c = WatermarkCandidate("ModifiedDate", "datetime2", 2)
        assert c.qualifies_as_incremental is True

    def test_qualifies_at_priority_3(self):
        c = WatermarkCandidate("CreatedDate", "datetime", 3)
        assert c.qualifies_as_incremental is True

    def test_qualifies_at_priority_4(self):
        c = WatermarkCandidate("Id", "int", 4, is_identity=True)
        assert c.qualifies_as_incremental is True

    def test_does_not_qualify_at_priority_5(self):
        c = WatermarkCandidate("SomeDate", "datetime", 5)
        assert c.qualifies_as_incremental is False


# ---------------------------------------------------------------------------
# format_primary_keys
# ---------------------------------------------------------------------------

class TestFormatPrimaryKeys:
    def test_single_column(self):
        assert format_primary_keys(["OrderId"]) == "OrderId"

    def test_composite_key(self):
        assert format_primary_keys(["OrderId", "LineNumber"]) == "OrderId,LineNumber"

    def test_strips_whitespace(self):
        assert format_primary_keys(["  Id  ", " Code "]) == "Id,Code"

    def test_empty_list(self):
        assert format_primary_keys([]) == ""

    def test_skips_blank_strings(self):
        assert format_primary_keys(["Id", "", "  ", "Code"]) == "Id,Code"


# ---------------------------------------------------------------------------
# parse_pk_rows
# ---------------------------------------------------------------------------

class TestParsePkRows:
    def test_single_table_single_pk(self):
        rows = [("dbo", "Orders", "OrderId")]
        result = parse_pk_rows(rows)
        assert result == {("dbo", "Orders"): ["OrderId"]}

    def test_composite_pk_preserves_order(self):
        rows = [
            ("dbo", "OrderLines", "OrderId"),
            ("dbo", "OrderLines", "LineNumber"),
        ]
        result = parse_pk_rows(rows)
        assert result[("dbo", "OrderLines")] == ["OrderId", "LineNumber"]

    def test_multiple_tables(self):
        rows = [
            ("dbo", "Orders", "OrderId"),
            ("dbo", "Products", "ProductId"),
            ("sales", "Invoices", "InvoiceId"),
        ]
        result = parse_pk_rows(rows)
        assert len(result) == 3
        assert result[("dbo", "Orders")] == ["OrderId"]
        assert result[("sales", "Invoices")] == ["InvoiceId"]

    def test_empty_input(self):
        assert parse_pk_rows([]) == {}


# ---------------------------------------------------------------------------
# parse_watermark_rows
# ---------------------------------------------------------------------------

class TestParseWatermarkRows:
    def test_basic_datetime_column(self):
        rows = [("dbo", "Orders", "ModifiedDate", "datetime2", 0)]
        result = parse_watermark_rows(rows)
        assert ("dbo", "Orders") in result
        assert len(result[("dbo", "Orders")]) == 1
        c = result[("dbo", "Orders")][0]
        assert c.column == "ModifiedDate"
        assert c.priority == 2

    def test_skips_rowversion(self):
        rows = [("dbo", "Orders", "RowVer", "rowversion", 0)]
        result = parse_watermark_rows(rows)
        assert ("dbo", "Orders") not in result

    def test_skips_timestamp(self):
        rows = [("dbo", "Orders", "rec_timestamp", "timestamp", 0)]
        result = parse_watermark_rows(rows)
        assert ("dbo", "Orders") not in result

    def test_sorts_by_priority(self):
        rows = [
            ("dbo", "T", "SomeDate", "datetime", 0),       # priority 5
            ("dbo", "T", "CreatedDate", "datetime", 0),     # priority 3
            ("dbo", "T", "ModifiedDate", "datetime2", 0),   # priority 2
        ]
        result = parse_watermark_rows(rows)
        candidates = result[("dbo", "T")]
        assert candidates[0].priority == 2
        assert candidates[1].priority == 3
        assert candidates[2].priority == 5

    def test_identity_column_included(self):
        rows = [("dbo", "Orders", "Id", "int", 1)]
        result = parse_watermark_rows(rows)
        c = result[("dbo", "Orders")][0]
        assert c.is_identity is True
        assert c.priority == 4

    def test_mixed_valid_and_binary(self):
        rows = [
            ("dbo", "T", "RowVer", "rowversion", 0),          # skip
            ("dbo", "T", "ModifiedDate", "datetime2", 0),     # keep
            ("dbo", "T", "rec_timestamp", "timestamp", 0),    # skip
        ]
        result = parse_watermark_rows(rows)
        assert len(result[("dbo", "T")]) == 1
        assert result[("dbo", "T")][0].column == "ModifiedDate"

    def test_empty_input(self):
        assert parse_watermark_rows([]) == {}


# ---------------------------------------------------------------------------
# classify_entity
# ---------------------------------------------------------------------------

class TestClassifyEntity:
    def test_full_load_no_metadata(self):
        result = classify_entity(1, "dbo", "Orders")
        assert result.is_incremental is False
        assert result.primary_keys is None
        assert result.watermark_column is None

    def test_incremental_with_modified_column(self):
        result = classify_entity(
            entity_id=42,
            schema="dbo",
            table="Orders",
            pk_columns=["OrderId"],
            watermark_candidates=[
                {"column": "ModifiedDate", "type": "datetime2", "is_identity": False},
            ],
        )
        assert result.is_incremental is True
        assert result.watermark_column == "ModifiedDate"
        assert result.watermark_type == "datetime2"
        assert result.watermark_priority == 2
        assert result.primary_keys == "OrderId"

    def test_incremental_with_created_column(self):
        result = classify_entity(
            entity_id=10,
            schema="dbo",
            table="AuditLog",
            watermark_candidates=[
                {"column": "CreatedAt", "type": "datetime", "is_identity": False},
            ],
        )
        assert result.is_incremental is True
        assert result.watermark_column == "CreatedAt"
        assert result.watermark_priority == 3

    def test_full_load_with_only_generic_datetime(self):
        """A generic datetime (priority 5) should NOT trigger incremental."""
        result = classify_entity(
            entity_id=10,
            schema="dbo",
            table="Config",
            watermark_candidates=[
                {"column": "SomeDate", "type": "datetime", "is_identity": False},
            ],
        )
        assert result.is_incremental is False
        assert result.watermark_column is None
        assert len(result.candidates) == 1

    def test_incremental_load_with_identity(self):
        """An identity column (priority 4) should trigger incremental (MAX_INCREMENTAL_PRIORITY=4)."""
        result = classify_entity(
            entity_id=10,
            schema="dbo",
            table="Config",
            watermark_candidates=[
                {"column": "Id", "type": "int", "is_identity": True},
            ],
        )
        assert result.is_incremental is True
        assert result.watermark_column == "Id"

    def test_best_watermark_wins(self):
        """When multiple candidates exist, the best priority wins."""
        result = classify_entity(
            entity_id=99,
            schema="dbo",
            table="BigTable",
            watermark_candidates=[
                {"column": "SomeDate", "type": "datetime", "is_identity": False},       # pri 5
                {"column": "CreatedDate", "type": "datetime", "is_identity": False},     # pri 3
                {"column": "ModifiedDate", "type": "datetime2", "is_identity": False},   # pri 2
            ],
        )
        assert result.is_incremental is True
        assert result.watermark_column == "ModifiedDate"
        assert result.watermark_priority == 2

    def test_binary_types_excluded(self):
        """Rowversion and timestamp columns should be ignored entirely."""
        result = classify_entity(
            entity_id=7,
            schema="dbo",
            table="Parts",
            watermark_candidates=[
                {"column": "RowVer", "type": "rowversion", "is_identity": False},
                {"column": "rec_timestamp", "type": "timestamp", "is_identity": False},
            ],
        )
        assert result.is_incremental is False
        assert result.watermark_column is None
        assert len(result.candidates) == 0

    def test_binary_excluded_but_good_candidate_remains(self):
        result = classify_entity(
            entity_id=7,
            schema="dbo",
            table="Parts",
            watermark_candidates=[
                {"column": "RowVer", "type": "rowversion", "is_identity": False},
                {"column": "ModifiedAt", "type": "datetime2", "is_identity": False},
            ],
        )
        assert result.is_incremental is True
        assert result.watermark_column == "ModifiedAt"
        assert len(result.candidates) == 1  # Binary excluded

    def test_composite_pk(self):
        result = classify_entity(
            entity_id=5,
            schema="dbo",
            table="OrderLines",
            pk_columns=["OrderId", "LineNumber"],
        )
        assert result.primary_keys == "OrderId,LineNumber"

    def test_has_primary_keys_property(self):
        r1 = classify_entity(1, "dbo", "T", pk_columns=["Id"])
        r2 = classify_entity(2, "dbo", "T")
        assert r1.has_primary_keys is True
        assert r2.has_primary_keys is False

    def test_to_dict_roundtrip(self):
        result = classify_entity(
            entity_id=42,
            schema="dbo",
            table="Orders",
            pk_columns=["OrderId"],
            watermark_candidates=[
                {"column": "ModifiedDate", "type": "datetime2", "is_identity": False},
            ],
        )
        d = result.to_dict()
        assert d["id"] == 42
        assert d["schema"] == "dbo"
        assert d["name"] == "Orders"
        assert d["primary_keys"] == "OrderId"
        assert d["watermark_col"] == "ModifiedDate"
        assert d["is_incremental"] is True
        assert len(d["watermark_candidates"]) == 1


# ---------------------------------------------------------------------------
# optimize_entities (batch)
# ---------------------------------------------------------------------------

class TestOptimizeEntities:
    def _make_entities(self):
        return [
            {"id": 1, "schema": "dbo", "table": "Orders"},
            {"id": 2, "schema": "dbo", "table": "Products"},
            {"id": 3, "schema": "dbo", "table": "Config"},
            {"id": 4, "schema": "dbo", "table": "AuditLog"},
        ]

    def _make_pk_map(self):
        return parse_pk_rows([
            ("dbo", "Orders", "OrderId"),
            ("dbo", "Products", "ProductId"),
            ("dbo", "AuditLog", "LogId"),
        ])

    def _make_wm_map(self):
        return parse_watermark_rows([
            ("dbo", "Orders", "ModifiedDate", "datetime2", 0),
            ("dbo", "Orders", "CreatedDate", "datetime", 0),
            ("dbo", "Products", "SomeDate", "datetime", 0),
            ("dbo", "AuditLog", "CreatedAt", "datetime", 0),
            ("dbo", "AuditLog", "rec_timestamp", "timestamp", 0),  # should be excluded
        ])

    def test_batch_counts(self):
        entities = self._make_entities()
        pk_map = self._make_pk_map()
        wm_map = self._make_wm_map()
        summary = optimize_entities(entities, pk_map, wm_map)

        assert summary.total_entities == 4
        assert summary.entities_with_pks == 3  # Orders, Products, AuditLog
        assert summary.entities_incremental == 2  # Orders (ModifiedDate), AuditLog (CreatedAt)
        assert summary.entities_full_load == 2  # Products (generic datetime), Config (nothing)

    def test_individual_results(self):
        entities = self._make_entities()
        pk_map = self._make_pk_map()
        wm_map = self._make_wm_map()
        summary = optimize_entities(entities, pk_map, wm_map)

        by_id = {r.entity_id: r for r in summary.results}

        # Orders: has PK + ModifiedDate (priority 2) → incremental
        assert by_id[1].is_incremental is True
        assert by_id[1].watermark_column == "ModifiedDate"
        assert by_id[1].primary_keys == "OrderId"

        # Products: has PK but only generic datetime (priority 5) → full
        assert by_id[2].is_incremental is False
        assert by_id[2].primary_keys == "ProductId"

        # Config: no PK, no watermark → full
        assert by_id[3].is_incremental is False
        assert by_id[3].primary_keys is None

        # AuditLog: has PK + CreatedAt (priority 3) → incremental
        # (timestamp column excluded)
        assert by_id[4].is_incremental is True
        assert by_id[4].watermark_column == "CreatedAt"

    def test_empty_entities(self):
        summary = optimize_entities([], {}, {})
        assert summary.total_entities == 0
        assert summary.entities_incremental == 0
        assert len(summary.results) == 0

    def test_to_dict(self):
        entities = [{"id": 1, "schema": "dbo", "table": "T"}]
        summary = optimize_entities(entities, {}, {})
        d = summary.to_dict()
        assert d["total_entities"] == 1
        assert len(d["results"]) == 1


# ---------------------------------------------------------------------------
# SQL query generation
# ---------------------------------------------------------------------------

class TestSqlGeneration:
    def test_pk_query_contains_sys_indexes(self):
        sql = build_pk_query()
        assert "sys.indexes" in sql
        assert "is_primary_key = 1" in sql

    def test_pk_query_orders_by_key_ordinal(self):
        sql = build_pk_query()
        assert "key_ordinal" in sql

    def test_watermark_query_contains_datetime_types(self):
        sql = build_watermark_query()
        assert "datetime" in sql
        assert "datetime2" in sql
        assert "datetimeoffset" in sql
        assert "smalldatetime" in sql

    def test_watermark_query_checks_identity(self):
        sql = build_watermark_query()
        assert "IsIdentity" in sql

    def test_pk_query_returns_string(self):
        assert isinstance(build_pk_query(), str)

    def test_watermark_query_returns_string(self):
        assert isinstance(build_watermark_query(), str)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_max_incremental_priority_is_4(self):
        assert MAX_INCREMENTAL_PRIORITY == 4

    def test_datetime_types_complete(self):
        assert "datetime" in DATETIME_TYPES
        assert "datetime2" in DATETIME_TYPES
        assert "datetimeoffset" in DATETIME_TYPES
        assert "smalldatetime" in DATETIME_TYPES

    def test_binary_types_excluded(self):
        assert "timestamp" in BINARY_WATERMARK_TYPES
        assert "rowversion" in BINARY_WATERMARK_TYPES


# ---------------------------------------------------------------------------
# Edge cases and regression tests
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_empty_watermark_candidates_list(self):
        result = classify_entity(1, "dbo", "T", watermark_candidates=[])
        assert result.is_incremental is False
        assert result.candidates == []

    def test_none_watermark_candidates(self):
        result = classify_entity(1, "dbo", "T", watermark_candidates=None)
        assert result.is_incremental is False

    def test_empty_pk_columns(self):
        result = classify_entity(1, "dbo", "T", pk_columns=[])
        assert result.primary_keys is None  # Empty list → no PKs

    def test_none_pk_columns(self):
        result = classify_entity(1, "dbo", "T", pk_columns=None)
        assert result.primary_keys is None

    def test_all_binary_watermarks_means_full_load(self):
        """If every watermark candidate is binary, entity should be full load."""
        result = classify_entity(
            entity_id=187,
            schema="dbo",
            table="SomeTable",
            watermark_candidates=[
                {"column": "TS", "type": "timestamp", "is_identity": False},
                {"column": "RV", "type": "rowversion", "is_identity": False},
            ],
        )
        assert result.is_incremental is False
        assert len(result.candidates) == 0

    def test_watermark_candidate_dict_missing_is_identity(self):
        """is_identity key missing should default to False."""
        result = classify_entity(
            entity_id=1,
            schema="dbo",
            table="T",
            watermark_candidates=[{"column": "ModifiedDate", "type": "datetime2"}],
        )
        assert result.is_incremental is True
        assert result.candidates[0].is_identity is False

    def test_format_primary_keys_preserves_ordinal(self):
        """Column order must be preserved (reflects key_ordinal from sys.indexes)."""
        assert format_primary_keys(["B", "A", "C"]) == "B,A,C"
