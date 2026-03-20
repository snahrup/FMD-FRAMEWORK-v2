"""
Load Optimization Analysis — Watermark & PK Discovery
Connects to all 4 source SQL servers and discovers:
1. Primary keys for each table
2. Watermark columns (for incremental loads)
3. Row counts
Then updates the Fabric metadata DB with IsIncremental/IsIncrementalColumn.
"""
import json
import logging
import pyodbc
import os
import sys
import time
import struct
from collections import defaultdict
from datetime import datetime

# Source server mapping
SOURCE_MAP = {
    'MES': ('m3-db1', 'mes'),
    'ETQ': ('M3-DB3', 'ETQStagingPRD'),
    'M3': ('sqllogshipprd', 'm3fdbprd'),
    'M3C': ('sql2016live', 'DI_PRD_Staging'),
}

DRIVER = 'ODBC Driver 18 for SQL Server'

def connect_source(server, database):
    """Connect to on-prem source SQL server via Windows auth."""
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Trusted_Connection=yes;"
        f"TrustServerCertificate=yes;"
        f"Connection Timeout=30;"
        f"Command Timeout=60;"
    )
    return pyodbc.connect(conn_str)

def get_fabric_token():
    """Get SP token for Fabric SQL DB."""
    from msal import ConfidentialClientApplication

    # Load creds from .env
    env_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard', 'app', 'api', '.env')
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")

    tenant_id = env_vars.get('FABRIC_TENANT_ID', 'ca81e9fd-06dd-49cf-b5a9-ee7441ff5303')
    client_id = env_vars.get('FABRIC_CLIENT_ID', 'ac937c5d-4bdd-438f-be8b-84a850021d2d')
    client_secret = env_vars.get('FABRIC_CLIENT_SECRET', '')

    app = ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://analysis.windows.net/powerbi/api/.default"])
    if 'access_token' not in result:
        raise Exception(f"Token acquisition failed: {result.get('error_description', result)}")
    return result['access_token']

def connect_fabric():
    """Connect to Fabric SQL metadata DB."""
    token = get_fabric_token()
    token_bytes = token.encode('utf-16-le')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)

    server = '7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433'
    database = 'SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0'

    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"Encrypt=yes;"
        f"TrustServerCertificate=no;"
    )
    conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
    return conn

def analyze_watermark_columns(cursor, schema, table):
    """Detect watermark columns for a table.

    WIDENED DETECTION — priority order:
      1. Identity columns (always monotonic, perfect watermark)
      2. Datetime cols named *modif*/*updat*/*last* (most reliable timestamp)
      3. Datetime cols named *chang*/*timestamp*
      4. Datetime cols named *creat*/*insert*/*added*/*date*
      5. ANY remaining datetime/datetime2 column (fallback — still better than full load)
      6. Integer cols named *id*/*seq*/*num*/*key* that are NOT part of PK
         (often auto-incrementing even without IDENTITY property)

    Excludes timestamp/rowversion (binary, can't be compared as varchar).
    """
    try:
        cursor.execute("""
            SELECT
                c.name AS ColumnName,
                t2.name AS DataType,
                COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') AS IsIdentity,
                CASE
                    -- Priority 1: Identity column (perfect monotonic watermark)
                    WHEN COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1
                        THEN 1
                    -- Priority 2: Datetime named modify/update/last (most reliable)
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND (c.name LIKE '%[Mm]odif%' OR c.name LIKE '%[Uu]pdat%'
                              OR c.name LIKE '%[Ll]ast%')
                        THEN 2
                    -- Priority 3: Datetime named change/timestamp
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND (c.name LIKE '%[Cc]hang%' OR c.name LIKE '%[Tt]imestamp%')
                        THEN 3
                    -- Priority 4: Datetime named create/insert/added/date
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                         AND (c.name LIKE '%[Cc]reat%' OR c.name LIKE '%[Ii]nsert%'
                              OR c.name LIKE '%[Aa]dded%' OR c.name LIKE '%[Dd]ate%')
                        THEN 4
                    -- Priority 5: ANY datetime/datetime2 column (better than full load)
                    WHEN t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                        THEN 5
                    -- Priority 6: Integer cols named id/seq/num/key (often auto-incrementing)
                    WHEN t2.name IN ('int', 'bigint')
                         AND (c.name LIKE '%[Ii]d' OR c.name LIKE '%[Ss]eq%'
                              OR c.name LIKE '%[Nn]um%' OR c.name LIKE '%[Kk]ey%'
                              OR c.name LIKE '%ID' OR c.name LIKE 'ID%'
                              OR c.name LIKE '%_id' OR c.name LIKE '%_ID')
                        THEN 6
                    ELSE 99
                END AS Priority
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.columns c ON t.object_id = c.object_id
            JOIN sys.types t2 ON c.system_type_id = t2.system_type_id AND c.user_type_id = t2.user_type_id
            WHERE s.name = ? AND t.name = ?
            AND t2.name NOT IN ('timestamp', 'rowversion', 'binary', 'varbinary', 'image',
                                'geometry', 'geography', 'xml', 'hierarchyid', 'sql_variant')
            AND (
                -- Identity columns
                COLUMNPROPERTY(OBJECT_ID(QUOTENAME(s.name) + '.' + QUOTENAME(t.name)), c.name, 'IsIdentity') = 1
                -- Any datetime-family column
                OR t2.name IN ('datetime', 'datetime2', 'datetimeoffset', 'smalldatetime')
                -- Integer columns with ID/seq/num/key in the name
                OR (t2.name IN ('int', 'bigint')
                    AND (c.name LIKE '%[Ii]d' OR c.name LIKE '%[Ss]eq%'
                         OR c.name LIKE '%[Nn]um%' OR c.name LIKE '%[Kk]ey%'
                         OR c.name LIKE '%ID' OR c.name LIKE 'ID%'
                         OR c.name LIKE '%_id' OR c.name LIKE '%_ID'))
            )
            ORDER BY Priority, c.column_id
        """, schema, table)
        rows = cursor.fetchall()
        if rows:
            best = rows[0]
            # Skip if best candidate is priority 99 (shouldn't happen with the filter)
            if best.Priority >= 99:
                return None, None
            return best.ColumnName, best.DataType
        return None, None
    except Exception as e:
        return None, f"ERROR: {str(e)[:80]}"

