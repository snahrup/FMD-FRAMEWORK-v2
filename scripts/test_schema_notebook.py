# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "55d50ad9-5a00-4430-8cbd-0f4843f05aa9",
# META       "default_lakehouse_name": "TestSchemaLH2",
# META       "default_lakehouse_workspace_id": "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a",
# META       "known_lakehouses": [
# META         {
# META           "id": "55d50ad9-5a00-4430-8cbd-0f4843f05aa9"
# META         }
# META       ]
# META     }
# META   }
# META }

# CELL ********************

# ============================================================
# SCHEMA WRITE TEST NOTEBOOK v2
# Tests all methods of writing data to Lakehouse schemas
# Key learning: Must use saveAsTable("schema.table") for schemas
# spark.write.save(abfss_path) does NOT register in schema catalog
# ============================================================

print("=" * 60)
print("SCHEMA WRITE TEST v2 - COMPREHENSIVE")
print("=" * 60)

workspace_id = "a3a180ff-fbc2-48fd-a65f-27ae7bb6709a"
lakehouse_id = "55d50ad9-5a00-4430-8cbd-0f4843f05aa9"
lakehouse_name = "TestSchemaLH2"

results = {}

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 1: saveAsTable with schema prefix (RECOMMENDED METHOD)
# Per Microsoft docs: df.write.mode("overwrite").saveAsTable("schema.table")
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, TimestampType, DoubleType
from datetime import datetime

