"""Tests for OneLake I/O Delta recovery helpers."""

from engine.onelake_io import _should_reset_delta_table


def test_should_reset_delta_table_only_for_overwrite_protocol_failures():
    assert _should_reset_delta_table(Exception("Invalid table version: 1"), "overwrite") is True
    assert _should_reset_delta_table(Exception("unsupported reader version"), "overwrite") is True
    assert _should_reset_delta_table(Exception("Invalid table version: 1"), "append") is False
    assert _should_reset_delta_table(Exception("permission denied"), "overwrite") is False
