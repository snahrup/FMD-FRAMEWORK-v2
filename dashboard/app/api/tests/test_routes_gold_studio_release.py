import json
import sqlite3

import pytest

import dashboard.app.api.control_plane_db as cpdb
from dashboard.app.api.routes import gold_studio as routes


@pytest.fixture(autouse=True)
def temp_gold_release_db(tmp_path):
    db_path = tmp_path / "gold_release.db"
    original_path = cpdb.DB_PATH
    cpdb.DB_PATH = db_path
    cpdb.init_db()
    _seed_release_review(db_path)
    yield db_path
    cpdb.DB_PATH = original_path


def _seed_release_review(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        INSERT INTO gs_specimens (id, name, type, source_class, division, source_system, steward, job_state)
        VALUES
          (1, 'Executive Sales.pbix', 'pbix', 'structural', 'Finance', 'ERP', 'Alex', 'extracted'),
          (2, 'Margin Model.sql', 'sql', 'structural', 'Finance', 'ERP', 'Alex', 'extracted'),
          (3, 'Mapping Notes.xlsx', 'excel', 'supporting', 'Finance', 'Finance', 'Alex', 'accepted');

        INSERT INTO gs_extracted_entities (id, specimen_id, entity_name, schema_name, source_database, source_system, canonical_root_id)
        VALUES
          (1, 1, 'SalesFact', 'dbo', 'ERP', 'ERP', 100),
          (2, 2, 'LegacyMargin', 'dbo', 'ERP', 'ERP', NULL),
          (3, 2, 'CustomerDim', 'dbo', 'ERP', 'ERP', 200),
          (4, 2, 'CalendarTable', 'dbo', 'ERP', 'ERP', 300);

        INSERT INTO gs_canonical_entities (
          id, root_id, version, is_current, name, business_description, domain,
          entity_type, grain, business_keys, steward, source_systems, status
        )
        VALUES
          (11, 100, 1, 1, 'Sales', 'Published sales fact for finance reporting', 'Finance', 'fact', 'Invoice line', '["sale_id"]', 'Alex', '["ERP"]', 'approved'),
          (12, 200, 1, 1, 'Customer', 'Customer dimension for finance reporting', 'Finance', 'dimension', 'Customer', '["customer_id"]', 'Alex', '["ERP"]', 'approved'),
          (13, 300, 1, 1, 'Calendar', 'Standard finance calendar', 'Finance', 'dimension', 'Date', '["date_key"]', 'Alex', '["ERP"]', 'approved');

        INSERT INTO gs_canonical_columns (id, canonical_id, canonical_root_id, column_name, key_designation, ordinal, fk_target_root_id, fk_target_column)
        VALUES
          (101, 11, 100, 'SaleId', 'pk', 1, NULL, NULL),
          (102, 11, 100, 'CustomerId', 'fk', 2, 200, 'CustomerId'),
          (103, 11, 100, 'RevenueAmount', 'none', 3, NULL, NULL),
          (104, 12, 200, 'CustomerId', 'pk', 1, NULL, NULL),
          (105, 12, 200, 'CustomerName', 'none', 2, NULL, NULL),
          (106, 13, 300, 'DateKey', 'pk', 1, NULL, NULL);

        INSERT INTO gs_semantic_definitions (id, canonical_root_id, version, name, definition_type, expression_type, expression)
        VALUES
          (201, 100, 1, 'Revenue', 'measure', 'dax', 'SUM(Sales[RevenueAmount])');

        INSERT INTO gs_gold_specs (
          id, root_id, version, is_current, canonical_root_id, canonical_version, target_name,
          object_type, source_sql, included_columns, refresh_strategy, status
        )
        VALUES
          (10, 1000, 1, 1, 100, 1, 'gold_sales', 'table', 'SELECT 1', '["SaleId","CustomerId","RevenueAmount"]', 'full', 'validated'),
          (20, 2000, 1, 1, 200, 1, 'dim_customer', 'table', 'SELECT 1', '["CustomerId","CustomerName"]', 'full', 'draft');

        INSERT INTO gs_catalog_entries (
          id, root_id, version, is_current, canonical_root_id, spec_root_id, spec_version,
          display_name, technical_name, business_description, grain, domain, owner, steward,
          source_systems, sensitivity_label, status, endorsement, published_by
        )
        VALUES
          (100, 100, 1, 1, 100, 1000, 1, 'Sales', 'gold_sales', 'Published sales fact for finance reporting', 'Invoice line', 'Finance', 'Alex', 'Alex', '["ERP"]', 'internal', 'current', 'certified', 'system');

        INSERT INTO gs_report_field_usage (
          id, specimen_id, entity_id, visual_id, visual_type, page_name, column_name, measure_name, usage_type
        )
        VALUES
          (1, 1, 1, 'vis-1', 'bar', 'Executive Summary', NULL, 'Revenue', 'value'),
          (2, 1, 1, 'vis-2', 'table', 'Executive Summary', 'CustomerId', NULL, 'axis'),
          (3, 1, 1, 'vis-3', 'card', 'Margin', NULL, 'Gross Margin', 'value'),
          (4, 2, 2, 'vis-4', 'table', 'Margin', 'ProductCode', NULL, 'filter'),
          (5, 2, 3, 'vis-5', 'table', 'Customer', 'CustomerName', NULL, 'detail'),
          (6, 2, 4, 'vis-6', 'table', 'Calendar', 'DateKey', NULL, 'axis');

        INSERT INTO gs_report_recreation_coverage (
          id, domain, report_name, report_description, report_type, coverage_status,
          contributing_specimen_ids, contributing_canonical_ids, contributing_spec_ids,
          unresolved_metrics, notes, assessed_by
        )
        VALUES
          (1, 'Finance', 'Executive Sales Dashboard', 'Executive dashboard migrated to the gold model', 'power_bi', 'fully_covered', '[1]', '[100,200]', '[10]', '[]', 'Ready for migration', 'Alex'),
          (2, 'Finance', 'Margin Variance Workbook', 'Workbook with custom margin logic', 'excel', 'partially_covered', '[2]', '[100,300]', '[10]', '["Gross Margin","ProductCode mapping"]', 'Still needs semantic and canonical work', 'Alex'),
          (3, 'Finance', 'Unscoped Legacy Query', 'Ad hoc legacy query with no mapped evidence yet', 'other', 'not_analyzed', NULL, NULL, NULL, '["Needs lineage"]', 'Registered but not mapped', 'Alex');
    """)
    conn.commit()
    conn.close()


def test_release_coverage_map_summarizes_artifacts_and_blockers():
    result = routes.gs_release_coverage_map({"domain": "Finance"})

    assert result["summary"]["imported_artifacts"] == 3
    assert result["summary"]["registered_reports"] == 3
    assert result["summary"]["field_rows_total"] == 6
    assert result["summary"]["field_rows_accounted_for"] == 3

    artifacts = {item["artifact_name"]: item for item in result["artifacts"]}
    assert artifacts["Executive Sales.pbix"]["coverage_status"] == "partially_accounted_for"
    assert artifacts["Margin Model.sql"]["coverage_status"] == "partially_accounted_for"
    assert artifacts["Mapping Notes.xlsx"]["coverage_status"] == "context_only"

    blocker_kinds = {item["kind"] for item in result["blockers"]}
    assert blocker_kinds == {"artifact", "report", "spec"}
    assert any(item["name"] == "dim_customer" for item in result["blockers"])


def test_release_proposed_model_returns_nodes_and_relationships():
    result = routes.gs_release_proposed_model({"domain": "Finance"})

    assert result["summary"]["entity_count"] == 3
    assert result["summary"]["relationship_count"] == 1
    assert result["summary"]["published_entities"] == 1
    assert result["summary"]["entities_needing_specs"] == 1

    nodes = {item["name"]: item for item in result["nodes"]}
    assert nodes["Sales"]["model_state"] == "published"
    assert nodes["Customer"]["model_state"] == "designed"
    assert nodes["Calendar"]["model_state"] == "needs_spec"
    assert nodes["Sales"]["field_reference_count"] == 3
    assert result["relationships"][0]["column_name"] == "CustomerId"
    assert result["relationships"][0]["to_entity"] == "Customer"


def test_release_coverage_appendix_lists_mapping_statuses():
    result = routes.gs_release_coverage_appendix({"domain": "Finance"})

    statuses = {item["mapping_status"] for item in result["items"]}
    assert {"published", "needs_semantic_definition", "needs_canonical_mapping", "accounted_for", "needs_spec", "context_only", "coverage_unmapped"} <= statuses

    appendix_lookup = {
        (item["artifact_name"], item["source_field_name"]): item["mapping_status"]
        for item in result["items"]
    }
    assert appendix_lookup[("Executive Sales.pbix", "Revenue")] == "published"
    assert appendix_lookup[("Executive Sales.pbix", "Gross Margin")] == "needs_semantic_definition"
    assert appendix_lookup[("Margin Model.sql", "ProductCode")] == "needs_canonical_mapping"
    assert appendix_lookup[("Margin Model.sql", "DateKey")] == "needs_spec"

    unmapped_report = next(item for item in result["items"] if item["artifact_name"] == "Unscoped Legacy Query")
    assert unmapped_report["mapping_status"] == "coverage_unmapped"
    assert result["status_counts"]["coverage_unmapped"] == 1
