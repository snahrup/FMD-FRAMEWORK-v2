"""
FMD Operations Dashboard — Production Server
Serves the React dashboard (static files) and API from a single process.
Connects live to Fabric SQL DB + Fabric REST API via service principal.

Dependencies: pyodbc, ODBC Driver 18 for SQL Server
Everything else is Python stdlib.

Usage:
  Development:  python server.py                    (uses config.json next to this file)
  Production:   python server.py --config /path/to/config.json
"""
import json
import os
import struct
import sys
import logging
import mimetypes
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import threading
import time

# ── Configuration ──

def _resolve_env_vars(obj):
    """Recursively resolve ${ENV_VAR} placeholders from environment variables.
    Missing vars resolve to empty string (optional config sections like Purview)."""
    if isinstance(obj, str) and obj.startswith('${') and obj.endswith('}'):
        var_name = obj[2:-1]
        val = os.environ.get(var_name, '')
        if not val:
            print(f'  [WARN] Environment variable {var_name} is not set — using empty default')
        return val
    elif isinstance(obj, dict):
        return {k: _resolve_env_vars(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_resolve_env_vars(v) for v in obj]
    return obj


def load_config(config_path: str = None) -> dict:
    """Load configuration from JSON file, resolving ${ENV_VAR} placeholders."""
    if config_path is None:
        config_path = Path(__file__).parent / 'config.json'
    with open(config_path, 'r') as f:
        raw = json.load(f)
    return _resolve_env_vars(raw)

CONFIG = load_config(sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--config' else None)

TENANT_ID = CONFIG['fabric']['tenant_id']
CLIENT_ID = CONFIG['fabric']['client_id']
CLIENT_SECRET = CONFIG['fabric']['client_secret']
SQL_SERVER = CONFIG['sql']['server']
SQL_DATABASE = CONFIG['sql']['database']
SQL_DRIVER = CONFIG['sql'].get('driver', 'ODBC Driver 18 for SQL Server')
PORT = CONFIG['server']['port']
HOST = CONFIG['server'].get('host', '127.0.0.1')
STATIC_DIR = Path(__file__).parent / CONFIG['server'].get('static_dir', '../dist')
PURVIEW_ACCOUNT = CONFIG.get('purview', {}).get('account_name', '')
WORKSPACE_DATA_ID = CONFIG['fabric'].get('workspace_data_id', '')

# ── Logging ──

log_cfg = CONFIG.get('logging', {})
log_file = log_cfg.get('file')
log_level = getattr(logging, log_cfg.get('level', 'INFO').upper(), logging.INFO)

handlers = [logging.StreamHandler()]
if log_file:
    log_path = Path(__file__).parent / log_file
    handlers.append(logging.FileHandler(log_path, encoding='utf-8'))

logging.basicConfig(
    level=log_level,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=handlers,
)
log = logging.getLogger('fmd-dashboard')


# ── Fabric Auth ──

_token_cache: dict = {}
_token_lock = threading.Lock()

def get_fabric_token(scope: str) -> str:
    """Get an OAuth2 token from Entra ID, with thread-safe caching."""
    with _token_lock:
        cached = _token_cache.get(scope)
        if cached and cached['expires'] > datetime.now().timestamp():
            return cached['token']

    token_url = f'https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token'
    data = urllib.parse.urlencode({
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'scope': scope,
        'grant_type': 'client_credentials',
    }).encode()
    req = urllib.request.Request(token_url, data=data,
                                headers={'Content-Type': 'application/x-www-form-urlencoded'})
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())

    with _token_lock:
        _token_cache[scope] = {
            'token': result['access_token'],
            'expires': datetime.now().timestamp() + result.get('expires_in', 3600) - 60,
        }
    log.info(f'Token refreshed for scope: {scope[:50]}...')
    return result['access_token']


# ── SQL Database ──

def get_sql_connection():
    """Connect to Fabric SQL Database using SP token."""
    import pyodbc
    token = get_fabric_token('https://database.windows.net/.default')
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f'DRIVER={{{SQL_DRIVER}}};'
        f'SERVER={SQL_SERVER};'
        f'DATABASE={SQL_DATABASE};'
        f'Encrypt=yes;TrustServerCertificate=no;'
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def query_sql(sql: str) -> list[dict]:
    """Execute SQL and return list of dicts."""
    conn = get_sql_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        if not cursor.description:
            conn.commit()
            return []
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.commit()  # Commit even when results are returned (stored procs with OUTPUT)
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    finally:
        conn.close()


# ── Fabric REST API ──

def get_gateway_connections() -> list[dict]:
    """Get all gateway connections from Fabric REST API."""
    token = get_fabric_token('https://analysis.windows.net/powerbi/api/.default')
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    req = urllib.request.Request('https://api.fabric.microsoft.com/v1/connections', headers=headers)
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    connections = []
    for c in data.get('value', []):
        path = c.get('connectionDetails', {}).get('path', '')
        parts = path.split(';', 1)
        connections.append({
            'id': c.get('id', ''),
            'displayName': c.get('displayName', ''),
            'server': parts[0] if parts else '',
            'database': parts[1] if len(parts) > 1 else '',
            'authType': c.get('credentialDetails', {}).get('credentialType', ''),
            'encryption': c.get('credentialDetails', {}).get('connectionEncryption', ''),
            'connectivityType': c.get('connectivityType', ''),
            'gatewayId': c.get('gatewayId', ''),
        })
    return connections


# ── Microsoft Purview API ──

def _purview_request(method: str, path: str, body: dict = None) -> dict:
    """Make authenticated request to Purview REST API."""
    if not PURVIEW_ACCOUNT:
        return {'error': 'Purview not configured', '_status': 'unconfigured'}
    token = get_fabric_token('https://purview.azure.net/.default')
    url = f'https://{PURVIEW_ACCOUNT}.purview.azure.com{path}'
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        log.error(f'Purview {method} {path} → {e.code}: {err_body}')
        return {'error': f'Purview API error: {e.code}', 'detail': err_body}


def purview_search(keyword: str, limit: int = 25) -> list[dict]:
    """Search Purview catalog for entities matching keyword."""
    result = _purview_request('POST', '/catalog/api/search/query?api-version=2022-08-01-preview', {
        'keywords': keyword,
        'limit': limit,
        'filter': {'objectType': 'Tables'},
    })
    if 'error' in result:
        return []
    entities = []
    for item in result.get('value', []):
        entities.append({
            'id': item.get('id', ''),
            'qualifiedName': item.get('qualifiedName', ''),
            'name': item.get('name', ''),
            'entityType': item.get('entityType', ''),
            'classifications': [c.get('typeName', '') for c in item.get('classification', [])],
            'glossaryTerms': [t.get('displayText', '') for t in item.get('term', [])],
            'owners': [c.get('id', '') for c in item.get('contact', {}).get('Owner', [])],
            'experts': [c.get('id', '') for c in item.get('contact', {}).get('Expert', [])],
            'description': item.get('description', ''),
        })
    return entities


def purview_get_entity(guid: str) -> dict:
    """Get a single Purview entity by GUID."""
    result = _purview_request('GET', f'/catalog/api/atlas/v2/entity/guid/{guid}?api-version=2022-08-01-preview')
    if 'error' in result:
        return result
    entity = result.get('entity', result)
    attrs = entity.get('attributes', {})
    return {
        'guid': entity.get('guid', guid),
        'typeName': entity.get('typeName', ''),
        'qualifiedName': attrs.get('qualifiedName', ''),
        'name': attrs.get('name', ''),
        'description': attrs.get('description', ''),
        'classifications': [c.get('typeName', '') for c in entity.get('classifications', [])],
        'owners': [c.get('id', '') for c in entity.get('contacts', {}).get('Owner', [])],
        'experts': [c.get('id', '') for c in entity.get('contacts', {}).get('Expert', [])],
        'createTime': entity.get('createTime'),
        'updateTime': entity.get('updateTime'),
    }


def purview_update_entity(guid: str, updates: dict) -> dict:
    """Push description/classifications back to Purview."""
    payload = {
        'entity': {
            'guid': guid,
            'attributes': {},
        }
    }
    if 'description' in updates:
        payload['entity']['attributes']['description'] = updates['description']
    if 'userDescription' in updates:
        payload['entity']['attributes']['userDescription'] = updates['userDescription']

    result = _purview_request('PUT',
        f'/catalog/api/atlas/v2/entity/guid/{guid}?api-version=2022-08-01-preview',
        payload)
    if 'error' in result:
        return result
    log.info(f'Purview entity {guid[:8]}... updated')
    return {'success': True, 'guid': guid}


def purview_status() -> dict:
    """Check Purview connectivity."""
    if not PURVIEW_ACCOUNT:
        return {'connected': False, 'reason': 'No account configured'}
    result = _purview_request('GET', '/catalog/api/atlas/v2/types/typedefs?api-version=2022-08-01-preview')
    if 'error' in result:
        return {'connected': False, 'reason': result.get('error', 'Unknown error')}
    return {'connected': True, 'account': PURVIEW_ACCOUNT}


# ── Lakehouse SQL Analytics Endpoints ──

_lakehouse_endpoints: dict = {}  # lakehouse_name → {connectionString, id, ...}
_lakehouse_lock = threading.Lock()

def discover_lakehouse_endpoints() -> dict:
    """Discover SQL analytics endpoints for all lakehouses via Fabric REST API."""
    global _lakehouse_endpoints
    with _lakehouse_lock:
        if _lakehouse_endpoints:
            return _lakehouse_endpoints

    if not WORKSPACE_DATA_ID:
        log.warning('No workspace_data_id configured — cannot discover lakehouse endpoints')
        return {}

    token = get_fabric_token('https://analysis.windows.net/powerbi/api/.default')
    headers = {'Authorization': f'Bearer {token}'}

    # List all lakehouses in the data workspace
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_DATA_ID}/lakehouses'
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        for lh in data.get('value', []):
            name = lh.get('displayName', '')
            props = lh.get('properties', {})
            sql_props = props.get('sqlEndpointProperties', {})
            conn_str = sql_props.get('connectionString', '')
            if conn_str and sql_props.get('provisioningStatus') == 'Success':
                _lakehouse_endpoints[name] = {
                    'connectionString': conn_str,
                    'sqlEndpointId': sql_props.get('id', ''),
                    'lakehouseId': lh.get('id', ''),
                    'workspaceId': WORKSPACE_DATA_ID,
                }
                log.info(f'  Lakehouse SQL endpoint: {name} → {conn_str[:50]}...')
    except urllib.error.HTTPError as e:
        log.error(f'Failed to discover lakehouses: {e.code} {e.read().decode()[:200]}')
    except Exception as e:
        log.error(f'Failed to discover lakehouses: {e}')

    return _lakehouse_endpoints


def get_lakehouse_connection(lakehouse_name: str):
    """Connect to a lakehouse SQL analytics endpoint via pyodbc."""
    import pyodbc
    endpoints = discover_lakehouse_endpoints()
    ep = endpoints.get(lakehouse_name)
    if not ep:
        raise ValueError(f'Lakehouse "{lakehouse_name}" not found. Available: {list(endpoints.keys())}')

    token = get_fabric_token('https://database.windows.net/.default')
    token_bytes = token.encode('UTF-16-LE')
    token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
    conn_str = (
        f'DRIVER={{{SQL_DRIVER}}};'
        f'SERVER={ep["connectionString"]};'
        f'DATABASE={lakehouse_name};'
        f'Encrypt=yes;TrustServerCertificate=no;'
    )
    return pyodbc.connect(conn_str, attrs_before={1256: token_struct})


def query_lakehouse(lakehouse_name: str, sql: str) -> list[dict]:
    """Execute read-only SQL against a lakehouse SQL analytics endpoint."""
    conn = get_lakehouse_connection(lakehouse_name)
    try:
        cursor = conn.cursor()
        cursor.execute(sql)
        if not cursor.description:
            return []
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    finally:
        conn.close()


