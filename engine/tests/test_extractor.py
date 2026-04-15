"""Unit tests for engine/extractor.py — no network, no VPN required.

Tests cover:
  - _diagnose_error error classification
  - _compute_watermark logic
  - _rows_to_dataframe type handling
  - extract with empty source name
  - _BINARY_TYPE_NAMES constant
"""

import io
from unittest.mock import MagicMock, patch
import pytest
import polars as pl

from engine.extractor import DataExtractor, _BINARY_TYPE_NAMES
from engine.models import Entity, EngineConfig, RunResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entity(**overrides) -> Entity:
    defaults = dict(
        id=42, source_name="Orders", source_schema="dbo",
        source_server="m3-db1", source_database="mes", datasource_id=4,
        connection_type="SQL", workspace_guid="ws-guid",
        lakehouse_guid="lh-guid", file_path="MES",
        file_name="Orders.parquet", is_incremental=False,
    )
    defaults.update(overrides)
    return Entity(**defaults)


def _make_config() -> EngineConfig:
    return EngineConfig(
        sql_server="test-server", sql_database="test-db",
        sql_driver="ODBC Driver 18", tenant_id="t", client_id="c",
        client_secret="s", workspace_data_id="wd", workspace_code_id="wc",
        lz_lakehouse_id="lz", bronze_lakehouse_id="br", silver_lakehouse_id="sv",
        chunk_rows=1000,
    )


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestBinaryTypeNames:
    def test_timestamp_excluded(self):
        assert "timestamp" in _BINARY_TYPE_NAMES

    def test_rowversion_excluded(self):
        assert "rowversion" in _BINARY_TYPE_NAMES

    def test_binary_excluded(self):
        assert "binary" in _BINARY_TYPE_NAMES

    def test_varbinary_excluded(self):
        assert "varbinary" in _BINARY_TYPE_NAMES

    def test_image_excluded(self):
        assert "image" in _BINARY_TYPE_NAMES

    def test_datetime_not_excluded(self):
        assert "datetime" not in _BINARY_TYPE_NAMES


# ---------------------------------------------------------------------------
# _diagnose_error
# ---------------------------------------------------------------------------

