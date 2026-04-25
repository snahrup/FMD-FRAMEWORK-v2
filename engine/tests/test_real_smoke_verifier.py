"""Tests for the real smoke-load receipt verifier.

Uses only stdlib test infrastructure so the verifier contract can be checked
even when the broader pytest environment is unavailable on a workstation.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.verify_real_smoke_load import verify  # noqa: E402


def _write_silver_delta_log(delta_dir: Path) -> None:
    log_dir = delta_dir / "_delta_log"
    log_dir.mkdir(parents=True)
    metadata = {
        "metaData": {
            "schemaString": json.dumps({
                "type": "struct",
                "fields": [
                    {"name": "HashedPKColumn", "type": "string"},
                    {"name": "IsCurrent", "type": "boolean"},
                    {"name": "RecordStartDate", "type": "timestamp_ntz"},
                    {"name": "RecordEndDate", "type": "timestamp_ntz"},
                    {"name": "RecordModifiedDate", "type": "timestamp_ntz"},
                    {"name": "IsDeleted", "type": "boolean"},
                ],
            })
        }
    }
    (log_dir / "00000000000000000000.json").write_text(json.dumps(metadata) + "\n", encoding="utf-8")


def _write_delta_log(delta_dir: Path) -> None:
    (delta_dir / "_delta_log").mkdir(parents=True)
    (delta_dir / "_delta_log" / "00000000000000000000.json").write_text("{}\n", encoding="utf-8")


def _create_db(db_path: Path, *, dagster_path: bool = False) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(
            """
            CREATE TABLE engine_runs (
                RunId TEXT PRIMARY KEY,
                Status TEXT,
                Layers TEXT,
                EntityFilter TEXT,
                StartedAt TEXT,
                EndedAt TEXT,
                FailedEntities INTEGER DEFAULT 0,
                ErrorSummary TEXT
            );
            CREATE TABLE engine_task_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                RunId TEXT,
                EntityId INTEGER,
                Layer TEXT,
                Status TEXT,
                RowsRead INTEGER DEFAULT 0,
                RowsWritten INTEGER DEFAULT 0,
                BytesTransferred INTEGER DEFAULT 0,
                TargetLakehouse TEXT,
                TargetPath TEXT,
                LoadType TEXT,
                ExtractionMethod TEXT,
                ErrorMessage TEXT,
                created_at TEXT DEFAULT '2026-04-25T00:00:00Z'
            );
            CREATE TABLE lz_entities (
                LandingzoneEntityId INTEGER PRIMARY KEY,
                SourceSchema TEXT,
                SourceName TEXT,
                IsActive INTEGER,
                DataSourceId INTEGER
            );
            CREATE TABLE datasources (
                DataSourceId INTEGER PRIMARY KEY,
                DisplayName TEXT,
                Name TEXT,
                Namespace TEXT
            );
            CREATE TABLE bronze_entities (
                BronzeLayerEntityId INTEGER PRIMARY KEY,
                LandingzoneEntityId INTEGER,
                IsActive INTEGER
            );
            CREATE TABLE silver_entities (
                SilverLayerEntityId INTEGER PRIMARY KEY,
                BronzeLayerEntityId INTEGER,
                IsActive INTEGER
            );
            CREATE TABLE lakehouses (
                LakehouseGuid TEXT,
                Name TEXT
            );
            """
        )
        conn.execute(
            "INSERT INTO engine_runs (RunId, Status, Layers, EntityFilter) VALUES (?, ?, ?, ?)",
            ("run-001", "Succeeded", "landing,bronze,silver", "599"),
        )
        conn.execute(
            "INSERT INTO lz_entities VALUES (?, ?, ?, ?, ?)",
            (599, "dbo", "alel_lab_batch_hdr_tbl", 1, 10),
        )
        conn.execute("INSERT INTO datasources VALUES (?, ?, ?, ?)", (10, "MES", "MES", "MES"))
        conn.execute("INSERT INTO bronze_entities VALUES (?, ?, ?)", (7001, 599, 1))
        conn.execute("INSERT INTO silver_entities VALUES (?, ?, ?)", (8001, 7001, 1))
        conn.executemany(
            "INSERT INTO lakehouses VALUES (?, ?)",
            [
                ("LZ-GUID", "LH_DATA_LANDINGZONE"),
                ("BRONZE-GUID", "LH_BRONZE_LAYER"),
                ("SILVER-GUID", "LH_SILVER_LAYER"),
            ],
        )
        landing_path = "dagster://run-001/landing/599" if dagster_path else "LZ-GUID/Files/MES/alel_lab_batch_hdr_tbl.parquet"
        conn.executemany(
            """
            INSERT INTO engine_task_log (
                RunId, EntityId, Layer, Status, RowsRead, RowsWritten,
                BytesTransferred, TargetPath, LoadType, ExtractionMethod
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("run-001", 599, "landing", "succeeded", 5, 5, 512, landing_path, "full", "pyodbc"),
                ("run-001", 599, "bronze", "succeeded", 5, 5, 0, "BRONZE-GUID/Tables/MES/alel_lab_batch_hdr_tbl", "full", "local"),
                ("run-001", 599, "silver", "succeeded", 5, 5, 0, "SILVER-GUID/Tables/MES/alel_lab_batch_hdr_tbl", "full", "local"),
            ],
        )
        conn.commit()
    finally:
        conn.close()


class RealSmokeVerifierTests(unittest.TestCase):
    def test_accepts_landing_entity_id_for_all_layer_task_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            db_path = root / "fmd_control_plane.db"
            mount = root / "OneLake"
            _create_db(db_path)
            landing = mount / "LH_DATA_LANDINGZONE.Lakehouse" / "Files" / "MES" / "alel_lab_batch_hdr_tbl.parquet"
            landing.parent.mkdir(parents=True)
            landing.write_bytes(b"parquet")
            _write_delta_log(mount / "LH_BRONZE_LAYER.Lakehouse" / "Tables" / "MES" / "alel_lab_batch_hdr_tbl")
            _write_silver_delta_log(mount / "LH_SILVER_LAYER.Lakehouse" / "Tables" / "MES" / "alel_lab_batch_hdr_tbl")

            receipt = verify(argparse.Namespace(
                run_id="run-001",
                entity_id=599,
                layers=["landing", "bronze", "silver"],
                db_path=str(db_path),
                config_path=str(root / "missing-config.json"),
                onelake_mount=str(mount),
                allow_unverified_artifacts=False,
            ))

        self.assertTrue(receipt["ok"], json.dumps(receipt, indent=2))

    def test_rejects_dagster_receipt_path_as_physical_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            db_path = root / "fmd_control_plane.db"
            mount = root / "OneLake"
            _create_db(db_path, dagster_path=True)
            _write_delta_log(mount / "LH_BRONZE_LAYER.Lakehouse" / "Tables" / "MES" / "alel_lab_batch_hdr_tbl")
            _write_silver_delta_log(mount / "LH_SILVER_LAYER.Lakehouse" / "Tables" / "MES" / "alel_lab_batch_hdr_tbl")

            receipt = verify(argparse.Namespace(
                run_id="run-001",
                entity_id=599,
                layers=["landing", "bronze", "silver"],
                db_path=str(db_path),
                config_path=str(root / "missing-config.json"),
                onelake_mount=str(mount),
                allow_unverified_artifacts=False,
            ))

        self.assertFalse(receipt["ok"])
        self.assertIn("Dagster orchestration receipt", json.dumps(receipt))


if __name__ == "__main__":
    unittest.main()