def discover_lakehouse_tables(lakehouse_name: str) -> list[dict]:
    """Get all tables in a lakehouse via INFORMATION_SCHEMA."""
    return query_lakehouse(lakehouse_name,
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
        "FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_TYPE = 'BASE TABLE' "
        "ORDER BY TABLE_SCHEMA, TABLE_NAME"
    )


def get_lakehouse_columns(lakehouse_name: str, schema: str, table: str) -> list[dict]:
    """Get column metadata for a table from INFORMATION_SCHEMA."""
    s_schema = _sanitize_sql_str(schema)
    s_table = _sanitize_sql_str(table)
    return query_lakehouse(lakehouse_name,
        f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, "
        f"CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, "
        f"ORDINAL_POSITION "
        f"FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE TABLE_SCHEMA = '{s_schema}' AND TABLE_NAME = '{s_table}' "
        f"ORDER BY ORDINAL_POSITION"
    )


def profile_lakehouse_table(lakehouse_name: str, schema: str, table: str) -> dict:
    """Profile a table: row count + per-column null counts, distinct counts, min/max."""
    # Step 1: Get columns
    columns = get_lakehouse_columns(lakehouse_name, schema, table)
    if not columns:
        return {'error': f'Table {schema}.{table} not found in {lakehouse_name}'}

    # Step 2: Build profiling query (limit to first 50 columns for performance)
    col_exprs = []
    profiled_cols = columns[:50]
    for col in profiled_cols:
        name = col['COLUMN_NAME']
        safe = name.replace(']', ']]')
        col_exprs.append(f"COUNT(DISTINCT [{safe}]) AS [{safe}__distinct]")
        col_exprs.append(f"SUM(CASE WHEN [{safe}] IS NULL THEN 1 ELSE 0 END) AS [{safe}__nulls]")
        # Min/max for sortable types
        dtype = (col.get('DATA_TYPE') or '').lower()
        if dtype in ('int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric',
                      'float', 'real', 'money', 'date', 'datetime', 'datetime2',
                      'datetimeoffset', 'time', 'varchar', 'nvarchar', 'char', 'nchar'):
            col_exprs.append(f"MIN(CAST([{safe}] AS NVARCHAR(200))) AS [{safe}__min]")
            col_exprs.append(f"MAX(CAST([{safe}] AS NVARCHAR(200))) AS [{safe}__max]")

    profile_sql = f"SELECT COUNT(*) AS _row_count, {', '.join(col_exprs)} FROM [{schema}].[{table}]"

    try:
        result = query_lakehouse(lakehouse_name, profile_sql)
    except Exception as e:
        log.error(f'Profile query failed for {lakehouse_name}.{schema}.{table}: {e}')
        return {'error': str(e), 'columns': columns}

    if not result:
        return {'error': 'No results', 'columns': columns}

    stats = result[0]
    row_count = int(stats.get('_row_count', 0))

    # Step 3: Assemble per-column profile
    column_profiles = []
    for col in profiled_cols:
        name = col['COLUMN_NAME']
        distinct = int(stats.get(f'{name}__distinct', 0) or 0)
        nulls = int(stats.get(f'{name}__nulls', 0) or 0)
        null_pct = round((nulls / row_count * 100), 2) if row_count > 0 else 0
        profile = {
            'name': name,
            'dataType': col.get('DATA_TYPE', ''),
            'nullable': col.get('IS_NULLABLE', '') == 'YES',
            'maxLength': col.get('CHARACTER_MAXIMUM_LENGTH'),
            'precision': col.get('NUMERIC_PRECISION'),
            'scale': col.get('NUMERIC_SCALE'),
            'ordinal': int(col.get('ORDINAL_POSITION', 0)),
            'distinctCount': distinct,
            'nullCount': nulls,
            'nullPercentage': null_pct,
            'minValue': stats.get(f'{name}__min'),
            'maxValue': stats.get(f'{name}__max'),
        }
        # Quality signals
        if row_count > 0:
            profile['uniqueness'] = round(distinct / row_count * 100, 2)
            profile['completeness'] = round(100 - null_pct, 2)
        column_profiles.append(profile)

    return {
        'lakehouse': lakehouse_name,
        'schema': schema,
        'table': table,
        'rowCount': row_count,
        'columnCount': len(columns),
        'profiledColumns': len(profiled_cols),
        'columns': column_profiles,
    }


def sample_lakehouse_table(lakehouse_name: str, schema: str, table: str, limit: int = 25) -> dict:
    """Get sample rows from a lakehouse table."""
    limit = min(limit, 100)  # Cap at 100 rows
    rows = query_lakehouse(lakehouse_name, f"SELECT TOP {limit} * FROM [{schema}].[{table}]")
    return {
        'lakehouse': lakehouse_name,
        'schema': schema,
        'table': table,
        'rowCount': len(rows),
        'rows': rows,
    }


_lakehouse_counts_cache: dict | None = None
_lakehouse_counts_cache_ts: float = 0
LAKEHOUSE_COUNTS_CACHE_TTL = 300  # 5 minutes — counts don't change often


def get_lakehouse_row_counts(force_refresh: bool = False) -> dict:
    """Get row counts for all tables across all lakehouses in parallel.
    Uses sys.partitions metadata for fast counts, falls back to batch COUNT queries.
    Results are cached for 5 minutes to avoid hammering lakehouse endpoints."""
    global _lakehouse_counts_cache, _lakehouse_counts_cache_ts

    if not force_refresh and _lakehouse_counts_cache and (time.time() - _lakehouse_counts_cache_ts) < LAKEHOUSE_COUNTS_CACHE_TTL:
        return {**_lakehouse_counts_cache, '_meta': {
            'cachedAt': datetime.utcfromtimestamp(_lakehouse_counts_cache_ts).isoformat() + 'Z',
            'fromCache': True,
            'cacheAgeSec': int(time.time() - _lakehouse_counts_cache_ts),
        }}

    endpoints = discover_lakehouse_endpoints()
    if not endpoints:
        return {'_meta': {'cachedAt': None, 'fromCache': False, 'cacheAgeSec': 0}}

    def _count_lakehouse(lh_name: str):
        try:
            # Fast path: metadata-based counts via sys.partitions
            rows = query_lakehouse(lh_name,
                "SELECT s.name AS [schema], t.name AS [table], "
                "CAST(SUM(p.rows) AS BIGINT) AS row_count "
                "FROM sys.tables t "
                "INNER JOIN sys.schemas s ON t.schema_id = s.schema_id "
                "INNER JOIN sys.partitions p ON t.object_id = p.object_id "
                "WHERE p.index_id IN (0, 1) "
                "GROUP BY s.name, t.name "
                "ORDER BY s.name, t.name"
            )
            return lh_name, [{'schema': r['schema'], 'table': r['table'],
                              'rowCount': int(r['row_count'] or 0)} for r in rows]
        except Exception as e:
            log.warning(f'sys.partitions failed for {lh_name}: {e}')
            # Fallback: discover tables then batch COUNT via UNION ALL
            try:
                tables = discover_lakehouse_tables(lh_name)
                if not tables:
                    return lh_name, []
                all_counts = []
                for i in range(0, len(tables), 50):
                    batch = tables[i:i + 50]
                    parts = []
                    for t in batch:
                        s = t['TABLE_SCHEMA'].replace("'", "''")
                        n = t['TABLE_NAME'].replace("'", "''")
                        parts.append(
                            f"SELECT '{s}' AS [schema], '{n}' AS [table], "
                            f"COUNT_BIG(*) AS row_count FROM [{t['TABLE_SCHEMA']}].[{t['TABLE_NAME']}]"
                        )
                    try:
                        rows = query_lakehouse(lh_name, " UNION ALL ".join(parts))
                        all_counts.extend([{'schema': r['schema'], 'table': r['table'],
                                            'rowCount': int(r['row_count'] or 0)} for r in rows])
                    except Exception as e2:
                        log.warning(f'Batch count failed for {lh_name} batch {i}: {e2}')
                return lh_name, all_counts
            except Exception as e3:
                log.error(f'Row counts completely failed for {lh_name}: {e3}')
                return lh_name, []

    t_start = time.time()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(_count_lakehouse, lh) for lh in endpoints]
        results = {}
        for future in futures:
            try:
                name, counts = future.result(timeout=120)
                results[name] = counts
            except Exception as e:
                log.error(f'Row count future failed: {e}')

    now_utc = datetime.utcnow().isoformat() + 'Z'
    results['_meta'] = {
        'cachedAt': now_utc,
        'fromCache': False,
        'cacheAgeSec': 0,
        'queryTimeSec': round(time.time() - t_start, 1),
    }
    _lakehouse_counts_cache = {k: v for k, v in results.items() if k != '_meta'}
    _lakehouse_counts_cache_ts = time.time()
    log.info(f'Lakehouse row counts: {len(endpoints)} lakehouses in {time.time() - t_start:.1f}s')
    return results


def execute_blender_query(lakehouse_name: str, sql: str) -> dict:
    """Execute a user query against a lakehouse (read-only, enforced limits)."""
    # Safety: only allow SELECT statements
    stripped = sql.strip().upper()
    if not stripped.startswith('SELECT'):
        return {'error': 'Only SELECT queries are allowed'}
    for forbidden in ('INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE'):
        if f' {forbidden} ' in f' {stripped} ' or stripped.startswith(forbidden):
            return {'error': f'{forbidden} statements are not allowed'}

    # Enforce TOP limit if not present
    if 'TOP ' not in stripped:
        sql = sql.strip()
        # Insert TOP 100 after SELECT
        select_idx = sql.upper().find('SELECT')
        if select_idx >= 0:
            after_select = select_idx + 6
            # Handle SELECT DISTINCT
            rest = sql[after_select:].lstrip()
            if rest.upper().startswith('DISTINCT'):
                after_select = select_idx + 6 + len(sql[after_select:]) - len(rest) + 8
            sql = sql[:after_select] + ' TOP 100 ' + sql[after_select:]

    try:
        rows = query_lakehouse(lakehouse_name, sql)
        return {
            'success': True,
            'rowCount': len(rows),
            'rows': rows,
            'sql': sql,
        }
    except Exception as e:
        return {'error': str(e)}


# ── Blender API (aggregates FMD metadata + Purview) ──