class TestDiagnoseError:
    def test_connection_refused(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("could not open a connection to SQL Server", entity)
        assert "VPN" in msg

    def test_error_53(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("[53] something", entity)
        assert "VPN" in msg

    def test_login_failed(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("Login failed for user 'sa'", entity)
        assert "Trusted_Connection" in msg

    def test_invalid_object(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("Invalid object name 'dbo.FakeTable'", entity)
        assert "schema may have changed" in msg

    def test_invalid_column(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("Invalid column name 'FakeCol'", entity)
        assert "schema may have changed" in msg

    def test_timeout(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("Query timeout expired", entity)
        assert "index" in msg or "timeout" in msg.lower()

    def test_out_of_memory(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("System out of memory exception", entity)
        assert "chunk_rows" in msg

    def test_generic_error(self):
        entity = _make_entity()
        msg = DataExtractor._diagnose_error("Something unexpected", entity)
        assert "Orders" in msg  # qualified_name


# ---------------------------------------------------------------------------
# _compute_watermark
# ---------------------------------------------------------------------------

class TestComputeWatermark:
    def test_returns_none_for_non_incremental(self):
        entity = _make_entity(is_incremental=False)
        # polars is needed for this test
        try:
            import polars as pl
            df = pl.DataFrame({"ModifiedDate": ["2024-01-01", "2024-06-01"]})
            result = DataExtractor._compute_watermark(entity, df)
            assert result == entity.last_load_value
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

    def test_returns_max_for_incremental(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        entity = _make_entity(
            is_incremental=True,
            watermark_column="ModifiedDate",
            last_load_value="2024-01-01",
        )
        df = pl.DataFrame({"ModifiedDate": ["2024-03-01", "2024-06-15", "2024-02-01"]})
        result = DataExtractor._compute_watermark(entity, df)
        assert result == "2024-06-15"

    def test_returns_last_value_when_column_missing(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        entity = _make_entity(
            is_incremental=True,
            watermark_column="NonExistent",
            last_load_value="2024-01-01",
        )
        df = pl.DataFrame({"OtherCol": [1, 2, 3]})
        result = DataExtractor._compute_watermark(entity, df)
        assert result == "2024-01-01"

    def test_returns_last_value_when_no_watermark_column(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        entity = _make_entity(
            is_incremental=True,
            watermark_column=None,
        )
        df = pl.DataFrame({"Col": [1]})
        result = DataExtractor._compute_watermark(entity, df)
        assert result == entity.last_load_value


# ---------------------------------------------------------------------------
# _rows_to_dataframe
# ---------------------------------------------------------------------------

class TestRowsToDataframe:
    def test_basic_conversion(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        col_names = ["id", "name"]
        rows = [(1, "Alice"), (2, "Bob")]
        df = DataExtractor._rows_to_dataframe(col_names, rows)

        assert len(df) == 2
        assert df.columns == ["id", "name"]
        assert df["id"].to_list() == [1, 2]
        assert df["name"].to_list() == ["Alice", "Bob"]

    def test_handles_none_values(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        col_names = ["id", "value"]
        rows = [(1, None), (2, "hello")]
        df = DataExtractor._rows_to_dataframe(col_names, rows)
        assert len(df) == 2

    def test_handles_empty_rows(self):
        try:
            import polars as pl
        except ImportError:
            pytest.skip("polars not installed")  # Expected — optional dependency

        col_names = ["id"]
        rows = []
        df = DataExtractor._rows_to_dataframe(col_names, rows)
        assert len(df) == 0
        assert df.columns == ["id"]


# ---------------------------------------------------------------------------
# extract — blank source name
# ---------------------------------------------------------------------------

class TestExtractBlankSourceName:
    def test_fails_with_blank_name(self):
        config = _make_config()
        source = MagicMock()
        extractor = DataExtractor(config, source)
        entity = _make_entity(source_name="   ")

        parquet_bytes, result = extractor.extract(entity, "run-1")

        assert parquet_bytes is None
        assert result.status == "failed"
        assert "Empty SourceName" in result.error


class TestWatermarkRecovery:
    def test_connectorx_retries_without_watermark_on_datetime_conversion(self):
        config = _make_config()
        source = MagicMock()
        source.build_connectorx_uri.return_value = "mssql://test"
        extractor = DataExtractor(config, source)
        entity = _make_entity(
            is_incremental=True,
            watermark_column="crt_dt",
            last_load_value="480",
        )

        recovered = pl.DataFrame({"crt_dt": ["2026-04-13 00:00:00"], "id": [1]})

        with patch("engine.extractor.HAS_CONNECTORX", True), \
             patch.object(extractor._config, "use_connectorx", True), \
             patch("engine.extractor.cx.read_sql", side_effect=[
                 Exception("Conversion failed when converting date and/or time from character string. code: 241"),
                 recovered,
             ]):
            parquet_bytes, result = extractor.extract(entity, "run-1")

        assert parquet_bytes is not None
        assert result.status == "succeeded"
        assert result.rows_read == 1
        assert result.watermark_after == "2026-04-13 00:00:00"

    def test_connectorx_falls_back_to_pyodbc_on_transient_wire_error(self):
        config = _make_config()
        source = MagicMock()
        source.build_connectorx_uri.return_value = "mssql://test"
        extractor = DataExtractor(config, source)
        entity = _make_entity()
        expected = (
            b"parquet-bytes",
            RunResult(entity_id=entity.id, layer="landing", status="succeeded", rows_read=5, rows_written=5),
        )

        with patch("engine.extractor.HAS_CONNECTORX", True), \
             patch.object(extractor._config, "use_connectorx", True), \
             patch("engine.extractor.cx.read_sql", side_effect=Exception(
                 "called `Result::unwrap()` on an `Err` value: Io { kind: UnexpectedEof, message: \"No more packets in the wire\" } (os error 10054)"
             )), \
             patch.object(extractor, "_extract_pyodbc", return_value=expected) as pyodbc_fallback:
            parquet_bytes, result = extractor.extract(entity, "run-1")

        assert parquet_bytes == b"parquet-bytes"
        assert result.status == "succeeded"
        pyodbc_fallback.assert_called_once_with(
            entity,
            "run-1",
            _allow_watermark_retry=True,
        )

    def test_fails_with_empty_name(self):
        config = _make_config()
        source = MagicMock()
        extractor = DataExtractor(config, source)
        entity = _make_entity(source_name="")

        parquet_bytes, result = extractor.extract(entity, "run-1")

        assert parquet_bytes is None
        assert result.status == "failed"


class TestPyodbcPath:
    def test_pyodbc_path_handles_empty_result_without_nameerror(self):
        config = _make_config()
        config.use_connectorx = False
        source = MagicMock()
        extractor = DataExtractor(config, source)
        entity = _make_entity(source_name="Orders")

        cursor = MagicMock()
        cursor.description = None
        conn = MagicMock()
        conn.cursor.return_value = cursor

        cm = MagicMock()
        cm.__enter__.return_value = conn
        cm.__exit__.return_value = None
        source.connect.return_value = cm

        parquet_bytes, result = extractor.extract(entity, "run-1")

        assert parquet_bytes is None
        assert result.status == "succeeded"
        assert result.extraction_method == "pyodbc"
        cursor.execute.assert_called_once()