print("\nTEST 1: saveAsTable('MES.dbo_TestWidget') - Recommended method")
try:
    test_data = [
        (1, "Widget A", "Active", 100, datetime(2026, 1, 15, 10, 30, 0)),
        (2, "Widget B", "Inactive", 200, datetime(2026, 2, 1, 14, 0, 0)),
        (3, "Widget C", "Active", 150, datetime(2026, 2, 20, 8, 45, 0)),
    ]
    schema = StructType([
        StructField("Id", IntegerType(), False),
        StructField("Name", StringType(), True),
        StructField("Status", StringType(), True),
        StructField("Quantity", IntegerType(), True),
        StructField("ModifiedDate", TimestampType(), True),
    ])
    df = spark.createDataFrame(test_data, schema)
    df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("MES.dbo_TestWidget")

    # Verify
    count = spark.sql("SELECT COUNT(*) as cnt FROM MES.dbo_TestWidget").collect()[0]["cnt"]
    print(f"  PASS: saveAsTable wrote {count} rows to MES.dbo_TestWidget")
    results["test1_saveAsTable_MES"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test1_saveAsTable_MES"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 2: Spark SQL CREATE TABLE in ETQ schema
print("\nTEST 2: Spark SQL CREATE TABLE + INSERT in ETQ schema")
try:
    spark.sql("CREATE TABLE IF NOT EXISTS ETQ.dbo_WorkItem (WorkItemId INT, Title STRING, Priority STRING) USING DELTA")
    spark.sql("INSERT INTO ETQ.dbo_WorkItem VALUES (101, 'Inspection A', 'High'), (102, 'Audit B', 'Medium')")
    count = spark.sql("SELECT COUNT(*) as cnt FROM ETQ.dbo_WorkItem").collect()[0]["cnt"]
    print(f"  PASS: SQL CREATE + INSERT wrote {count} rows to ETQ.dbo_WorkItem")
    results["test2_sql_create_ETQ"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test2_sql_create_ETQ"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 3: saveAsTable to M3 schema (M3 ERP pattern)
print("\nTEST 3: saveAsTable('M3.dbo_MITMAS') - M3 ERP pattern")
try:
    m3_data = [("A001", "Steel Rod", 50.0), ("A002", "Copper Wire", 120.5)]
    m3_schema = StructType([
        StructField("ItemNumber", StringType(), False),
        StructField("ItemName", StringType(), True),
        StructField("OnHandQty", DoubleType(), True),
    ])
    df_m3 = spark.createDataFrame(m3_data, m3_schema)
    df_m3.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("M3.dbo_MITMAS")

    count = spark.sql("SELECT COUNT(*) as cnt FROM M3.dbo_MITMAS").collect()[0]["cnt"]
    print(f"  PASS: saveAsTable wrote {count} rows to M3.dbo_MITMAS")
    results["test3_saveAsTable_M3"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test3_saveAsTable_M3"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 4: saveAsTable to M3_Cloud schema
print("\nTEST 4: saveAsTable('M3_Cloud.dbo_OOHEAD') - M3 Cloud pattern")
try:
    m3c_data = [("ORD-001", "Shipped", 1500.00), ("ORD-002", "Pending", 2300.50)]
    m3c_schema = StructType([
        StructField("OrderNumber", StringType(), False),
        StructField("Status", StringType(), True),
        StructField("TotalAmount", DoubleType(), True),
    ])
    df_m3c = spark.createDataFrame(m3c_data, m3c_schema)
    df_m3c.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("M3_Cloud.dbo_OOHEAD")

    count = spark.sql("SELECT COUNT(*) as cnt FROM M3_Cloud.dbo_OOHEAD").collect()[0]["cnt"]
    print(f"  PASS: saveAsTable wrote {count} rows to M3_Cloud.dbo_OOHEAD")
    results["test4_saveAsTable_M3Cloud"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test4_saveAsTable_M3Cloud"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 5: Overwrite existing table (incremental load simulation)
print("\nTEST 5: Overwrite existing MES table (incremental load pattern)")
try:
    updated = [(1, "Widget A v2", "Active", 110, datetime(2026, 2, 25, 10, 0, 0)),
               (4, "Widget D NEW", "Active", 50, datetime(2026, 2, 25, 16, 0, 0))]
    df_up = spark.createDataFrame(updated, schema)
    df_up.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("MES.dbo_TestWidget")

    count = spark.sql("SELECT COUNT(*) as cnt FROM MES.dbo_TestWidget").collect()[0]["cnt"]
    print(f"  PASS: Overwrote MES.dbo_TestWidget with {count} rows (was 3)")
    results["test5_overwrite"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test5_overwrite"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 6: Compare saveAsTable vs spark.write.save(abfss_path)
# This tests whether the abfss path approach also registers in the schema
print("\nTEST 6: spark.write.save(abfss_path) vs saveAsTable - comparison")
try:
    path_data = [(99, "PathTest", "abfss")]
    path_schema = StructType([
        StructField("Id", IntegerType(), False),
        StructField("Name", StringType(), True),
        StructField("Source", StringType(), True),
    ])
    df_path = spark.createDataFrame(path_data, path_schema)

    # Write via abfss path to MES schema
    target_abfss = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{lakehouse_id}/Tables/MES/dbo_PathTest"
    df_path.write.format("delta").mode("overwrite").save(target_abfss)

    # Check if it appears in catalog
    try:
        count = spark.sql("SELECT COUNT(*) as cnt FROM MES.dbo_PathTest").collect()[0]["cnt"]
        print(f"  PASS: abfss path write IS visible in schema catalog ({count} rows)")
        results["test6_abfss_vs_saveAsTable"] = f"PASS - abfss works too ({count} rows)"
    except Exception as e2:
        # abfss path doesn't auto-register in schema
        print(f"  INFO: abfss path write NOT visible in schema catalog: {e2}")
        # But the files should exist - try reading directly
        count = spark.read.format("delta").load(target_abfss).count()
        print(f"  INFO: But data IS on disk ({count} rows) - just not in catalog")
        results["test6_abfss_vs_saveAsTable"] = f"INFO - abfss writes files but NOT catalog ({count} rows on disk)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test6_abfss_vs_saveAsTable"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 7: Verify all schemas and tables in catalog
print("\nTEST 7: Full catalog inspection")
try:
    # Show all schemas
    schemas_df = spark.sql(f"SHOW SCHEMAS IN {lakehouse_name}")
    schema_list = [row[0] for row in schemas_df.collect()]
    print(f"  All schemas: {schema_list}")

    # Show tables in each expected schema
    for s in ['dbo', 'MES', 'ETQ', 'M3', 'M3_Cloud']:
        try:
            tables_df = spark.sql(f"SHOW TABLES IN {lakehouse_name}.{s}")
            tlist = [row['tableName'] for row in tables_df.collect()]
            print(f"  {s} -> tables: {tlist}")
        except Exception as e2:
            print(f"  {s} -> ERROR: {e2}")

    results["test7_catalog"] = f"PASS (schemas: {schema_list})"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test7_catalog"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 8: Cross-reference via four-part namespace
print("\nTEST 8: Four-part namespace query (workspace.lakehouse.schema.table)")
try:
    result = spark.sql(f"SELECT * FROM {lakehouse_name}.MES.dbo_TestWidget LIMIT 5")
    count = result.count()
    cols = result.columns
    print(f"  PASS: {lakehouse_name}.MES.dbo_TestWidget returned {count} rows, columns: {cols}")
    results["test8_four_part"] = f"PASS ({count} rows)"
except Exception as e:
    print(f"  FAIL: {e}")
    results["test8_four_part"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# TEST 9: Programmatic Lakehouse creation with schemas via REST API from notebook
print("\nTEST 9: Create schema-enabled lakehouse via REST API from notebook")
try:
    import notebookutils
    import json as _json

    token = notebookutils.credentials.getToken("https://api.fabric.microsoft.com")
    ws_id = workspace_id

    import urllib.request as _urllib_request
    payload = _json.dumps({
        "displayName": "TestSchemaFromAPI",
        "description": "Created via REST API from notebook",
        "creationPayload": {"enableSchemas": True}
    }).encode()

    req = _urllib_request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/lakehouses",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST"
    )
    resp = _urllib_request.urlopen(req)
    result = _json.loads(resp.read())
    created_id = result["id"]
    print(f"  PASS: Created TestSchemaFromAPI ({created_id}) via REST API from notebook")
    results["test9_rest_api_create"] = f"PASS (id: {created_id})"

    # Cleanup
    try:
        del_req = _urllib_request.Request(
            f"https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/items/{created_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="DELETE"
        )
        _urllib_request.urlopen(del_req)
        print(f"  Cleaned up: Deleted TestSchemaFromAPI")
    except Exception:
        print(f"  Note: Manual cleanup needed for TestSchemaFromAPI ({created_id})")
except Exception as e:
    print(f"  FAIL: {e}")
    results["test9_rest_api_create"] = f"FAIL: {e}"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# FINAL REPORT
print("\n" + "=" * 60)
print("FINAL TEST RESULTS")
print("=" * 60)
all_pass = True
critical_pass = True
for test_name, result in results.items():
    is_pass = "PASS" in result
    is_info = "INFO" in result
    icon = "+" if is_pass else ("~" if is_info else "X")
    print(f"  [{icon}] {test_name}: {result}")
    if not is_pass and not is_info:
        all_pass = False
    # Tests 1-5 are critical (production loading methods)
    if test_name.startswith("test") and int(test_name[4]) <= 5 and not is_pass:
        critical_pass = False

print()
if critical_pass:
    print("CRITICAL TESTS (1-5) ALL PASSED")
    print("saveAsTable('schema.table') CONFIRMED WORKING for all 4 data sources")
    print("Safe to proceed with Bronze + Silver Lakehouse recreation")
else:
    print("CRITICAL TESTS FAILED - DO NOT PROCEED")

if not all_pass:
    print("\nSome non-critical tests had issues - review above")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