def get_blender_tables() -> list[dict]:
    """Get all tables across all layers — merges metadata DB + live lakehouse discovery."""
    tables = []
    seen = set()  # Track table names to avoid duplicates

    # Layer 1: Try metadata DB for registered entities
    try:
        lz = query_sql(
            'SELECT le.LandingzoneEntityId AS Id, le.SourceSchema, le.SourceName, '
            'le.FileName, le.IsActive, ds.Name AS DataSourceName, '
            'lh.Name AS LakehouseName '
            'FROM integration.LandingzoneEntity le '
            'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
            'JOIN integration.Lakehouse lh ON le.LakehouseId = lh.LakehouseId '
            'WHERE le.IsActive = 1 '
            'ORDER BY le.SourceName'
        )
        for row in lz:
            key = f"{row.get('LakehouseName', 'LH_DATA_LANDINGZONE')}.{row.get('SourceSchema', 'dbo')}.{row['SourceName']}"
            seen.add(key)
            tables.append({
                'id': f"lz-{row['Id']}",
                'name': row['SourceName'],
                'layer': 'landing',
                'lakehouse': row.get('LakehouseName', 'LH_DATA_LANDINGZONE'),
                'schema': row.get('SourceSchema', 'dbo'),
                'source': 'metadata',
                'dataSource': row.get('DataSourceName', ''),
            })

        br = query_sql(
            'SELECT be.BronzeLayerEntityId AS Id, be.[Schema] AS SourceSchema, be.Name AS SourceName, '
            'be.IsActive, lh.Name AS LakehouseName '
            'FROM integration.BronzeLayerEntity be '
            'JOIN integration.Lakehouse lh ON be.LakehouseId = lh.LakehouseId '
            'WHERE be.IsActive = 1 '
            'ORDER BY be.Name'
        )
        for row in br:
            name = row['SourceName']
            lh = row.get('LakehouseName', 'LH_BRONZE_LAYER')
            key = f"{lh}.{row.get('SourceSchema', 'dbo')}.{name}"
            seen.add(key)
            tables.append({
                'id': f"br-{row['Id']}",
                'name': name,
                'layer': 'bronze',
                'lakehouse': lh,
                'schema': row.get('SourceSchema', 'dbo'),
                'source': 'metadata',
            })

        sv = query_sql(
            'SELECT se.SilverLayerEntityId AS Id, se.[Schema] AS SourceSchema, se.Name AS SourceName, '
            'se.IsActive, lh.Name AS LakehouseName '
            'FROM integration.SilverLayerEntity se '
            'JOIN integration.Lakehouse lh ON se.LakehouseId = lh.LakehouseId '
            'WHERE se.IsActive = 1 '
            'ORDER BY se.Name'
        )
        for row in sv:
            name = row['SourceName']
            lh = row.get('LakehouseName', 'LH_SILVER_LAYER')
            key = f"{lh}.{row.get('SourceSchema', 'dbo')}.{name}"
            seen.add(key)
            tables.append({
                'id': f"sv-{row['Id']}",
                'name': name,
                'layer': 'silver',
                'lakehouse': lh,
                'schema': row.get('SourceSchema', 'dbo'),
                'source': 'metadata',
            })
    except Exception as e:
        log.warning(f'Metadata DB unavailable for blender tables: {e}')

    # Layer 2: Discover tables directly from lakehouse SQL endpoints
    # This catches tables that exist in lakehouses but aren't registered in metadata DB
    layer_map = {
        'LH_DATA_LANDINGZONE': 'landing',
        'LH_BRONZE_LAYER': 'bronze',
        'LH_SILVER_LAYER': 'silver',
    }
    endpoints = discover_lakehouse_endpoints()
    for lh_name in endpoints:
        try:
            lh_tables = discover_lakehouse_tables(lh_name)
            layer = layer_map.get(lh_name, 'unknown')
            for t in lh_tables:
                key = f"{lh_name}.{t['TABLE_SCHEMA']}.{t['TABLE_NAME']}"
                if key not in seen:
                    seen.add(key)
                    tables.append({
                        'id': f"lh-{lh_name}-{t['TABLE_SCHEMA']}-{t['TABLE_NAME']}",
                        'name': t['TABLE_NAME'],
                        'layer': layer,
                        'lakehouse': lh_name,
                        'schema': t['TABLE_SCHEMA'],
                        'source': 'lakehouse',
                    })
        except Exception as e:
            log.warning(f'Could not discover tables in {lh_name}: {e}')

    return tables


# ── Data Queries ──

def get_registered_connections() -> list[dict]:
    return query_sql(
        'SELECT ConnectionId, ConnectionGuid, Name, Type, IsActive '
        'FROM integration.Connection ORDER BY ConnectionId'
    )

def get_registered_datasources() -> list[dict]:
    return query_sql(
        'SELECT ds.DataSourceId, ds.Name, ds.Namespace, ds.Type, ds.Description, '
        'ds.IsActive, c.Name AS ConnectionName '
        'FROM integration.DataSource ds '
        'JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId '
        'ORDER BY ds.DataSourceId'
    )

def get_registered_entities() -> list[dict]:
    return query_sql(
        'SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, '
        'le.FileName, le.FilePath, le.FileType, le.IsIncremental, le.IsActive, '
        'le.SourceCustomSelect, le.IsIncrementalColumn, le.CustomNotebookName, '
        'ds.Name AS DataSourceName '
        'FROM integration.LandingzoneEntity le '
        'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
        'ORDER BY le.LandingzoneEntityId'
    )

def get_pipeline_view() -> list[dict]:
    return query_sql('SELECT * FROM [execution].[vw_LoadSourceToLandingzone]')


def discover_source_tables(server: str, database: str, username: str = '', password: str = '') -> list[dict]:
    """Connect to a source SQL Server and list its tables via INFORMATION_SCHEMA."""
    import pyodbc
    if username and password:
        # SQL Authentication
        conn_str = (
            f'DRIVER={{{SQL_DRIVER}}};'
            f'SERVER={server};'
            f'DATABASE={database};'
            f'UID={username};'
            f'PWD={password};'
            f'TrustServerCertificate=yes;'
        )
    else:
        # Windows Authentication (production on-prem)
        conn_str = (
            f'DRIVER={{{SQL_DRIVER}}};'
            f'SERVER={server};'
            f'DATABASE={database};'
            f'Trusted_Connection=yes;'
            f'TrustServerCertificate=yes;'
        )
    try:
        conn = pyodbc.connect(conn_str, timeout=10)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_TYPE = 'BASE TABLE' "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME"
        )
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        conn.close()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    except pyodbc.Error as e:
        log.warning(f'Source table discovery failed for {server}/{database}: {e}')
        raise RuntimeError(f'Cannot connect to {server}/{database}: {str(e)[:200]}')

def get_pipeline_executions() -> list[dict]:
    try:
        return query_sql(
            'SELECT * FROM logging.PipelineExecution ORDER BY 1 DESC'
        )
    except Exception as e:
        log.warning(f'PipelineExecution query failed (table may not exist yet): {e}')
        return []

def get_copy_executions() -> list[dict]:
    try:
        return query_sql(
            'SELECT * FROM logging.CopyActivityExecution ORDER BY 1 DESC'
        )
    except Exception as e:
        log.warning(f'CopyActivityExecution query failed (table may not exist yet): {e}')
        return []

def get_notebook_executions() -> list[dict]:
    try:
        return query_sql(
            'SELECT * FROM logging.NotebookExecution ORDER BY 1 DESC'
        )
    except Exception as e:
        log.warning(f'NotebookExecution query failed (table may not exist yet): {e}')
        return []

def get_bronze_view() -> list[dict]:
    return query_sql('SELECT * FROM [execution].[vw_LoadToBronzeLayer]')

def get_silver_view() -> list[dict]:
    return query_sql('SELECT * FROM [execution].[vw_LoadToSilverLayer]')

def get_pipelines() -> list[dict]:
    return query_sql('SELECT * FROM integration.Pipeline ORDER BY PipelineId')


def trigger_pipeline(pipeline_name: str) -> dict:
    """Trigger a Fabric Data Pipeline run via the REST API.
    Looks up pipeline GUID and workspace from the metadata DB."""
    # Find the pipeline in metadata DB (prefer DEV = lowest PipelineId)
    pipelines = _execute_parameterized(
        "SELECT TOP 1 p.PipelineGuid, p.WorkspaceGuid, p.Name "
        "FROM integration.Pipeline p "
        "WHERE p.Name = ? AND p.IsActive = 1 "
        "ORDER BY p.PipelineId",
        (pipeline_name,)
    )
    if not pipelines:
        raise ValueError(f'Pipeline "{pipeline_name}" not found or inactive in metadata DB')

    pipeline_guid = pipelines[0]['PipelineGuid'].lower()

    # The Pipeline table's WorkspaceGuid may point to DATA, but pipelines live in CODE.
    # Resolve: find the workspace the pipeline points to, extract env tag (D/P),
    # then find the CODE workspace with the same env tag.
    assigned_ws_guid = pipelines[0]['WorkspaceGuid']
    workspaces = query_sql("SELECT WorkspaceGuid, Name FROM integration.Workspace")
    ws_map = {w['WorkspaceGuid'].upper(): w['Name'] for w in workspaces}
    assigned_ws_name = ws_map.get(assigned_ws_guid.upper(), '')

    # Extract environment tag: "(D)" or "(P)"
    env_tag = ''
    if '(D)' in assigned_ws_name:
        env_tag = '(D)'
    elif '(P)' in assigned_ws_name:
        env_tag = '(P)'

    # Find the CODE workspace for this environment
    code_ws_guid = None
    for guid, name in ws_map.items():
        if 'CODE' in name and env_tag in name:
            code_ws_guid = guid.lower()
            break

    if not code_ws_guid:
        # Fallback: use the assigned workspace directly
        log.warning(f'Could not find CODE workspace for env={env_tag}, using assigned workspace')
        code_ws_guid = assigned_ws_guid.lower()

    log.info(f'Triggering pipeline: {pipeline_name} (guid={pipeline_guid}) in workspace {code_ws_guid}')

    # Call Fabric REST API to trigger the pipeline
    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{code_ws_guid}'
        f'/items/{pipeline_guid}/jobs/instances?jobType=Pipeline'
    )
    req = urllib.request.Request(url, method='POST', data=b'{}',
                                headers={'Authorization': f'Bearer {token}',
                                         'Content-Type': 'application/json'})
    try:
        resp = urllib.request.urlopen(req)
        location = resp.headers.get('Location', '')
        log.info(f'Pipeline triggered successfully: {pipeline_name} — Location: {location}')
        return {
            'success': True,
            'pipelineName': pipeline_name,
            'pipelineGuid': pipeline_guid,
            'workspaceGuid': code_ws_guid,
            'status': resp.status,
            'location': location,
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log.error(f'Pipeline trigger failed: {e.code} — {body}')
        raise ValueError(f'Fabric API error {e.code}: {body}')


def get_pipeline_run_status(workspace_guid: str, pipeline_guid: str) -> list[dict]:
    """Get recent run status for a pipeline from Fabric API."""
    # This queries the execution log from the metadata DB
    return query_sql(
        f"SELECT TOP 5 * FROM execution.PipelineExecution "
        f"WHERE PipelineName = (SELECT Name FROM integration.Pipeline WHERE PipelineGuid = '{pipeline_guid}') "
        f"ORDER BY PipelineExecutionId DESC"
    )


def get_fabric_job_instances() -> list[dict]:
    """Query Fabric REST API for recent pipeline job instances across all workspaces.
    Returns actual running/completed jobs from Fabric, independent of logging tables."""
    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    pipelines = query_sql(
        "SELECT p.PipelineGuid, p.Name, w.WorkspaceGuid, w.Name as WorkspaceName "
        "FROM integration.Pipeline p "
        "JOIN integration.Workspace w ON p.WorkspaceGuid = w.WorkspaceGuid "
        "WHERE p.IsActive = 1 "
        "ORDER BY p.PipelineId"
    )

    # Build a map of CODE workspace per environment tag
    workspaces = query_sql("SELECT WorkspaceGuid, Name FROM integration.Workspace")
    ws_map = {w['WorkspaceGuid'].upper(): w['Name'] for w in workspaces}
    code_ws = {}
    for guid, name in ws_map.items():
        if 'CODE' in name:
            if '(D)' in name:
                code_ws['D'] = guid.lower()
            elif '(P)' in name:
                code_ws['P'] = guid.lower()

    # Deduplicate: check each unique pipeline GUID once
    seen_guids = set()
    all_jobs = []

    for pipe in pipelines:
        pg = pipe['PipelineGuid'].lower()
        if pg in seen_guids:
            continue
        seen_guids.add(pg)

        # Resolve CODE workspace
        ws_name = pipe.get('WorkspaceName', '')
        env = 'D' if '(D)' in ws_name else 'P' if '(P)' in ws_name else 'D'
        ws_guid = code_ws.get(env, pipe['WorkspaceGuid'].lower())

        url = (f'https://api.fabric.microsoft.com/v1/workspaces/{ws_guid}'
               f'/items/{pg}/jobs/instances?limit=3')
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        try:
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read().decode())
            for job in data.get('value', []):
                job['pipelineName'] = pipe['Name']
                job['pipelineGuid'] = pg
                job['workspaceGuid'] = ws_guid
                job['workspaceName'] = ws_name
                all_jobs.append(job)
        except urllib.error.HTTPError:
            continue  # No runs or pipeline not found in this workspace
        except Exception:
            continue

    # Sort: running first, then by start time descending
    def sort_key(j):
        status = j.get('status', '')
        is_active = 1 if status.lower() in ('inprogress', 'running', 'notstarted') else 0
        start = j.get('startTimeUtc', '0')
        return (-is_active, start)

    all_jobs.sort(key=sort_key, reverse=True)
    return all_jobs[:50]  # Cap at 50 most recent


