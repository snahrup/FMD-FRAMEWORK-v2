"""Regression guard: MetadataDB must NOT exist in engine.connections.

Task 13 of the FMD server refactor deleted MetadataDB from connections.py.
These tests confirm that SourceConnection and build_source_map survived intact.
"""


def test_no_metadata_db_class():
    import engine.connections as conn
    assert not hasattr(conn, "MetadataDB")


def test_source_connection_still_exists():
    from engine.connections import SourceConnection
    assert SourceConnection is not None


def test_build_source_map_still_exists():
    from engine.connections import build_source_map
    assert build_source_map is not None