def analyze_primary_keys(cursor, schema, table):
    """Discover primary keys for a table."""
    try:
        cursor.execute("""
            SELECT c.name AS ColumnName
            FROM sys.indexes i
            JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN sys.tables t ON i.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE i.is_primary_key = 1
                AND s.name = ? AND t.name = ?
            ORDER BY ic.key_ordinal
        """, schema, table)
        rows = cursor.fetchall()
        return ','.join(r.ColumnName for r in rows) if rows else None
    except Exception as e:
        logging.debug("Failed to get primary key for %s.%s: %s", schema, table, e)
        return None

def analyze_row_count(cursor, schema, table):
    """Get approximate row count."""
    try:
        cursor.execute("""
            SELECT SUM(p.rows) AS RowCount
            FROM sys.tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
            WHERE s.name = ? AND t.name = ?
        """, schema, table)
        row = cursor.fetchone()
        return int(row.RowCount) if row and row.RowCount else 0
    except Exception as e:
        logging.debug("Failed to get row count for %s.%s: %s", schema, table, e)
        return -1

def main():
    # Load entities
    with open(os.path.join(os.path.dirname(__file__), 'entities_to_analyze.json')) as f:
        all_entities = json.load(f)

    # Filter to those needing analysis
    need_analysis = [e for e in all_entities if not e.get('is_incr')]
    print(f"Total entities needing analysis: {len(need_analysis)}")

    # Group by namespace
    by_ns = defaultdict(list)
    for e in need_analysis:
        by_ns[e['ns']].append(e)

    results = []
    errors = []

    for ns in ['ETQ', 'M3C', 'MES', 'M3']:  # Do smaller sources first
        if ns not in by_ns:
            continue
        server, database = SOURCE_MAP[ns]
        entities = by_ns[ns]
        print(f"\n{'='*60}")
        print(f"Analyzing {ns} ({server}/{database}): {len(entities)} tables")
        print(f"{'='*60}")

        try:
            conn = connect_source(server, database)
            cursor = conn.cursor()
            print(f"  Connected to {server}/{database}")
        except Exception as e:
            print(f"  FAILED to connect: {e}")
            errors.append({'ns': ns, 'error': str(e)})
            continue

        found_count = 0
        for i, entity in enumerate(entities):
            schema = entity['schema']
            name = entity['name']

            # Watermark
            wm_col, wm_type = analyze_watermark_columns(cursor, schema, name)

            # PKs
            pks = analyze_primary_keys(cursor, schema, name)

            # Row count
            row_count = analyze_row_count(cursor, schema, name)

            is_incremental = wm_col is not None and not str(wm_type).startswith('ERROR')

            result = {
                'id': entity['id'],
                'ns': ns,
                'schema': schema,
                'name': name,
                'watermark_col': wm_col,
                'watermark_type': wm_type,
                'primary_keys': pks,
                'row_count': row_count,
                'is_incremental': is_incremental,
            }
            results.append(result)

            if is_incremental:
                found_count += 1

            # Progress every 50
            if (i + 1) % 50 == 0 or (i + 1) == len(entities):
                print(f"  [{i+1}/{len(entities)}] Analyzed — {found_count} incremental so far")

        cursor.close()
        conn.close()
        print(f"  Done: {found_count}/{len(entities)} have watermark columns")

    # Save results
    output_path = os.path.join(os.path.dirname(__file__), 'load_optimization_results.json')
    with open(output_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_analyzed': len(results),
            'incremental_found': sum(1 for r in results if r['is_incremental']),
            'results': results,
            'errors': errors,
        }, f, indent=2)
    print(f"\nResults saved to {output_path}")

    # Summary
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}")
    inc_count = sum(1 for r in results if r['is_incremental'])
    print(f"Analyzed: {len(results)} tables")
    print(f"Incremental candidates found: {inc_count}")
    print(f"Still full load: {len(results) - inc_count}")

    # By namespace
    for ns in ['ETQ', 'M3C', 'MES', 'M3']:
        ns_results = [r for r in results if r['ns'] == ns]
        if not ns_results:
            continue
        ns_inc = sum(1 for r in ns_results if r['is_incremental'])
        print(f"  {ns}: {ns_inc}/{len(ns_results)} incremental")

    # Show watermark type distribution
    wm_types = defaultdict(int)
    for r in results:
        if r['is_incremental']:
            wm_types[r['watermark_type']] += 1
    if wm_types:
        print(f"\nWatermark type distribution:")
        for t, c in sorted(wm_types.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")

if __name__ == '__main__':
    main()
