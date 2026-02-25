#!/usr/bin/env python3
"""
Run load analysis on all on-prem SQL sources via VPN.
Discovers PKs, watermark columns, row counts and updates the metadata DB.
"""
import sys, json, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'dashboard', 'app', 'api'))
from server import (query_sql, get_gateway_connections, _connect_source_sql,
                     _sanitize_sql_str, _execute_parameterized, update_load_config)
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('load-analysis')

def analyze_and_update(datasource_id, server, database):
    """Analyze a source SQL Server and update metadata DB with results."""
    # Get LZ entities for this datasource
    entities = query_sql(
        f"SELECT LandingzoneEntityId, SourceSchema, SourceName, FileName, "
        f"IsIncremental, IsIncrementalColumn "
        f"FROM integration.LandingzoneEntity "
        f"WHERE DataSourceId = {int(datasource_id)} AND IsActive = 1 "
        f"ORDER BY SourceSchema, SourceName"
    )
    if not entities:
        print(f'  No active entities for DS {datasource_id}')
        return

    print(f'  Analyzing {len(entities)} entities in {server}/{database}...')

    # Connect to source
    try:
        src_conn = _connect_source_sql(server, database)
    except Exception as e:
        print(f'  CONNECTION FAILED: {str(e)[:200]}')
        return

    src_cursor = src_conn.cursor()

    # Discover PKs
    pk_map = {}
    try:
        src_cursor.execute("""
            SELECT s.name AS SchemaName, t.name AS TableName, c.name AS ColumnName,
                   ic.key_ordinal
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.is_primary_key = 1
            ORDER BY s.name, t.name, ic.key_ordinal
        """)
        for row in src_cursor.fetchall():
            key = (row.SchemaName, row.TableName)
            pk_map.setdefault(key, []).append(row.ColumnName)
    except Exception as e:
        print(f'  PK discovery failed: {e}')

    # Discover watermark candidates
    watermark_map = {}
    try:
        src_cursor.execute("""
            SELECT s.name AS SchemaName, t.name AS TableName,
                   c.name AS ColumnName, tp.name AS DataType,
                   COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') AS IsIdentity
            FROM sys.columns c
            JOIN sys.tables t ON c.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.types tp ON c.system_type_id = tp.system_type_id AND c.user_type_id = tp.user_type_id
            WHERE (
                tp.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime', 'timestamp', 'rowversion')
                OR COLUMNPROPERTY(t.object_id, c.name, 'IsIdentity') = 1
            )
            ORDER BY s.name, t.name, c.column_id
        """)
        for row in src_cursor.fetchall():
            key = (row.SchemaName, row.TableName)
            col_lower = row.ColumnName.lower()
            if row.DataType in ('timestamp', 'rowversion'):
                priority = 1
            elif row.DataType in ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime'):
                if any(kw in col_lower for kw in ('modif', 'updat', 'chang', 'last_')):
                    priority = 2
                elif any(kw in col_lower for kw in ('creat', 'insert', 'added')):
                    priority = 3
                else:
                    priority = 5
            elif row.IsIdentity:
                priority = 4
            else:
                priority = 6
            watermark_map.setdefault(key, []).append({
                'column': row.ColumnName, 'dataType': row.DataType,
                'isIdentity': bool(row.IsIdentity), 'priority': priority,
            })
    except Exception as e:
        print(f'  Watermark discovery failed: {e}')

    # Discover row counts
    rowcount_map = {}
    try:
        src_cursor.execute("""
            SELECT s.name AS SchemaName, t.name AS TableName,
                   SUM(p.rows) AS RowCount
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            GROUP BY s.name, t.name
        """)
        for row in src_cursor.fetchall():
            rowcount_map[(row.SchemaName, row.TableName)] = row.RowCount
    except Exception as e:
        print(f'  Row count discovery failed: {e}')

    src_conn.close()

    # Build updates for metadata DB
    updates = []
    incremental_count = 0
    full_count = 0
    pk_count = 0
    total_rows = 0

    for e in entities:
        eid = int(e['LandingzoneEntityId'])
        schema = e['SourceSchema']
        table = e['SourceName']
        key = (schema, table)

        pks = pk_map.get(key, [])
        watermarks = sorted(watermark_map.get(key, []), key=lambda w: w['priority'])
        row_count = rowcount_map.get(key, 0)
        best_wm = watermarks[0] if watermarks else None

        if pks:
            pk_count += 1
        total_rows += row_count or 0

        # Determine load type (priority 1-4: rowversion, Modified/Created datetime, identity)
        if best_wm and best_wm['priority'] <= 4:
            is_inc = True
            wm_col = best_wm['column']
            incremental_count += 1
        else:
            is_inc = False
            wm_col = ''
            full_count += 1

        updates.append({
            'entityId': eid,
            'isIncremental': is_inc,
            'watermarkColumn': wm_col,
        })

        # Also update Bronze entity PKs if we found them
        if pks:
            pk_str = ','.join(pks)
            try:
                _execute_parameterized(
                    "UPDATE integration.BronzeLayerEntity SET PrimaryKeys = ? WHERE LandingzoneEntityId = ?",
                    (_sanitize_sql_str(pk_str), eid))
            except Exception:
                pass

    # Batch update load config
    if updates:
        result = update_load_config(updates)
        print(f'  Updated: {result.get("updated", 0)} entities')

    print(f'  Summary: {len(entities)} entities, {pk_count} with PKs, '
          f'{incremental_count} incremental, {full_count} full load, '
          f'{total_rows:,} total rows')


def main():
    # Get datasource -> server mapping from gateway connections
    gw_conns = get_gateway_connections()
    gw_by_id = {g['id'].lower(): g for g in gw_conns}

    datasources = query_sql(
        "SELECT ds.DataSourceId, ds.Name AS DsName, ds.Namespace, "
        "c.ConnectionGuid, c.Name AS ConnName "
        "FROM integration.DataSource ds "
        "JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId "
        "WHERE ds.Namespace NOT IN ('ONELAKE', 'NB')"
    )

    print(f'\n{"="*60}')
    print(f'  LOAD ANALYSIS — {len(datasources)} datasources')
    print(f'{"="*60}\n')

    for ds in datasources:
        ds_id = int(ds['DataSourceId'])
        ds_name = ds['DsName']
        conn_guid = ds['ConnectionGuid'].lower()
        gw = gw_by_id.get(conn_guid)

        if not gw:
            print(f'DS {ds_id} ({ds_name}): Gateway connection not found — SKIP')
            continue

        server = gw['server']
        database = gw['database']
        print(f'\nDS {ds_id}: {ds_name} ({server}/{database})')
        print(f'  {"-"*50}')

        try:
            analyze_and_update(ds_id, server, database)
        except Exception as e:
            print(f'  FAILED: {str(e)[:300]}')

    print(f'\n{"="*60}')
    print(f'  ANALYSIS COMPLETE')
    print(f'{"="*60}')


if __name__ == '__main__':
    main()
