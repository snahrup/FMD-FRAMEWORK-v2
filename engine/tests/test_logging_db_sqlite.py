"""Verify logging_db writes ONLY to SQLite, no Fabric SQL references."""
import inspect


def test_no_fabric_sql_references():
    import engine.logging_db as ldb
    source = inspect.getsource(ldb)
    # No stored procedure calls
    assert "sp_Upsert" not in source
    assert "sp_Audit" not in source
    assert "sp_Insert" not in source
    # No MetadataDB usage
    assert "MetadataDB" not in source
    assert "self._db.execute_proc" not in source
    assert "self._db.execute(" not in source  # MetadataDB.execute


def test_audit_logger_takes_no_metadata_db():
    from engine.logging_db import AuditLogger
    sig = inspect.signature(AuditLogger.__init__)
    params = list(sig.parameters.keys())
    assert "metadata_db" not in params
    assert "db" not in params or len(params) == 1  # only self