def get_pipeline_activity_runs(workspace_guid: str, job_instance_id: str) -> list[dict]:
    """Query Fabric REST API for activity-level runs within a specific pipeline job instance."""
    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    url = (f'https://api.fabric.microsoft.com/v1/workspaces/{workspace_guid}'
           f'/datapipelines/pipelineruns/{job_instance_id}/queryactivityruns')
    # Time window: last 7 days to now+1day (generous window)
    now = datetime.utcnow()
    body = json.dumps({
        'filters': [],
        'orderBy': [{'orderBy': 'ActivityRunStart', 'order': 'ASC'}],
        'lastUpdatedAfter': (now - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S.0000000Z'),
        'lastUpdatedBefore': (now + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S.0000000Z'),
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read().decode())
        activities = data if isinstance(data, list) else data.get('value', data.get('activityRuns', []))
        # Normalize and clean up for frontend
        result = []
        for act in activities:
            result.append({
                'activityName': act.get('activityName', ''),
                'activityType': act.get('activityType', ''),
                'status': act.get('status', 'Unknown'),
                'startTime': act.get('activityRunStart', ''),
                'endTime': act.get('activityRunEnd', ''),
                'durationMs': act.get('durationInMs', 0),
                'error': act.get('error', {}),
                'input': act.get('input', {}),
                'output': act.get('output', {}),
                'activityRunId': act.get('activityRunId', ''),
            })
        return result
    except urllib.error.HTTPError as e:
        body_text = ''
        try:
            body_text = e.read().decode()[:500]
        except Exception:
            pass
        log.warning(f'Activity runs query failed for {job_instance_id}: HTTP {e.code} — {body_text}')
        return []
    except Exception as e:
        log.warning(f'Activity runs query failed: {e}')
        return []


def get_cascade_impact(entity_ids: list[int]) -> dict:
    """Return what bronze/silver entities would be affected by deleting the given LZ entity IDs.
    Links by matching SourceSchema+SourceName (LZ) → [Schema]+Name (Bronze/Silver)."""
    if not entity_ids:
        return {'landing': [], 'bronze': [], 'silver': []}
    safe_ids = [int(eid) for eid in entity_ids]
    placeholders = ','.join('?' * len(safe_ids))

    landing = _execute_parameterized(
        f"SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, ds.Name AS DataSourceName "
        f"FROM integration.LandingzoneEntity le "
        f"JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId "
        f"WHERE le.LandingzoneEntityId IN ({placeholders})",
        tuple(safe_ids)
    )
    # Match bronze by schema+name from the LZ entities
    bronze = []
    silver = []
    if landing:
        match_clauses = ' OR '.join(
            f"(be.[Schema] = ? AND be.Name = ?)" for _ in landing
        )
        match_params = []
        for lz in landing:
            match_params.extend([lz['SourceSchema'], lz['SourceName']])
        try:
            bronze = _execute_parameterized(
                f"SELECT be.BronzeLayerEntityId, be.[Schema] AS SourceSchema, be.Name AS SourceName "
                f"FROM integration.BronzeLayerEntity be "
                f"WHERE {match_clauses}",
                tuple(match_params)
            )
        except Exception as e:
            log.warning(f'Bronze cascade lookup failed (columns may differ): {e}')

        # Match silver by same schema+name
        try:
            silver_clauses = ' OR '.join(
                f"(se.[Schema] = ? AND se.Name = ?)" for _ in landing
            )
            silver = _execute_parameterized(
                f"SELECT se.SilverLayerEntityId, se.[Schema] AS SourceSchema, se.Name AS SourceName "
                f"FROM integration.SilverLayerEntity se "
                f"WHERE {silver_clauses}",
                tuple(match_params)
            )
        except Exception as e:
            log.warning(f'Silver cascade lookup failed (columns may differ): {e}')

    return {
        'landing': landing,
        'bronze': bronze,
        'silver': silver,
    }


def _build_schema_diff(bronze_cols: list[dict], silver_cols: list[dict]) -> list[dict]:
    """Compare column schemas across bronze and silver layers.
    Returns a merged list showing which columns exist where and type changes."""
    bronze_map = {c['COLUMN_NAME']: c for c in bronze_cols}
    silver_map = {c['COLUMN_NAME']: c for c in silver_cols}
    all_names = list(dict.fromkeys(
        [c['COLUMN_NAME'] for c in bronze_cols] + [c['COLUMN_NAME'] for c in silver_cols]
    ))
    diff = []
    for name in all_names:
        bc = bronze_map.get(name)
        sc = silver_map.get(name)
        entry = {
            'columnName': name,
            'inBronze': bc is not None,
            'inSilver': sc is not None,
            'bronzeType': bc['DATA_TYPE'] if bc else None,
            'silverType': sc['DATA_TYPE'] if sc else None,
            'bronzeNullable': bc['IS_NULLABLE'] if bc else None,
            'silverNullable': sc['IS_NULLABLE'] if sc else None,
            'status': 'unchanged',
        }
        if bc and not sc:
            entry['status'] = 'bronze_only'
        elif sc and not bc:
            entry['status'] = 'added_in_silver'
        elif bc and sc and bc['DATA_TYPE'] != sc['DATA_TYPE']:
            entry['status'] = 'type_changed'
        diff.append(entry)
    return diff


def get_entity_journey(lz_entity_id: int) -> dict:
    """Build the complete data journey for a single entity across all layers.
    Traces Source → Landing Zone → Bronze → Silver with column schemas & row counts."""

    # Step 1: Get LZ entity + DataSource + Connection + Lakehouse
    lz_rows = _execute_parameterized(
        "SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, "
        "le.FileName, le.FilePath, le.FileType, le.IsIncremental, "
        "le.IsIncrementalColumn, le.SourceCustomSelect, le.CustomNotebookName, "
        "le.IsActive, "
        "ds.Name AS DataSourceName, ds.Namespace, ds.Type AS DataSourceType, "
        "ds.Description AS DataSourceDescription, "
        "c.Name AS ConnectionName, c.Type AS ConnectionType, "
        "lh.Name AS LakehouseName "
        "FROM integration.LandingzoneEntity le "
        "JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId "
        "JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId "
        "JOIN integration.Lakehouse lh ON le.LakehouseId = lh.LakehouseId "
        "WHERE le.LandingzoneEntityId = ?",
        (lz_entity_id,)
    )
    if not lz_rows:
        return {'error': f'Entity {lz_entity_id} not found'}
    lz = lz_rows[0]

    # Step 2: Find Bronze entity via FK
    bronze_rows = _execute_parameterized(
        "SELECT be.BronzeLayerEntityId, be.[Schema], be.Name, "
        "be.PrimaryKeys, be.FileType, be.IsActive, "
        "lh.Name AS LakehouseName "
        "FROM integration.BronzeLayerEntity be "
        "JOIN integration.Lakehouse lh ON be.LakehouseId = lh.LakehouseId "
        "WHERE be.LandingzoneEntityId = ?",
        (lz_entity_id,)
    )
    bronze = bronze_rows[0] if bronze_rows else None

    # Step 3: Find Silver entity via FK from Bronze
    silver = None
    if bronze:
        silver_rows = _execute_parameterized(
            "SELECT se.SilverLayerEntityId, se.[Schema], se.Name, "
            "se.FileType, se.IsActive, "
            "lh.Name AS LakehouseName "
            "FROM integration.SilverLayerEntity se "
            "JOIN integration.Lakehouse lh ON se.LakehouseId = lh.LakehouseId "
            "WHERE se.BronzeLayerEntityId = ?",
            (int(bronze['BronzeLayerEntityId']),)
        )
        silver = silver_rows[0] if silver_rows else None

    # Step 4: Get column schemas + row counts from lakehouses (parallel)
    bronze_columns: list[dict] = []
    silver_columns: list[dict] = []
    bronze_row_count = None
    silver_row_count = None

    def _get_columns_safe(lakehouse, schema, table):
        try:
            return get_lakehouse_columns(lakehouse, schema, table)
        except Exception as e:
            log.warning(f'Column fetch failed for {lakehouse}.{schema}.{table}: {e}')
            return []

    def _get_row_count_safe(lakehouse, schema, table):
        try:
            s_schema = _sanitize_sql_str(schema)
            s_table = _sanitize_sql_str(table)
            rows = query_lakehouse(lakehouse,
                f"SELECT COUNT_BIG(*) AS cnt FROM [{s_schema}].[{s_table}]")
            return int(rows[0]['cnt']) if rows else None
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {}
        if bronze:
            futures['bronze_cols'] = pool.submit(
                _get_columns_safe, bronze['LakehouseName'], bronze['Schema'], bronze['Name'])
            futures['bronze_count'] = pool.submit(
                _get_row_count_safe, bronze['LakehouseName'], bronze['Schema'], bronze['Name'])
        if silver:
            futures['silver_cols'] = pool.submit(
                _get_columns_safe, silver['LakehouseName'], silver['Schema'], silver['Name'])
            futures['silver_count'] = pool.submit(
                _get_row_count_safe, silver['LakehouseName'], silver['Schema'], silver['Name'])

        if 'bronze_cols' in futures:
            bronze_columns = futures['bronze_cols'].result(timeout=30)
        if 'silver_cols' in futures:
            silver_columns = futures['silver_cols'].result(timeout=30)
        if 'bronze_count' in futures:
            bronze_row_count = futures['bronze_count'].result(timeout=30)
        if 'silver_count' in futures:
            silver_row_count = futures['silver_count'].result(timeout=30)

    # Step 5: Build schema diff
    schema_diff = _build_schema_diff(bronze_columns, silver_columns)

    # Step 6: Assemble response
    result = {
        'entityId': lz_entity_id,
        'source': {
            'schema': lz['SourceSchema'],
            'name': lz['SourceName'],
            'dataSourceName': lz['DataSourceName'],
            'dataSourceType': lz.get('DataSourceType', ''),
            'namespace': lz.get('Namespace', ''),
            'connectionName': lz.get('ConnectionName', ''),
            'connectionType': lz.get('ConnectionType', ''),
        },
        'landing': {
            'entityId': int(lz['LandingzoneEntityId']),
            'fileName': lz['FileName'],
            'filePath': lz['FilePath'],
            'fileType': lz['FileType'],
            'lakehouse': lz['LakehouseName'],
            'isIncremental': lz.get('IsIncremental') == 'True',
            'incrementalColumn': lz.get('IsIncrementalColumn'),
            'customSelect': lz.get('SourceCustomSelect'),
            'customNotebook': lz.get('CustomNotebookName'),
        },
        'bronze': None,
        'silver': None,
        'gold': None,
        'schemaDiff': schema_diff,
    }

    if bronze:
        result['bronze'] = {
            'entityId': int(bronze['BronzeLayerEntityId']),
            'schema': bronze['Schema'],
            'name': bronze['Name'],
            'primaryKeys': bronze.get('PrimaryKeys'),
            'fileType': bronze.get('FileType', 'DELTA'),
            'lakehouse': bronze['LakehouseName'],
            'rowCount': bronze_row_count,
            'columns': bronze_columns,
            'columnCount': len(bronze_columns),
        }

    if silver:
        result['silver'] = {
            'entityId': int(silver['SilverLayerEntityId']),
            'schema': silver['Schema'],
            'name': silver['Name'],
            'fileType': silver.get('FileType', 'DELTA'),
            'lakehouse': silver['LakehouseName'],
            'rowCount': silver_row_count,
            'columns': silver_columns,
            'columnCount': len(silver_columns),
        }

    return result


def _delete_onelake_path(workspace_id: str, lakehouse_id: str, path: str) -> bool:
    """Delete a file or directory from OneLake via ADLS Gen2 API. Returns True on success."""
    try:
        token = get_fabric_token('https://storage.azure.com/.default')
        url = f'https://onelake.dfs.fabric.microsoft.com/{workspace_id}/{lakehouse_id}/{path}?recursive=true'
        req = urllib.request.Request(url, method='DELETE', headers={'Authorization': f'Bearer {token}'})
        urllib.request.urlopen(req)
        log.info(f'OneLake delete: {path}')
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log.info(f'OneLake path not found (already gone): {path}')
            return True  # Already gone is fine
        log.warning(f'OneLake delete failed ({e.code}): {path} — {e.read().decode()[:200]}')
        return False
    except Exception as e:
        log.warning(f'OneLake delete failed: {path} — {e}')
        return False


def _cascade_delete_entities(entity_ids: list[int]) -> dict:
    """Delete entities from Silver → Bronze → Landing (reverse order).
    Uses name-based matching ([Schema]+Name) to find related bronze/silver rows."""
    if not entity_ids:
        return {'bronze_dropped': 0, 'silver_dropped': 0, 'lz_files_dropped': 0}
    safe_ids = [int(eid) for eid in entity_ids]
    placeholders = ','.join('?' * len(safe_ids))

    # 1. Get landing zone entities
    lz_rows = _execute_parameterized(
        f"SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, le.FileName, le.FilePath, le.FileType "
        f"FROM integration.LandingzoneEntity le "
        f"WHERE le.LandingzoneEntityId IN ({placeholders})",
        tuple(safe_ids)
    )

    # 2. Find matching bronze entities by name
    bronze_rows = []
    if lz_rows:
        match_clauses = ' OR '.join('(be.[Schema] = ? AND be.Name = ?)' for _ in lz_rows)
        match_params = []
        for lz in lz_rows:
            match_params.extend([lz['SourceSchema'], lz['SourceName']])
        try:
            bronze_rows = _execute_parameterized(
                f"SELECT be.BronzeLayerEntityId, be.[Schema] AS SourceSchema, be.Name AS SourceName "
                f"FROM integration.BronzeLayerEntity be WHERE {match_clauses}",
                tuple(match_params)
            )
        except Exception as e:
            log.warning(f'Bronze cascade lookup failed: {e}')

    # 3. Find matching silver entities by name
    silver_rows = []
    if lz_rows:
        sv_clauses = ' OR '.join('(se.[Schema] = ? AND se.Name = ?)' for _ in lz_rows)
        sv_params = []
        for lz in lz_rows:
            sv_params.extend([lz['SourceSchema'], lz['SourceName']])
        try:
            silver_rows = _execute_parameterized(
                f"SELECT se.SilverLayerEntityId, se.[Schema] AS SourceSchema, se.Name AS SourceName "
                f"FROM integration.SilverLayerEntity se WHERE {sv_clauses}",
                tuple(sv_params)
            )
        except Exception as e:
            log.warning(f'Silver cascade lookup failed: {e}')

    # 4. Delete metadata rows (reverse order: silver → bronze → landing)
    silver_ids = [r['SilverLayerEntityId'] for r in silver_rows]
    bronze_ids = [r['BronzeLayerEntityId'] for r in bronze_rows]

    if silver_ids:
        sv_ph = ','.join('?' * len(silver_ids))
        _execute_parameterized(
            f"DELETE FROM integration.SilverLayerEntity WHERE SilverLayerEntityId IN ({sv_ph})",
            tuple(silver_ids)
        )
    if bronze_ids:
        br_ph = ','.join('?' * len(bronze_ids))
        _execute_parameterized(
            f"DELETE FROM integration.BronzeLayerEntity WHERE BronzeLayerEntityId IN ({br_ph})",
            tuple(bronze_ids)
        )
    _execute_parameterized(
        f"DELETE FROM integration.LandingzoneEntity WHERE LandingzoneEntityId IN ({placeholders})",
        tuple(safe_ids)
    )

    return {'bronze_dropped': len(bronze_ids), 'silver_dropped': len(silver_ids), 'lz_files_dropped': 0}


def delete_entity(entity_id: int) -> dict:
    """Hard-delete a LandingzoneEntity and cascade to Bronze/Silver (metadata + physical data)."""
    eid = int(entity_id)
    impact = get_cascade_impact([eid])
    if not impact['landing']:
        return {'error': f'Entity {entity_id} not found'}
    entity = impact['landing'][0]
    try:
        drop_stats = _cascade_delete_entities([eid])
    except Exception as e:
        log.warning(f'Cascade delete failed (falling back to LZ-only): {e}')
        # Fall back: just delete the LZ entity metadata directly
        _execute_parameterized(
            "DELETE FROM integration.LandingzoneEntity WHERE LandingzoneEntityId = ?",
            (eid,)
        )
        drop_stats = {'bronze_dropped': 0, 'silver_dropped': 0, 'lz_files_dropped': 0}
    bronze_count = len(impact['bronze'])
    silver_count = len(impact['silver'])
    parts = [f'Deleted {entity["SourceSchema"]}.{entity["SourceName"]} from {entity["DataSourceName"]}']
    if bronze_count:
        parts.append(f'{bronze_count} bronze')
    if silver_count:
        parts.append(f'{silver_count} silver')
    msg = parts[0] + (f' (+ {", ".join(parts[1:])} cascade)' if len(parts) > 1 else '')
    log.info(f'Cascade delete: LZ={eid}, bronze={bronze_count}, silver={silver_count}, drops={drop_stats}')
    return {
        'success': True,
        'message': msg,
        'deletedId': eid,
        'cascade': {'bronze': bronze_count, 'silver': silver_count, **drop_stats},
    }


def bulk_delete_entities(entity_ids: list[int]) -> dict:
    """Hard-delete multiple LandingzoneEntity rows + cascade to Bronze/Silver (metadata + physical data)."""
    if not entity_ids:
        return {'error': 'No entity IDs provided'}
    safe_ids = [int(eid) for eid in entity_ids]
    impact = get_cascade_impact(safe_ids)
    if not impact['landing']:
        return {'error': 'None of the provided entity IDs were found'}
    found_ids = {r['LandingzoneEntityId'] for r in impact['landing']}
    missing = [eid for eid in safe_ids if eid not in found_ids]
    try:
        drop_stats = _cascade_delete_entities(list(found_ids))
    except Exception as e:
        log.warning(f'Bulk cascade delete failed (falling back to LZ-only): {e}')
        # Fall back: just delete the LZ entity metadata directly
        placeholders = ','.join('?' * len(found_ids))
        _execute_parameterized(
            f"DELETE FROM integration.LandingzoneEntity WHERE LandingzoneEntityId IN ({placeholders})",
            tuple(found_ids)
        )
        drop_stats = {'bronze_dropped': 0, 'silver_dropped': 0, 'lz_files_dropped': 0}
    deleted_names = [f"{r['SourceSchema']}.{r['SourceName']}" for r in impact['landing']]
    bronze_count = len(impact['bronze'])
    silver_count = len(impact['silver'])
    log.info(f'Bulk cascade delete: {len(found_ids)} LZ, {bronze_count} bronze, {silver_count} silver, drops={drop_stats}')
    return {
        'success': True,
        'message': f'Deleted {len(found_ids)} entities' + (f' (+ {bronze_count} bronze, {silver_count} silver cascade)' if bronze_count or silver_count else ''),
        'deletedIds': list(found_ids),
        'deletedNames': deleted_names,
        'missingIds': missing,
        'cascade': {'bronze': bronze_count, 'silver': silver_count, **drop_stats},
    }


def get_workspaces() -> list[dict]:
    return query_sql('SELECT * FROM integration.Workspace ORDER BY WorkspaceId')

def get_lakehouses() -> list[dict]:
    return query_sql('SELECT * FROM integration.Lakehouse ORDER BY LakehouseId')

def get_bronze_entities() -> list[dict]:
    return query_sql('SELECT * FROM integration.BronzeLayerEntity ORDER BY BronzeLayerEntityId')

def get_silver_entities() -> list[dict]:
    return query_sql('SELECT * FROM integration.SilverLayerEntity ORDER BY SilverLayerEntityId')

def get_schema_info() -> list[dict]:
    """Discover all tables and views in the database."""
    return query_sql(
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
        "FROM INFORMATION_SCHEMA.TABLES "
        "ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME"
    )

# ── Source Onboarding Tracker (dashboard-only, direct SQL, no stored procedures) ──

def ensure_onboarding_table():
    """Auto-create integration.SourceOnboarding if it doesn't exist."""
    create_sql = """
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SourceOnboarding' AND schema_id = SCHEMA_ID('integration'))
    BEGIN
        CREATE TABLE [integration].[SourceOnboarding] (
            OnboardingId        INT IDENTITY(1,1) PRIMARY KEY,
            SourceName          NVARCHAR(255)   NOT NULL,
            StepNumber          INT             NOT NULL,
            StepName            NVARCHAR(100)   NOT NULL,
            Status              NVARCHAR(50)    NOT NULL DEFAULT 'pending',
            ReferenceId         NVARCHAR(255)   NULL,
            Notes               NVARCHAR(MAX)   NULL,
            CompletedAt         DATETIME2       NULL,
            CreatedAt           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
            UpdatedAt           DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
            CONSTRAINT UQ_SourceOnboarding UNIQUE (SourceName, StepNumber),
            CONSTRAINT CK_StepNumber CHECK (StepNumber BETWEEN 1 AND 4),
            CONSTRAINT CK_Status CHECK (Status IN ('pending', 'in_progress', 'complete', 'skipped'))
        );
    END
    """
    try:
        query_sql(create_sql)
        log.info('  SourceOnboarding table: ensured')
    except Exception as e:
        log.warning(f'  SourceOnboarding auto-create failed (non-fatal): {e}')


ONBOARDING_STEPS = {
    1: 'Gateway Connection',
    2: 'Data Source',
    3: 'Landing Zone Entities',
    4: 'Pipeline Ready',
}

def _execute_parameterized(sql: str, params: tuple) -> list[dict]:
    """Execute parameterized SQL to prevent injection. Returns rows for SELECT, empty for DML."""
    conn = get_sql_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        if not cursor.description:
            conn.commit()
            return []
        cols = [c[0] for c in cursor.description]
        rows = cursor.fetchall()
        return [{c: (str(v) if v is not None else None) for c, v in zip(cols, row)} for row in rows]
    finally:
        conn.close()


def get_onboarding_sources() -> list[dict]:
    """Get all onboarding records grouped by source name."""
    try:
        rows = query_sql(
            'SELECT OnboardingId, SourceName, StepNumber, StepName, Status, '
            'ReferenceId, Notes, CompletedAt, CreatedAt, UpdatedAt '
            'FROM integration.SourceOnboarding '
            'ORDER BY SourceName, StepNumber'
        )
    except Exception as e:
        # Table might not exist yet — return empty gracefully
        if 'SourceOnboarding' in str(e):
            log.warning('integration.SourceOnboarding table not found — run create_source_onboarding.sql')
            return []
        raise
    # Group by source name
    sources: dict = {}
    for row in rows:
        name = row['SourceName']
        if name not in sources:
            sources[name] = {'sourceName': name, 'steps': [], 'createdAt': row['CreatedAt']}
        sources[name]['steps'].append({
            'stepNumber': int(row['StepNumber']),
            'stepName': row['StepName'],
            'status': row['Status'],
            'referenceId': row['ReferenceId'],
            'notes': row['Notes'],
            'completedAt': row['CompletedAt'],
            'updatedAt': row['UpdatedAt'],
        })
    return list(sources.values())


def create_onboarding(source_name: str) -> dict:
    """Create a new onboarding with 4 steps."""
    existing = _execute_parameterized(
        "SELECT COUNT(*) AS cnt FROM integration.SourceOnboarding WHERE SourceName = ?",
        (source_name,)
    )
    if existing and int(existing[0]['cnt']) > 0:
        return {'error': f'Onboarding for "{source_name}" already exists'}

    for step_num, step_name in ONBOARDING_STEPS.items():
        _execute_parameterized(
            "INSERT INTO integration.SourceOnboarding "
            "(SourceName, StepNumber, StepName, Status) VALUES (?, ?, ?, ?)",
            (source_name, step_num, step_name, 'pending')
        )
    log.info(f'Onboarding created for source: {source_name}')
    return {'success': True, 'message': f'Onboarding started for "{source_name}"', 'sourceName': source_name}


def update_onboarding_step(source_name: str, step_number: int, status: str,
                           reference_id: str = None, notes: str = None) -> dict:
    """Update a single onboarding step."""
    if step_number not in (1, 2, 3, 4):
        return {'error': 'stepNumber must be 1-4'}
    if status not in ('pending', 'in_progress', 'complete', 'skipped'):
        return {'error': 'status must be: pending, in_progress, complete, skipped'}

    completed_at = 'GETUTCDATE()' if status == 'complete' else 'NULL'

    # Build SET clause dynamically but use params for values
    _execute_parameterized(
        f"UPDATE integration.SourceOnboarding SET "
        f"Status = ?, ReferenceId = ?, Notes = ?, "
        f"CompletedAt = {completed_at}, UpdatedAt = GETUTCDATE() "
        f"WHERE SourceName = ? AND StepNumber = ?",
        (status, reference_id, notes, source_name, step_number)
    )
    log.info(f'Onboarding step {step_number} -> {status} for {source_name}')
    return {'success': True, 'sourceName': source_name, 'stepNumber': step_number, 'status': status}


def delete_onboarding(source_name: str) -> dict:
    """Remove all onboarding records for a source."""
    _execute_parameterized(
        "DELETE FROM integration.SourceOnboarding WHERE SourceName = ?",
        (source_name,)
    )
    log.info(f'Onboarding deleted for source: {source_name}')
    return {'success': True, 'message': f'Onboarding removed for "{source_name}"'}


def purge_source_data(source_name: str) -> dict:
    """Deep purge: remove all integration data for a source (entities, datasources, connections, onboarding).
    Matches by onboarding source name, datasource name, or namespace."""
    results = {'deleted': {'entities': 0, 'dataSources': 0, 'connections': 0, 'onboarding': 0}}

    # Normalize variations: "M3 CLOUD" -> also try "M3CLOUD"
    clean_name = source_name.replace(' ', '')

    # Find datasources matching by name or namespace (try multiple patterns)
    ds_rows = _execute_parameterized(
        "SELECT DataSourceId, Name, Namespace, ConnectionId FROM integration.DataSource "
        "WHERE Name = ? OR Namespace = ? OR Namespace = ? OR Name = ?",
        (source_name, source_name, clean_name, clean_name)
    )

    # Also check onboarding step 2 reference for datasource name
    try:
        onb_rows = _execute_parameterized(
            "SELECT ReferenceId FROM integration.SourceOnboarding "
            "WHERE SourceName = ? AND StepNumber = 2 AND ReferenceId IS NOT NULL",
            (source_name,)
        )
        for row in onb_rows:
            ref = row.get('ReferenceId', '')
            if ref:
                extra = _execute_parameterized(
                    "SELECT DataSourceId, Name, Namespace, ConnectionId FROM integration.DataSource WHERE Name = ?",
                    (ref,)
                )
                for ds in extra:
                    if not any(r['DataSourceId'] == ds['DataSourceId'] for r in ds_rows):
                        ds_rows.append(ds)
    except Exception:
        pass  # onboarding table might not exist

    ds_ids = [int(r['DataSourceId']) for r in ds_rows]
    conn_ids = list(set(int(r['ConnectionId']) for r in ds_rows))

    # Delete landing zone entities for those datasources
    for ds_id in ds_ids:
        cnt = _execute_parameterized(
            "SELECT COUNT(*) AS cnt FROM integration.LandingzoneEntity WHERE DataSourceId = ?",
            (ds_id,)
        )
        results['deleted']['entities'] += int(cnt[0]['cnt']) if cnt else 0
        _execute_parameterized(
            "DELETE FROM integration.LandingzoneEntity WHERE DataSourceId = ?",
            (ds_id,)
        )

    # Delete datasources
    for ds_id in ds_ids:
        _execute_parameterized(
            "DELETE FROM integration.DataSource WHERE DataSourceId = ?",
            (ds_id,)
        )
    results['deleted']['dataSources'] = len(ds_ids)

    # Delete connections (only if no other datasources reference them)
    for conn_id in conn_ids:
        refs = _execute_parameterized(
            "SELECT COUNT(*) AS cnt FROM integration.DataSource WHERE ConnectionId = ?",
            (conn_id,)
        )
        if refs and int(refs[0]['cnt']) == 0:
            _execute_parameterized(
                "DELETE FROM integration.Connection WHERE ConnectionId = ?",
                (conn_id,)
            )
            results['deleted']['connections'] += 1

    # Delete onboarding records
    try:
        onb_cnt = _execute_parameterized(
            "SELECT COUNT(*) AS cnt FROM integration.SourceOnboarding WHERE SourceName = ?",
            (source_name,)
        )
        results['deleted']['onboarding'] = int(onb_cnt[0]['cnt']) if onb_cnt else 0
        _execute_parameterized(
            "DELETE FROM integration.SourceOnboarding WHERE SourceName = ?",
            (source_name,)
        )
    except Exception:
        pass

    results['success'] = True
    results['message'] = f'Purged all data for "{source_name}"'
    log.info(f'Source purge: {source_name} -> {results["deleted"]}')
    return results


CONTROL_PLANE_SNAPSHOT = Path(__file__).parent / 'control_plane_snapshot.json'


def _save_control_plane_snapshot(data: dict):
    """Persist a JSON snapshot as failsafe in case SQL DB goes down."""
    try:
        CONTROL_PLANE_SNAPSHOT.write_text(json.dumps(data, indent=2), encoding='utf-8')
        log.debug(f'Control plane snapshot saved → {CONTROL_PLANE_SNAPSHOT}')
    except Exception as e:
        log.warning(f'Could not save control plane snapshot: {e}')


def _load_control_plane_snapshot() -> dict | None:
    """Load last known good snapshot from disk."""
    if CONTROL_PLANE_SNAPSHOT.is_file():
        try:
            data = json.loads(CONTROL_PLANE_SNAPSHOT.read_text(encoding='utf-8'))
            data['_fromSnapshot'] = True
            data['_snapshotAge'] = CONTROL_PLANE_SNAPSHOT.stat().st_mtime
            return data
        except Exception as e:
            log.warning(f'Could not load control plane snapshot: {e}')
    return None


_control_plane_cache: dict | None = None
_control_plane_cache_ts: float = 0
_control_plane_lock = threading.Lock()
CONTROL_PLANE_CACHE_TTL = 60  # seconds


def get_control_plane() -> dict:
    """Aggregate read-only view of the entire data platform for business users.
    Serves from in-memory cache (60s TTL), falls back to disk snapshot, then live SQL."""
    global _control_plane_cache, _control_plane_cache_ts

    # 1. In-memory cache hit (thread-safe read)
    with _control_plane_lock:
        if _control_plane_cache and (time.time() - _control_plane_cache_ts) < CONTROL_PLANE_CACHE_TTL:
            return _control_plane_cache

    # 2. Live fetch
    try:
        result = _get_control_plane_live()
        with _control_plane_lock:
            _control_plane_cache = result
            _control_plane_cache_ts = time.time()
        return result
    except Exception as e:
        log.error(f'Control plane SQL query failed: {e}')
        snapshot = _load_control_plane_snapshot()
        if snapshot:
            log.warning('Serving control plane from snapshot (SQL unavailable)')
            return snapshot
        return {
            'health': 'offline',
            'error': f'SQL Database unavailable: {e}',
            '_fromSnapshot': False,
            'summary': {
                'connections': {'total': 0, 'active': 0},
                'dataSources': {'total': 0, 'active': 0},
                'entities': {'landing': {'total': 0, 'active': 0}, 'bronze': {'total': 0, 'active': 0}, 'silver': {'total': 0, 'active': 0}},
                'pipelines': {'total': 0, 'active': 0},
                'lakehouses': 0, 'workspaces': 0,
            },
            'pipelineHealth': {'recentRuns': 0, 'succeeded': 0, 'failed': 0, 'running': 0},
            'sourceSystems': [], 'lakehouses': [], 'workspaces': [], 'recentRuns': [],
        }


def _get_control_plane_live() -> dict:
    """Live SQL-backed control plane data. Runs all queries in parallel for speed."""
    now_utc = datetime.utcnow().isoformat() + 'Z'
    t_start = time.time()

    # Define all queries upfront
    queries = {
        'connections': 'SELECT ConnectionId, Name, Type, IsActive FROM integration.Connection ORDER BY Name',
        'datasources': (
            'SELECT ds.DataSourceId, ds.Name, ds.Namespace, ds.Type, ds.Description, '
            'ds.IsActive, c.Name AS ConnectionName '
            'FROM integration.DataSource ds '
            'JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId '
            'ORDER BY ds.Namespace, ds.Name'
        ),
        'lz_entities': (
            'SELECT le.LandingzoneEntityId, le.SourceSchema, le.SourceName, le.IsActive, '
            'le.IsIncremental, ds.Name AS DataSourceName, ds.Namespace '
            'FROM integration.LandingzoneEntity le '
            'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
            'ORDER BY ds.Namespace, le.SourceName'
        ),
        'bronze_entities': (
            'SELECT be.BronzeLayerEntityId, be.[Schema], be.Name, be.IsActive '
            'FROM integration.BronzeLayerEntity be ORDER BY be.Name'
        ),
        'silver_entities': (
            'SELECT se.SilverLayerEntityId, se.[Schema], se.Name, se.IsActive '
            'FROM integration.SilverLayerEntity se ORDER BY se.Name'
        ),
        'lakehouses': 'SELECT LakehouseId, Name FROM integration.Lakehouse ORDER BY Name',
        'workspaces': 'SELECT WorkspaceId, Name FROM integration.Workspace ORDER BY Name',
        'pipelines': 'SELECT PipelineId, Name, IsActive FROM integration.Pipeline ORDER BY Name',
        'recent_runs': 'SELECT TOP 50 * FROM logging.PipelineExecution ORDER BY 1 DESC',
    }

    # Run all queries in parallel (each gets its own connection)
    results = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {key: pool.submit(query_sql, sql) for key, sql in queries.items()}
        for key, future in futures.items():
            try:
                results[key] = future.result(timeout=30)
            except Exception:
                results[key] = []

    connections = results['connections']
    datasources = results['datasources']
    lz_entities = results['lz_entities']
    bronze_entities = results['bronze_entities']
    silver_entities = results['silver_entities']
    lakehouses = results['lakehouses']
    workspaces = results['workspaces']
    pipelines = results['pipelines']
    recent_runs = results['recent_runs']

    log.info(f'Control plane: 9 queries in {time.time() - t_start:.1f}s (parallel)')

    # -- Aggregate by namespace (source system) --
    source_systems = {}
    for ds in datasources:
        ns = ds.get('Namespace', 'Unknown')
        if ns not in source_systems:
            source_systems[ns] = {
                'namespace': ns,
                'connections': [],
                'dataSources': [],
                'entities': {'landing': 0, 'bronze': 0, 'silver': 0},
                'activeEntities': {'landing': 0, 'bronze': 0, 'silver': 0},
            }
        source_systems[ns]['dataSources'].append({
            'name': ds['Name'],
            'type': ds['Type'],
            'isActive': ds['IsActive'],
            'connectionName': ds['ConnectionName'],
        })

    # Link connections to source systems
    conn_to_ns = {}
    for ds in datasources:
        conn_to_ns[ds['ConnectionName']] = ds.get('Namespace', 'Unknown')
    for conn in connections:
        ns = conn_to_ns.get(conn['Name'], 'Unlinked')
        if ns not in source_systems:
            source_systems[ns] = {
                'namespace': ns,
                'connections': [],
                'dataSources': [],
                'entities': {'landing': 0, 'bronze': 0, 'silver': 0},
                'activeEntities': {'landing': 0, 'bronze': 0, 'silver': 0},
            }
        source_systems[ns]['connections'].append({
            'name': conn['Name'],
            'type': conn['Type'],
            'isActive': conn['IsActive'],
        })

    # Count entities per namespace
    for ent in lz_entities:
        ns = ent.get('Namespace', 'Unknown')
        if ns in source_systems:
            source_systems[ns]['entities']['landing'] += 1
            if str(ent.get('IsActive', '')).lower() in ('true', '1'):
                source_systems[ns]['activeEntities']['landing'] += 1

    # Summary counts
    active_conn = sum(1 for c in connections if str(c.get('IsActive', '')).lower() in ('true', '1'))
    active_ds = sum(1 for d in datasources if str(d.get('IsActive', '')).lower() in ('true', '1'))
    active_lz = sum(1 for e in lz_entities if str(e.get('IsActive', '')).lower() in ('true', '1'))
    active_br = sum(1 for e in bronze_entities if str(e.get('IsActive', '')).lower() in ('true', '1'))
    active_sv = sum(1 for e in silver_entities if str(e.get('IsActive', '')).lower() in ('true', '1'))
    active_pl = sum(1 for p in pipelines if str(p.get('IsActive', '')).lower() in ('true', '1'))

    # Pipeline health from recent runs
    successful_runs = sum(1 for r in recent_runs if str(r.get('Status', '')).lower() == 'succeeded')
    failed_runs = sum(1 for r in recent_runs if str(r.get('Status', '')).lower() == 'failed')
    running_now = sum(1 for r in recent_runs if str(r.get('Status', '')).lower() in ('inprogress', 'running'))

    # Overall health
    if failed_runs > 0 and successful_runs == 0:
        health = 'critical'
    elif failed_runs > 0:
        health = 'warning'
    elif active_conn == 0:
        health = 'setup'
    else:
        health = 'healthy'

    result = {
        'health': health,
        'lastRefreshed': now_utc,
        '_fromSnapshot': False,
        'summary': {
            'connections': {'total': len(connections), 'active': active_conn},
            'dataSources': {'total': len(datasources), 'active': active_ds},
            'entities': {
                'landing': {'total': len(lz_entities), 'active': active_lz},
                'bronze': {'total': len(bronze_entities), 'active': active_br},
                'silver': {'total': len(silver_entities), 'active': active_sv},
            },
            'pipelines': {'total': len(pipelines), 'active': active_pl},
            'lakehouses': len(lakehouses),
            'workspaces': len(workspaces),
        },
        'pipelineHealth': {
            'recentRuns': len(recent_runs),
            'succeeded': successful_runs,
            'failed': failed_runs,
            'running': running_now,
        },
        'sourceSystems': list(source_systems.values()),
        'lakehouses': lakehouses,
        'workspaces': workspaces,
        'recentRuns': recent_runs[:10],  # Last 10 for display
    }

    # Persist snapshot for failsafe
    _save_control_plane_snapshot(result)
    return result


def get_dashboard_stats() -> dict:
    """Aggregate stats for the dashboard from live metadata tables."""
    connections = query_sql('SELECT COUNT(*) AS cnt FROM integration.Connection WHERE IsActive = 1')
    datasources = query_sql('SELECT COUNT(*) AS cnt FROM integration.DataSource WHERE IsActive = 1')
    entities = query_sql('SELECT COUNT(*) AS cnt FROM integration.LandingzoneEntity WHERE IsActive = 1')
    lakehouses = query_sql('SELECT COUNT(*) AS cnt FROM integration.Lakehouse')

    # Entity counts by datasource (proxy for "by layer" until we have layer metadata)
    entity_breakdown = query_sql(
        'SELECT ds.Name AS DataSourceName, ds.Type AS DataSourceType, COUNT(*) AS EntityCount '
        'FROM integration.LandingzoneEntity le '
        'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
        'WHERE le.IsActive = 1 '
        'GROUP BY ds.Name, ds.Type '
        'ORDER BY EntityCount DESC'
    )

    return {
        'activeConnections': int(connections[0]['cnt']) if connections else 0,
        'activeDataSources': int(datasources[0]['cnt']) if datasources else 0,
        'activeEntities': int(entities[0]['cnt']) if entities else 0,
        'lakehouses': int(lakehouses[0]['cnt']) if lakehouses else 0,
        'entityBreakdown': entity_breakdown,
    }


# ── Registration (POST handlers) ──

def _sanitize_sql_str(val: str) -> str:
    """Escape single quotes for SQL string literals (defense-in-depth alongside parameterized queries)."""
    return str(val).replace("'", "''")


def register_connection(body: dict) -> dict:
    guid = _sanitize_sql_str(body.get('connectionGuid', ''))
    name = _sanitize_sql_str(body.get('name', ''))
    conn_type = _sanitize_sql_str(body.get('type', 'SqlServer'))
    sql = (
        f"EXEC [integration].[sp_UpsertConnection] "
        f"@ConnectionGuid = '{guid}', "
        f"@Name = '{name}', "
        f"@Type = '{conn_type}', "
        f"@IsActive = 1"
    )
    query_sql(sql)
    log.info(f'Connection registered: {name} ({guid[:8]}...)')
    return {'success': True, 'message': f'Connection {name} registered'}

def register_datasource(body: dict) -> dict:
    conn_name = body.get('connectionName', '')
    name = body.get('name', '')
    namespace = body.get('namespace', '')
    ds_type = body.get('type', 'ASQL_01')
    description = body.get('description', '')

    # Pre-flight: verify Connection exists (parameterized)
    conn_check = _execute_parameterized(
        "SELECT ConnectionId, Name FROM integration.Connection WHERE Name = ?", (conn_name,))
    if not conn_check:
        all_conns = query_sql("SELECT ConnectionId, Name FROM integration.Connection")
        conn_names = [r['Name'] for r in all_conns]
        log.error(f'Connection not found: "{conn_name}". Available: {conn_names}')
        raise ValueError(f'Connection "{conn_name}" not found in metadata DB. Available: {", ".join(conn_names)}')

    conn_id = conn_check[0]['ConnectionId']
    log.info(f'register_datasource: conn="{conn_name}" (id={conn_id}), ds="{name}", ns="{namespace}", type="{ds_type}"')

    # Check if datasource already exists (parameterized)
    ds_check = _execute_parameterized(
        "SELECT DataSourceId FROM integration.DataSource WHERE Name = ? AND Type = ?", (name, ds_type))
    ds_id_val = ds_check[0]['DataSourceId'] if ds_check else 'NULL'

    # Stored proc call — sanitize all string params
    s_name = _sanitize_sql_str(name)
    s_ns = _sanitize_sql_str(namespace)
    s_type = _sanitize_sql_str(ds_type)
    s_desc = _sanitize_sql_str(description)
    sql = (
        f"DECLARE @ConnId INT = {int(conn_id)} "
        f"DECLARE @DSId INT = {int(ds_id_val) if ds_id_val != 'NULL' else 'NULL'} "
        f"EXEC [integration].[sp_UpsertDataSource] "
        f"@ConnectionId = @ConnId, "
        f"@DataSourceId = @DSId, "
        f"@Name = '{s_name}', "
        f"@Namespace = '{s_ns}', "
        f"@Type = '{s_type}', "
        f"@Description = '{s_desc}', "
        f"@IsActive = 1"
    )
    query_sql(sql)

    # Verify the datasource was actually created (parameterized)
    verify = _execute_parameterized(
        "SELECT DataSourceId FROM integration.DataSource WHERE Name = ? AND Type = ?", (name, ds_type))
    if not verify:
        log.error(f'sp_UpsertDataSource completed but "{name}" not found in DB — proc may have silently failed')
        raise ValueError(f'Data source "{name}" was not created — sp_UpsertDataSource may have silently failed')

    log.info(f'Data source registered and verified: {name} (type={ds_type}, id={verify[0]["DataSourceId"]})')
    return {'success': True, 'message': f'Data source {name} registered'}

def register_entity(body: dict) -> dict:
    ds_name = body.get('dataSourceName', '')
    ds_type = body.get('dataSourceType', 'ASQL_01')
    schema = body.get('sourceSchema', 'dbo')
    table = body.get('sourceName', '')
    file_name = body.get('fileName', table)
    file_path = body.get('filePath', '')
    is_inc = 1 if body.get('isIncremental', False) else 0
    inc_col = body.get('incrementalColumn', '')
    custom_nb = body.get('customNotebookName', '')

    # Pre-flight: verify DataSourceId and LakehouseId exist (parameterized)
    ds_check = _execute_parameterized(
        "SELECT DataSourceId, Name, Type FROM integration.DataSource WHERE Name = ? AND Type = ?",
        (ds_name, ds_type))
    if not ds_check:
        all_ds = query_sql("SELECT DataSourceId, Name, Type FROM integration.DataSource")
        ds_names = [f"{r['Name']} (type={r['Type']})" for r in all_ds]
        log.error(f'DataSource not found: Name="{ds_name}" Type="{ds_type}". Available: {ds_names}')
        raise ValueError(f'DataSource "{ds_name}" (type={ds_type}) not found in metadata DB. Available: {", ".join(ds_names)}')

    lh_check = query_sql("SELECT LakehouseId, Name FROM integration.Lakehouse WHERE Name = 'LH_DATA_LANDINGZONE'")
    if not lh_check:
        all_lh = query_sql("SELECT LakehouseId, Name FROM integration.Lakehouse")
        lh_names = [r['Name'] for r in all_lh]
        log.error(f'Lakehouse LH_DATA_LANDINGZONE not found. Available: {lh_names}')
        raise ValueError(f'Lakehouse "LH_DATA_LANDINGZONE" not found. Available: {", ".join(lh_names)}')

    # Stored proc call — sanitize all string params
    s_schema = _sanitize_sql_str(schema)
    s_table = _sanitize_sql_str(table)
    s_file = _sanitize_sql_str(file_name)
    s_path = _sanitize_sql_str(file_path)
    s_inc_col = _sanitize_sql_str(inc_col)
    s_custom_nb = _sanitize_sql_str(custom_nb)
    sql = (
        f"DECLARE @DSId INT = {int(ds_check[0]['DataSourceId'])} "
        f"DECLARE @LHId INT = {int(lh_check[0]['LakehouseId'])} "
        f"DECLARE @LEId INT = (SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
        f"WHERE SourceSchema = '{s_schema}' AND SourceName = '{s_table}' AND DataSourceId = @DSId) "
        f"EXEC [integration].[sp_UpsertLandingzoneEntity] "
        f"@LandingzoneEntityId = @LEId, "
        f"@DataSourceId = @DSId, "
        f"@LakehouseId = @LHId, "
        f"@SourceSchema = '{s_schema}', "
        f"@SourceName = '{s_table}', "
        f"@SourceCustomSelect = '', "
        f"@FileName = '{s_file}', "
        f"@FilePath = '{s_path}', "
        f"@FileType = 'parquet', "
        f"@IsIncremental = {int(is_inc)}, "
        f"@IsIncrementalColumn = '{s_inc_col}', "
        f"@IsActive = 1, "
        f"@CustomNotebookName = '{s_custom_nb}'"
    )
    query_sql(sql)
    log.info(f'Entity registered: {schema}.{table}')
    return {'success': True, 'message': f'Entity {schema}.{table} registered'}


# ── Static File Serving ──

MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
}

def serve_static(handler, url_path: str) -> bool:
    """Serve a static file from STATIC_DIR. Returns True if served, False if not found."""
    if not STATIC_DIR.exists():
        return False

    # Clean URL path
    clean = url_path.split('?')[0].split('#')[0]
    if clean == '/':
        clean = '/index.html'

    file_path = STATIC_DIR / clean.lstrip('/')

    # Security: prevent directory traversal
    try:
        file_path.resolve().relative_to(STATIC_DIR.resolve())
    except ValueError:
        return False

    if file_path.is_file():
        ext = file_path.suffix.lower()
        content_type = MIME_TYPES.get(ext, mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream')
        handler.send_response(200)
        handler.send_header('Content-Type', content_type)
        # Cache static assets (hashed filenames) for 1 year, html for 0
        if ext in ('.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.svg'):
            handler.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            handler.send_header('Cache-Control', 'no-cache')
        handler.end_headers()
        handler.wfile.write(file_path.read_bytes())
        return True

    # SPA fallback: serve index.html for client-side routing
    index = STATIC_DIR / 'index.html'
    if index.is_file():
        handler.send_response(200)
        handler.send_header('Content-Type', 'text/html')
        handler.send_header('Cache-Control', 'no-cache')
        handler.end_headers()
        handler.wfile.write(index.read_bytes())
        return True

    return False


# ── HTTP Handler ──

class DashboardHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _error_response(self, message, status=500):
        log.error(f'{self.path} → {status}: {message}')
        self._json_response({'error': message}, status)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            # API routes
            if self.path == '/api/gateway-connections':
                self._json_response(get_gateway_connections())
            elif self.path == '/api/connections':
                self._json_response(get_registered_connections())
            elif self.path == '/api/datasources':
                self._json_response(get_registered_datasources())
            elif self.path == '/api/entities':
                self._json_response(get_registered_entities())
            elif self.path.startswith('/api/entities/cascade-impact'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ids_str = qs.get('ids', [''])[0]
                if not ids_str:
                    self._error_response('ids param required (comma-separated)', 400)
                else:
                    ids = [int(x) for x in ids_str.split(',') if x.strip().isdigit()]
                    self._json_response(get_cascade_impact(ids))
            elif self.path == '/api/pipeline-view':
                self._json_response(get_pipeline_view())
            elif self.path == '/api/bronze-view':
                self._json_response(get_bronze_view())
            elif self.path == '/api/silver-view':
                self._json_response(get_silver_view())
            elif self.path == '/api/pipelines':
                self._json_response(get_pipelines())
            elif self.path == '/api/workspaces':
                self._json_response(get_workspaces())
            elif self.path == '/api/lakehouses':
                self._json_response(get_lakehouses())
            elif self.path == '/api/bronze-entities':
                self._json_response(get_bronze_entities())
            elif self.path == '/api/silver-entities':
                self._json_response(get_silver_entities())
            elif self.path == '/api/pipeline-executions':
                self._json_response(get_pipeline_executions())
            elif self.path == '/api/fabric-jobs':
                self._json_response(get_fabric_job_instances())
            elif self.path.startswith('/api/pipeline-activity-runs'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceGuid', [''])[0]
                job_id = qs.get('jobInstanceId', [''])[0]
                if not ws or not job_id:
                    self._error_response('workspaceGuid and jobInstanceId are required', 400)
                else:
                    self._json_response(get_pipeline_activity_runs(ws, job_id))
            elif self.path == '/api/copy-executions':
                self._json_response(get_copy_executions())
            elif self.path == '/api/notebook-executions':
                self._json_response(get_notebook_executions())
            elif self.path == '/api/schema':
                self._json_response(get_schema_info())
            elif self.path == '/api/stats':
                self._json_response(get_dashboard_stats())
            elif self.path == '/api/health':
                self._json_response({
                    'status': 'ok',
                    'sql': SQL_SERVER,
                    'mode': 'production' if STATIC_DIR.exists() else 'api-only',
                    'static_dir': str(STATIC_DIR),
                    'purview': PURVIEW_ACCOUNT or None,
                })
            # Control Plane (read-only aggregate view)
            elif self.path == '/api/control-plane':
                self._json_response(get_control_plane())
            # Onboarding endpoints
            elif self.path == '/api/onboarding':
                self._json_response(get_onboarding_sources())
            # Data Journey endpoint
            elif self.path.startswith('/api/journey'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                entity_id = qs.get('entity', [''])[0]
                if not entity_id or not entity_id.isdigit():
                    self._error_response('entity param required (LandingzoneEntityId)', 400)
                else:
                    self._json_response(get_entity_journey(int(entity_id)))
            # Blender endpoints
            elif self.path == '/api/blender/tables':
                self._json_response(get_blender_tables())
            elif self.path == '/api/blender/endpoints':
                self._json_response(discover_lakehouse_endpoints())
            elif self.path.startswith('/api/lakehouse-counts'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                force = qs.get('force', [''])[0].lower() in ('1', 'true')
                self._json_response(get_lakehouse_row_counts(force_refresh=force))
            elif self.path.startswith('/api/blender/profile?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                lh = qs.get('lakehouse', [''])[0]
                schema = qs.get('schema', ['dbo'])[0]
                table = qs.get('table', [''])[0]
                if not lh or not table:
                    self._error_response('lakehouse and table params required', 400)
                else:
                    self._json_response(profile_lakehouse_table(lh, schema, table))
            elif self.path.startswith('/api/blender/sample?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                lh = qs.get('lakehouse', [''])[0]
                schema = qs.get('schema', ['dbo'])[0]
                table = qs.get('table', [''])[0]
                limit = max(1, min(int(qs.get('limit', ['25'])[0]), 1000))
                if not lh or not table:
                    self._error_response('lakehouse and table params required', 400)
                else:
                    self._json_response(sample_lakehouse_table(lh, schema, table, limit))
            # Purview endpoints
            elif self.path == '/api/purview/status':
                self._json_response(purview_status())
            elif self.path.startswith('/api/purview/search?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                keyword = qs.get('q', [''])[0]
                limit = max(1, min(int(qs.get('limit', ['25'])[0]), 1000))
                self._json_response(purview_search(keyword, limit))
            elif self.path.startswith('/api/purview/entity/'):
                guid = self.path.split('/api/purview/entity/')[1].split('?')[0]
                self._json_response(purview_get_entity(guid))
            elif self.path.startswith('/api/'):
                self._error_response('Not found', 404)
            else:
                # Static file serving (production mode)
                if not serve_static(self, self.path):
                    self._error_response('Not found', 404)
        except Exception as e:
            log.exception(f'Error handling GET {self.path}')
            self._error_response(str(e))

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length)) if content_length else {}

            if self.path == '/api/source-tables':
                server = body.get('server', '')
                database = body.get('database', '')
                username = body.get('username', '')
                password = body.get('password', '')
                if not server or not database:
                    self._error_response('server and database are required', 400)
                else:
                    self._json_response(discover_source_tables(server, database, username, password))
            elif self.path == '/api/connections':
                self._json_response(register_connection(body), 201)
            elif self.path == '/api/datasources':
                self._json_response(register_datasource(body), 201)
            elif self.path == '/api/entities':
                self._json_response(register_entity(body), 201)
            elif self.path.startswith('/api/purview/entity/'):
                guid = self.path.split('/api/purview/entity/')[1].split('?')[0]
                self._json_response(purview_update_entity(guid, body))
            elif self.path == '/api/purview/search':
                keyword = body.get('keyword', '')
                limit = body.get('limit', 25)
                self._json_response(purview_search(keyword, limit))
            elif self.path == '/api/blender/query':
                lh = body.get('lakehouse', '')
                sql = body.get('sql', '')
                if not lh or not sql:
                    self._error_response('lakehouse and sql params required', 400)
                else:
                    self._json_response(execute_blender_query(lh, sql))
            # Onboarding endpoints
            elif self.path == '/api/onboarding':
                source_name = body.get('sourceName', '').strip()
                if not source_name:
                    self._error_response('sourceName is required', 400)
                else:
                    result = create_onboarding(source_name)
                    self._json_response(result, 201 if 'success' in result else 409)
            elif self.path == '/api/onboarding/step':
                source_name = body.get('sourceName', '')
                step = int(body.get('stepNumber', 0))
                status = body.get('status', '')
                ref_id = body.get('referenceId')
                notes = body.get('notes')
                if not source_name or not step or not status:
                    self._error_response('sourceName, stepNumber, and status are required', 400)
                else:
                    result = update_onboarding_step(source_name, step, status, ref_id, notes)
                    self._json_response(result)
            elif self.path == '/api/onboarding/delete':
                source_name = body.get('sourceName', '')
                if not source_name:
                    self._error_response('sourceName is required', 400)
                else:
                    self._json_response(delete_onboarding(source_name))
            elif self.path == '/api/entities/bulk-delete':
                ids = body.get('ids', [])
                if not ids or not isinstance(ids, list):
                    self._error_response('ids array is required', 400)
                else:
                    result = bulk_delete_entities(ids)
                    if 'error' in result:
                        self._error_response(result['error'], 500)
                    else:
                        self._json_response(result)
            elif self.path == '/api/sources/purge':
                source_name = body.get('sourceName', '')
                if not source_name:
                    self._error_response('sourceName is required', 400)
                else:
                    self._json_response(purge_source_data(source_name))
            elif self.path == '/api/pipeline/trigger':
                pipeline_name = body.get('pipelineName', '').strip()
                if not pipeline_name:
                    self._error_response('pipelineName is required', 400)
                else:
                    self._json_response(trigger_pipeline(pipeline_name))
            else:
                self._error_response('Not found', 404)
        except Exception as e:
            log.exception(f'Error handling POST {self.path}')
            self._error_response(str(e))

    def do_DELETE(self):
        try:
            if self.path.startswith('/api/entities/'):
                entity_id = self.path.split('/api/entities/')[1].split('?')[0]
                try:
                    eid = int(entity_id)
                except ValueError:
                    self._error_response('Invalid entity ID', 400)
                    return
                result = delete_entity(eid)
                if 'error' in result:
                    self._error_response(result['error'], 404)
                else:
                    self._json_response(result)
            else:
                self._error_response('Not found', 404)
        except Exception as e:
            log.exception(f'Error handling DELETE {self.path}')
            self._error_response(str(e))

    def log_message(self, format, *args):
        log.debug(f'{self.client_address[0]} {args[0]}')


# ── Entry Point ──

if __name__ == '__main__':
    mode = 'production' if STATIC_DIR.exists() else 'api-only'

    log.info('=' * 60)
    log.info('FMD Operations Dashboard')
    log.info('=' * 60)
    log.info(f'  Mode:       {mode}')
    log.info(f'  Server:     http://{HOST}:{PORT}')
    log.info(f'  SQL:        {SQL_SERVER[:40]}...')
    log.info(f'  Database:   {SQL_DATABASE[:40]}...')
    if mode == 'production':
        log.info(f'  Static:     {STATIC_DIR}')
    log.info(f'  Log file:   {log_cfg.get("file", "console only")}')
    log.info('')
    log.info('API Endpoints:')
    log.info('  GET  /api/gateway-connections')
    log.info('  GET  /api/connections')
    log.info('  GET  /api/datasources')
    log.info('  GET  /api/entities')
    log.info('  GET  /api/pipeline-view')
    log.info('  GET  /api/health')
    log.info('  POST /api/connections')
    log.info('  POST /api/datasources')
    log.info('  POST /api/entities')
    log.info('  GET  /api/onboarding')
    log.info('  POST /api/onboarding')
    log.info('  POST /api/onboarding/step')
    log.info('  POST /api/onboarding/delete')
    log.info('  GET  /api/control-plane')
    log.info(f'  Snapshot:   {CONTROL_PLANE_SNAPSHOT}')
    if mode == 'production':
        log.info('')
        log.info('  /*   → Static files from dist/')
    log.info('=' * 60)

    # Auto-create dashboard-only tables if they don't exist
    ensure_onboarding_table()

    server = HTTPServer((HOST, PORT), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info('Shutting down.')
        server.server_close()
