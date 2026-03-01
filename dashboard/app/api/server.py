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
import socketserver
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import threading
import time

# ── Configuration ──

# Load .env file if present (manual implementation — no dependency on python-dotenv)
_env_file = Path(__file__).parent / '.env'
if _env_file.exists():
    _env_loaded = 0
    with open(_env_file) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _key, _, _val = _line.partition('=')
                os.environ.setdefault(_key.strip(), _val.strip())
                _env_loaded += 1
    print(f'  .env loaded: {_env_loaded} vars from {_env_file}')
else:
    print(f'  WARNING: .env not found at {_env_file}')


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
            display_name = row.get('FileName') or row['SourceName']
            key = f"{row.get('LakehouseName', 'LH_DATA_LANDINGZONE')}.{row.get('SourceSchema', 'dbo')}.{display_name}"
            seen.add(key)
            tables.append({
                'id': f"lz-{row['Id']}",
                'name': display_name,
                'layer': 'landing',
                'lakehouse': row.get('LakehouseName', 'LH_DATA_LANDINGZONE'),
                'schema': row.get('SourceSchema', 'dbo'),
                'source': 'metadata',
                'dataSource': row.get('DataSourceName', ''),
            })

        br = query_sql(
            'SELECT be.BronzeLayerEntityId AS Id, be.[Schema] AS SourceSchema, be.Name AS SourceName, '
            'be.IsActive, lh.Name AS LakehouseName, le.SourceName AS OriginalName '
            'FROM integration.BronzeLayerEntity be '
            'JOIN integration.Lakehouse lh ON be.LakehouseId = lh.LakehouseId '
            'JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId '
            'WHERE be.IsActive = 1 '
            'ORDER BY le.SourceName'
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
            'se.IsActive, lh.Name AS LakehouseName, le.SourceName AS OriginalName '
            'FROM integration.SilverLayerEntity se '
            'JOIN integration.Lakehouse lh ON se.LakehouseId = lh.LakehouseId '
            'JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId '
            'JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId '
            'WHERE se.IsActive = 1 '
            'ORDER BY le.SourceName'
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
        'ds.Name AS DataSourceName, ds.Namespace AS DataSourceNamespace '
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

def get_live_monitor() -> dict:
    """Real-time pipeline monitoring: pipeline runs, entity progress, notebook/copy activity."""
    result = {}

    # 1. Recent pipeline events (last 4 hours)
    try:
        result['pipelineEvents'] = query_sql("""
            SELECT TOP 30 PipelineName, LogType, LogDateTime, LogData,
                   CONVERT(NVARCHAR(36), PipelineRunGuid) AS PipelineRunGuid,
                   EntityLayer
            FROM [logging].[PipelineExecution]
            WHERE LogDateTime > DATEADD(HOUR, -4, GETUTCDATE())
            ORDER BY LogDateTime DESC
        """)
    except Exception:
        result['pipelineEvents'] = []

    # 2. Recent notebook executions (entity-level, last 4 hours)
    try:
        result['notebookEvents'] = query_sql("""
            SELECT TOP 100 NotebookName, LogType, LogDateTime, LogData,
                   EntityId, EntityLayer,
                   CONVERT(NVARCHAR(36), PipelineRunGuid) AS PipelineRunGuid
            FROM [logging].[NotebookExecution]
            WHERE LogDateTime > DATEADD(HOUR, -4, GETUTCDATE())
            ORDER BY LogDateTime DESC
        """)
    except Exception:
        result['notebookEvents'] = []

    # 3. Recent copy activity (LZ loads, last 4 hours)
    try:
        result['copyEvents'] = query_sql("""
            SELECT TOP 50 CopyActivityName, CopyActivityParameters AS EntityName,
                   LogType, LogDateTime, LogData, EntityId, EntityLayer,
                   CONVERT(NVARCHAR(36), PipelineRunGuid) AS PipelineRunGuid
            FROM [logging].[CopyActivityExecution]
            WHERE LogDateTime > DATEADD(HOUR, -4, GETUTCDATE())
            ORDER BY LogDateTime DESC
        """)
    except Exception:
        result['copyEvents'] = []

    # 4. Processing counts
    try:
        counts_rows = query_sql("""
            SELECT
                (SELECT COUNT(*) FROM [integration].[LandingzoneEntity]) AS lzRegistered,
                (SELECT COUNT(*) FROM [execution].[PipelineLandingzoneEntity]) AS lzPipelineTotal,
                (SELECT COUNT(*) FROM [execution].[PipelineLandingzoneEntity] WHERE IsProcessed = 1) AS lzProcessed,
                (SELECT COUNT(*) FROM [integration].[BronzeLayerEntity]) AS brzRegistered,
                (SELECT COUNT(*) FROM [execution].[PipelineBronzeLayerEntity]) AS brzPipelineTotal,
                (SELECT COUNT(*) FROM [execution].[PipelineBronzeLayerEntity] WHERE IsProcessed = 1) AS brzProcessed,
                (SELECT COUNT(*) FROM [integration].[SilverLayerEntity]) AS slvRegistered,
                (SELECT COUNT(*) FROM [execution].[vw_LoadToBronzeLayer]) AS brzViewPending,
                (SELECT COUNT(*) FROM [execution].[vw_LoadToSilverLayer]) AS slvViewPending
        """)
        result['counts'] = counts_rows[0] if counts_rows else {}
    except Exception:
        result['counts'] = {}

    # 5. Recently processed Bronze entities
    try:
        result['bronzeEntities'] = query_sql("""
            SELECT TOP 20 pbe.BronzeLayerEntityId, pbe.SchemaName, pbe.TableName,
                   pbe.InsertDateTime, pbe.IsProcessed, pbe.LoadEndDateTime
            FROM [execution].[PipelineBronzeLayerEntity] pbe
            ORDER BY pbe.InsertDateTime DESC
        """)
    except Exception:
        result['bronzeEntities'] = []

    # 6. Recently processed LZ entities
    try:
        result['lzEntities'] = query_sql("""
            SELECT TOP 20 ple.LandingzoneEntityId, ple.FilePath, ple.FileName,
                   ple.InsertDateTime, ple.IsProcessed, ple.LoadEndDateTime
            FROM [execution].[PipelineLandingzoneEntity] ple
            ORDER BY ple.InsertDateTime DESC
        """)
    except Exception:
        result['lzEntities'] = []

    result['serverTime'] = datetime.utcnow().isoformat() + 'Z'
    return result


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
        # Extract jobInstanceId from Location header
        # Location: https://api.fabric.microsoft.com/v1/workspaces/{ws}/items/{item}/jobs/instances/{id}
        job_instance_id = ''
        if location:
            parts = location.rstrip('/').split('/')
            if parts:
                job_instance_id = parts[-1]
        log.info(f'Pipeline triggered successfully: {pipeline_name} — jobInstanceId: {job_instance_id}')
        return {
            'success': True,
            'pipelineName': pipeline_name,
            'pipelineGuid': pipeline_guid,
            'workspaceGuid': code_ws_guid,
            'jobInstanceId': job_instance_id,
            'status': resp.status,
            'location': location,
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log.error(f'Pipeline trigger failed: {e.code} — {body}')
        raise ValueError(f'Fabric API error {e.code}: {body}')


# ── Pipeline Runner — scoped execution with entity-level control ──

import time as _time

# In-memory runner state (persisted to disk for crash safety)
_RUNNER_STATE_FILE = os.path.join(os.path.dirname(__file__), '.runner_state.json')
_runner_state: dict = {'active': False}


def _load_runner_state() -> dict:
    global _runner_state
    if os.path.exists(_RUNNER_STATE_FILE):
        try:
            with open(_RUNNER_STATE_FILE, 'r') as f:
                _runner_state = json.load(f)
        except Exception:
            _runner_state = {'active': False}
    return _runner_state


def _save_runner_state():
    try:
        with open(_RUNNER_STATE_FILE, 'w') as f:
            json.dump(_runner_state, f, indent=2)
    except Exception as e:
        log.warning(f'Failed to save runner state: {e}')


# Load state on import
_load_runner_state()


def runner_get_sources() -> list[dict]:
    """Get all data sources with entity counts per layer and connection health info."""
    datasources = query_sql(
        "SELECT ds.DataSourceId, ds.Name, ds.ConnectionId, ds.IsActive "
        "FROM integration.DataSource ds ORDER BY ds.DataSourceId"
    )
    connections = query_sql(
        "SELECT ConnectionId, Name FROM integration.Connection"
    )
    conn_map = {c['ConnectionId']: c['Name'] for c in connections}

    # Entity counts per layer per source
    lz_counts = query_sql(
        "SELECT DataSourceId, COUNT(*) as total, "
        "SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active "
        "FROM integration.LandingzoneEntity GROUP BY DataSourceId"
    )
    bronze_counts = query_sql(
        "SELECT lz.DataSourceId, COUNT(*) as total, "
        "SUM(CASE WHEN b.IsActive=1 THEN 1 ELSE 0 END) as active "
        "FROM integration.BronzeLayerEntity b "
        "JOIN integration.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId "
        "GROUP BY lz.DataSourceId"
    )
    silver_counts = query_sql(
        "SELECT lz.DataSourceId, COUNT(*) as total, "
        "SUM(CASE WHEN s.IsActive=1 THEN 1 ELSE 0 END) as active "
        "FROM integration.SilverLayerEntity s "
        "JOIN integration.BronzeLayerEntity b ON s.BronzeLayerEntityId = b.BronzeLayerEntityId "
        "JOIN integration.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId "
        "GROUP BY lz.DataSourceId"
    )

    lz_map = {r['DataSourceId']: r for r in lz_counts}
    br_map = {r['DataSourceId']: r for r in bronze_counts}
    sv_map = {r['DataSourceId']: r for r in silver_counts}

    # Filter to only sources that have LZ entities (i.e., real data sources)
    results = []
    for ds in datasources:
        dsid = ds['DataSourceId']
        lz = lz_map.get(dsid)
        if not lz:
            continue  # Skip non-data sources (lakehouse refs, notebook sources)
        results.append({
            'dataSourceId': dsid,
            'name': ds['Name'],
            'connectionName': conn_map.get(ds['ConnectionId'], 'Unknown'),
            'isActive': ds['IsActive'],
            'entities': {
                'landing': {'total': lz['total'], 'active': lz['active']},
                'bronze': {'total': br_map.get(dsid, {}).get('total', 0), 'active': br_map.get(dsid, {}).get('active', 0)},
                'silver': {'total': sv_map.get(dsid, {}).get('total', 0), 'active': sv_map.get(dsid, {}).get('active', 0)},
            },
        })
    return results


def runner_get_entities(data_source_id: int) -> list[dict]:
    """Get entities for a specific data source across all layers."""
    lz_entities = _execute_parameterized(
        "SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName, "
        "le.FileName, le.FilePath, le.FileType, le.IsActive, le.IsIncremental, le.IsIncrementalColumn, "
        "ds.Namespace "
        "FROM integration.LandingzoneEntity le "
        "JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId "
        "WHERE le.DataSourceId = ? "
        "ORDER BY le.SourceName",
        (data_source_id,)
    )

    # Get Bronze entities linked to these LZ entities
    lz_ids = [e['LandingzoneEntityId'] for e in lz_entities]
    bronze_map: dict = {}
    if lz_ids:
        placeholders = ','.join('?' * len(lz_ids))
        bronze_entities = _execute_parameterized(
            f"SELECT BronzeLayerEntityId, LandingzoneEntityId, [Schema] as BronzeSchema, "
            f"Name as BronzeName, PrimaryKeys, IsActive "
            f"FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId IN ({placeholders})",
            tuple(lz_ids)
        )
        for b in bronze_entities:
            bronze_map[b['LandingzoneEntityId']] = b

    # Get Silver entities linked to Bronze
    br_ids = [b['BronzeLayerEntityId'] for b in bronze_map.values()]
    silver_map: dict = {}
    if br_ids:
        placeholders = ','.join('?' * len(br_ids))
        silver_entities = _execute_parameterized(
            f"SELECT SilverLayerEntityId, BronzeLayerEntityId, [Schema] as SilverSchema, "
            f"Name as SilverName, IsActive "
            f"FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId IN ({placeholders})",
            tuple(br_ids)
        )
        for s in silver_entities:
            silver_map[s['BronzeLayerEntityId']] = s

    def _to_bool(val) -> bool:
        if isinstance(val, bool): return val
        return str(val).lower() == 'true'

    results = []
    for e in lz_entities:
        lz_id = e['LandingzoneEntityId']
        br = bronze_map.get(lz_id)
        sv = silver_map.get(br['BronzeLayerEntityId']) if br else None
        results.append({
            'lzEntityId': lz_id,
            'sourceSchema': e.get('SourceSchema', ''),
            'sourceName': e.get('SourceName', ''),
            'namespace': e.get('Namespace', ''),
            'isIncremental': _to_bool(e.get('IsIncremental', False)),
            'incrementalColumn': e.get('IsIncrementalColumn', '') or '',
            'lzActive': _to_bool(e.get('IsActive', False)),
            'bronzeEntityId': br['BronzeLayerEntityId'] if br else None,
            'bronzeActive': _to_bool(br['IsActive']) if br else None,
            'primaryKeys': br.get('PrimaryKeys', '') if br else None,
            'silverEntityId': sv['SilverLayerEntityId'] if sv else None,
            'silverActive': _to_bool(sv['IsActive']) if sv else None,
        })
    return results


def runner_prepare_scope(data_source_ids: list[int], entity_ids: list[int] | None,
                         layer: str) -> dict:
    """Prepare a scoped run: save original IsActive states, deactivate non-selected entities.

    Args:
        data_source_ids: Which data sources to include (all entities within)
        entity_ids: Optional specific LZ entity IDs (if None, all entities in selected sources)
        layer: 'landing', 'bronze', 'silver', or 'full'
    """
    global _runner_state

    if _runner_state.get('active'):
        raise ValueError('A scoped run is already active. Restore first before starting a new one.')

    # Determine which LZ entities should stay ACTIVE
    if entity_ids:
        # Specific entities selected
        keep_lz_ids = set(entity_ids)
    else:
        # All entities in selected sources
        placeholders = ','.join('?' * len(data_source_ids))
        rows = _execute_parameterized(
            f"SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
            f"WHERE DataSourceId IN ({placeholders}) AND IsActive = 1",
            tuple(data_source_ids)
        )
        keep_lz_ids = {r['LandingzoneEntityId'] for r in rows}

    # Save original states for ALL active entities (so we can restore later)
    all_lz = query_sql(
        "SELECT LandingzoneEntityId, IsActive FROM integration.LandingzoneEntity WHERE IsActive = 1"
    )
    all_bronze = query_sql(
        "SELECT BronzeLayerEntityId, IsActive FROM integration.BronzeLayerEntity WHERE IsActive = 1"
    )
    all_silver = query_sql(
        "SELECT SilverLayerEntityId, IsActive FROM integration.SilverLayerEntity WHERE IsActive = 1"
    )

    # Determine which entities to deactivate
    deactivate_lz = [e['LandingzoneEntityId'] for e in all_lz
                     if e['LandingzoneEntityId'] not in keep_lz_ids]

    # Find Bronze/Silver IDs to deactivate (those NOT linked to kept LZ entities)
    keep_bronze_ids = set()
    keep_silver_ids = set()
    if keep_lz_ids:
        placeholders = ','.join('?' * len(keep_lz_ids))
        bronze_rows = _execute_parameterized(
            f"SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity "
            f"WHERE LandingzoneEntityId IN ({placeholders})",
            tuple(keep_lz_ids)
        )
        keep_bronze_ids = {r['BronzeLayerEntityId'] for r in bronze_rows}

        if keep_bronze_ids:
            placeholders2 = ','.join('?' * len(keep_bronze_ids))
            silver_rows = _execute_parameterized(
                f"SELECT SilverLayerEntityId FROM integration.SilverLayerEntity "
                f"WHERE BronzeLayerEntityId IN ({placeholders2})",
                tuple(keep_bronze_ids)
            )
            keep_silver_ids = {r['SilverLayerEntityId'] for r in silver_rows}

    deactivate_bronze = [e['BronzeLayerEntityId'] for e in all_bronze
                         if e['BronzeLayerEntityId'] not in keep_bronze_ids]
    deactivate_silver = [e['SilverLayerEntityId'] for e in all_silver
                         if e['SilverLayerEntityId'] not in keep_silver_ids]

    # Apply scope based on layer
    affected = {'lz': 0, 'bronze': 0, 'silver': 0}
    conn = get_sql_connection()
    try:
        cursor = conn.cursor()

        if layer in ('landing', 'full') and deactivate_lz:
            for batch_start in range(0, len(deactivate_lz), 500):
                batch = deactivate_lz[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.LandingzoneEntity SET IsActive = 0 "
                    f"WHERE LandingzoneEntityId IN ({placeholders})", batch
                )
            affected['lz'] = len(deactivate_lz)

        if layer in ('bronze', 'full') and deactivate_bronze:
            for batch_start in range(0, len(deactivate_bronze), 500):
                batch = deactivate_bronze[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.BronzeLayerEntity SET IsActive = 0 "
                    f"WHERE BronzeLayerEntityId IN ({placeholders})", batch
                )
            affected['bronze'] = len(deactivate_bronze)

        if layer in ('silver', 'full') and deactivate_silver:
            for batch_start in range(0, len(deactivate_silver), 500):
                batch = deactivate_silver[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.SilverLayerEntity SET IsActive = 0 "
                    f"WHERE SilverLayerEntityId IN ({placeholders})", batch
                )
            affected['silver'] = len(deactivate_silver)

        conn.commit()
    finally:
        conn.close()

    # Save state for restore
    _runner_state = {
        'active': True,
        'startedAt': _time.time(),
        'layer': layer,
        'selectedSources': data_source_ids,
        'selectedEntityIds': entity_ids,
        'deactivated': {
            'lz': deactivate_lz,
            'bronze': deactivate_bronze,
            'silver': deactivate_silver,
        },
        'affected': affected,
        'kept': {
            'lz': len(keep_lz_ids),
            'bronze': len(keep_bronze_ids),
            'silver': len(keep_silver_ids),
        },
        'pipelineTriggered': None,
        'jobInstanceId': None,
    }
    _save_runner_state()
    log.info(f'Runner scope applied: kept {len(keep_lz_ids)} LZ, {len(keep_bronze_ids)} Bronze, {len(keep_silver_ids)} Silver; '
             f'deactivated {affected["lz"]} LZ, {affected["bronze"]} Bronze, {affected["silver"]} Silver')

    return {
        'success': True,
        'scope': {
            'kept': _runner_state['kept'],
            'deactivated': affected,
        },
    }


def runner_trigger(pipeline_name: str) -> dict:
    """Trigger a pipeline within an active runner scope."""
    global _runner_state
    if not _runner_state.get('active'):
        raise ValueError('No active runner scope. Call prepare first.')

    result = trigger_pipeline(pipeline_name)
    _runner_state['pipelineTriggered'] = pipeline_name
    _runner_state['jobInstanceId'] = result.get('jobInstanceId', '')
    _runner_state['triggeredAt'] = _time.time()
    _save_runner_state()
    return result


def runner_restore() -> dict:
    """Restore all entities to their original IsActive states."""
    global _runner_state

    if not _runner_state.get('active'):
        return {'success': True, 'message': 'No active scope to restore'}

    deactivated = _runner_state.get('deactivated', {})
    restored = {'lz': 0, 'bronze': 0, 'silver': 0}

    conn = get_sql_connection()
    try:
        cursor = conn.cursor()

        lz_ids = deactivated.get('lz', [])
        if lz_ids:
            for batch_start in range(0, len(lz_ids), 500):
                batch = lz_ids[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.LandingzoneEntity SET IsActive = 1 "
                    f"WHERE LandingzoneEntityId IN ({placeholders})", batch
                )
            restored['lz'] = len(lz_ids)

        bronze_ids = deactivated.get('bronze', [])
        if bronze_ids:
            for batch_start in range(0, len(bronze_ids), 500):
                batch = bronze_ids[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.BronzeLayerEntity SET IsActive = 1 "
                    f"WHERE BronzeLayerEntityId IN ({placeholders})", batch
                )
            restored['bronze'] = len(bronze_ids)

        silver_ids = deactivated.get('silver', [])
        if silver_ids:
            for batch_start in range(0, len(silver_ids), 500):
                batch = silver_ids[batch_start:batch_start+500]
                placeholders = ','.join('?' * len(batch))
                cursor.execute(
                    f"UPDATE integration.SilverLayerEntity SET IsActive = 1 "
                    f"WHERE SilverLayerEntityId IN ({placeholders})", batch
                )
            restored['silver'] = len(silver_ids)

        conn.commit()
    finally:
        conn.close()

    log.info(f'Runner scope restored: {restored["lz"]} LZ, {restored["bronze"]} Bronze, {restored["silver"]} Silver')

    _runner_state = {'active': False}
    _save_runner_state()

    return {'success': True, 'restored': restored}


def runner_get_state() -> dict:
    """Get current runner state."""
    _load_runner_state()
    return _runner_state


def get_pipeline_run_status(workspace_guid: str, pipeline_guid: str) -> list[dict]:
    """Get recent run status for a pipeline from Fabric API."""
    # This queries the execution log from the metadata DB
    return query_sql(
        f"SELECT TOP 5 * FROM execution.PipelineExecution "
        f"WHERE PipelineName = (SELECT Name FROM integration.Pipeline WHERE PipelineGuid = '{pipeline_guid}') "
        f"ORDER BY PipelineExecutionId DESC"
    )


# ── Fabric Jobs cache ──
_fabric_jobs_cache: dict = {'data': [], 'ts': 0.0, 'ttl': 15}  # 15-second cache


def get_fabric_job_instances(force_refresh: bool = False) -> list[dict]:
    """Query Fabric REST API for recent pipeline job instances across all workspaces.
    Returns actual running/completed jobs from Fabric, independent of logging tables.
    Uses ThreadPoolExecutor to parallelize API calls (5 workers) and a 15-second cache."""
    import time as _time

    # Return cached data if fresh (avoids hammering Fabric API on every poll)
    now = _time.time()
    if not force_refresh and _fabric_jobs_cache['data'] and (now - _fabric_jobs_cache['ts']) < _fabric_jobs_cache['ttl']:
        return _fabric_jobs_cache['data']

    t0 = _time.time()
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

    # Deduplicate: build list of unique pipelines to query
    seen_guids: set[str] = set()
    unique_pipes: list[dict] = []
    for pipe in pipelines:
        pg = pipe['PipelineGuid'].lower()
        if pg not in seen_guids:
            seen_guids.add(pg)
            ws_name = pipe.get('WorkspaceName', '')
            env = 'D' if '(D)' in ws_name else 'P' if '(P)' in ws_name else 'D'
            ws_guid = code_ws.get(env, pipe['WorkspaceGuid'].lower())
            unique_pipes.append({**pipe, '_ws_guid': ws_guid, '_pg': pg})

    def _fetch_one(pipe: dict) -> list[dict]:
        """Fetch job instances for a single pipeline."""
        pg = pipe['_pg']
        ws_guid = pipe['_ws_guid']
        url = (f'https://api.fabric.microsoft.com/v1/workspaces/{ws_guid}'
               f'/items/{pg}/jobs/instances?limit=3')
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        try:
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read().decode())
            results = []
            for job in data.get('value', []):
                job['pipelineName'] = pipe['Name']
                job['pipelineGuid'] = pg
                job['workspaceGuid'] = ws_guid
                job['workspaceName'] = pipe.get('WorkspaceName', '')
                results.append(job)
            return results
        except Exception:
            return []

    # Parallel fetch — 6 workers keeps us well under Fabric API rate limits
    all_jobs: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for result in pool.map(_fetch_one, unique_pipes):
            all_jobs.extend(result)

    # Sort: running/active jobs first, then by start time descending
    def sort_key(j):
        status = (j.get('status') or '').lower()
        is_active = 1 if status in ('inprogress', 'running', 'notstarted') else 0
        start = j.get('startTimeUtc') or ''
        return (is_active, start)

    all_jobs.sort(key=sort_key, reverse=True)
    result = all_jobs[:50]  # Cap at 50 most recent

    # Update cache
    _fabric_jobs_cache['data'] = result
    _fabric_jobs_cache['ts'] = _time.time()

    elapsed = _time.time() - t0
    log.info(f'Fabric jobs: fetched {len(all_jobs)} jobs from {len(unique_pipes)} pipelines in {elapsed:.1f}s')
    return result


def _safe_int(val) -> int | None:
    """Coerce a value to int, or return None if not parseable."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


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
            out = act.get('output', {}) or {}
            # Extract row counts from output — Copy activities report these
            rows_read = out.get('rowsRead') or out.get('rows_read') or out.get('recordsRead')
            rows_written = out.get('rowsCopied') or out.get('rowsWritten') or out.get('rows_written') or out.get('recordsWritten')
            data_read = out.get('dataRead') or out.get('data_read') or out.get('bytesRead')
            data_written = out.get('dataWritten') or out.get('data_written') or out.get('bytesWritten')
            # Some activities nest counts under billingDetails or copyDuration
            if not rows_read and 'billingDetails' in out:
                bd = out['billingDetails']
                rows_read = bd.get('rowsRead')
                rows_written = bd.get('rowsCopied') or bd.get('rowsWritten')
                data_read = bd.get('dataRead')
                data_written = bd.get('dataWritten')

            row_counts = None
            if rows_read is not None or rows_written is not None:
                row_counts = {
                    'rowsRead': _safe_int(rows_read),
                    'rowsWritten': _safe_int(rows_written),
                    'dataRead': _safe_int(data_read),
                    'dataWritten': _safe_int(data_written),
                }

            result.append({
                'activityName': act.get('activityName', ''),
                'activityType': act.get('activityType', ''),
                'status': act.get('status', 'Unknown'),
                'startTime': act.get('activityRunStart', ''),
                'endTime': act.get('activityRunEnd', ''),
                'durationMs': act.get('durationInMs', 0),
                'error': act.get('error', {}),
                'input': act.get('input', {}),
                'output': out,
                'activityRunId': act.get('activityRunId', ''),
                'rowCounts': row_counts,
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


def trace_pipeline_failure(workspace_guid: str, job_instance_id: str,
                           pipeline_name: str = '', max_depth: int = 5) -> dict:
    """Recursively trace a pipeline failure through nested ExecutePipeline activities.
    Returns a breadcrumb trail from the top-level pipeline down to the root cause activity,
    plus an interpreted error for the leaf failure.

    Response: {trail: [{pipelineName, activityName, activityType, status, error, depth}],
               rootCause: {same shape} | null}
    """
    trail: list[dict] = []

    def _trace(ws_guid: str, run_id: str, pipe_name: str, depth: int):
        if depth > max_depth:
            trail.append({
                'pipelineName': pipe_name, 'activityName': '(max depth reached)',
                'activityType': '', 'status': 'Unknown', 'error': '', 'depth': depth,
            })
            return

        activities = get_pipeline_activity_runs(ws_guid, run_id)
        if not activities:
            return

        # Find failed activities (there may be multiple if pipeline has parallel branches)
        failed = [a for a in activities if a['status'].lower() == 'failed']
        if not failed:
            return

        for activity in failed:
            err_obj = activity.get('error', {})
            err_msg = ''
            if isinstance(err_obj, dict):
                err_msg = err_obj.get('message', '')
            elif isinstance(err_obj, str):
                err_msg = err_obj

            breadcrumb = {
                'pipelineName': pipe_name,
                'activityName': activity['activityName'],
                'activityType': activity['activityType'],
                'status': activity['status'],
                'error': err_msg,
                'depth': depth,
            }

            act_type = activity['activityType'].lower()

            # ExecutePipeline / InvokePipeline — trace into child
            if act_type in ('executepipeline', 'invokepipeline'):
                output = activity.get('output', {})
                # Fabric puts child run ID in output.pipelineRunId (ADF compat)
                child_run_id = ''
                if isinstance(output, dict):
                    child_run_id = (output.get('pipelineRunId', '')
                                    or output.get('runId', '')
                                    or output.get('id', ''))
                child_name = ''
                if isinstance(output, dict):
                    child_name = output.get('pipelineName', '')
                if not child_name:
                    child_name = activity['activityName']

                trail.append(breadcrumb)

                if child_run_id:
                    _trace(ws_guid, child_run_id, child_name, depth + 1)
                else:
                    # Can't trace deeper — record what we know
                    trail.append({
                        'pipelineName': child_name,
                        'activityName': '(child run details unavailable)',
                        'activityType': '', 'status': 'Failed',
                        'error': err_msg, 'depth': depth + 1,
                    })

            elif act_type == 'foreach':
                # ForEach — the error is in the iterations. The activity error often
                # references the first failed iteration. Add the breadcrumb and note it.
                trail.append(breadcrumb)

            else:
                # Leaf activity (Copy, Notebook, Lookup, etc.) — this IS the root cause
                trail.append(breadcrumb)
                # Only trace the first failed leaf in this branch — avoid duplication
                return

    _trace(workspace_guid, job_instance_id, pipeline_name, 0)
    root_cause = trail[-1] if trail else None
    return {'trail': trail, 'rootCause': root_cause}


# ── Error Intelligence ──

def _classify_error(raw: str) -> str:
    """Classify a raw error message into a category bucket."""
    lower = raw.lower()
    if any(k in lower for k in ('gateway', 'on-premises data gateway', 'personal gateway')):
        return 'gateway'
    if any(k in lower for k in ('login failed', 'cannot open database', 'cannot connect', 'sqlfailedtoconnect', 'connection string')):
        return 'connection'
    if any(k in lower for k in ('certificate', 'ssl', 'tls', 'trust server')):
        return 'ssl'
    if any(k in lower for k in ('timeout', 'timed out', 'operation took too long')):
        return 'timeout'
    if any(k in lower for k in ('capacity', 'throttl', '429', 'too many requests', 'rate limit')):
        return 'throttling'
    if any(k in lower for k in ('unauthorized', 'forbidden', 'access denied', '403', '401', 'permission')):
        return 'auth'
    if 'column' in lower and any(k in lower for k in ('not found', 'invalid', 'does not exist')):
        return 'schema'
    if any(k in lower for k in ('delta', 'merge', 'concurrentappend', 'concurrent')):
        return 'delta_conflict'
    if any(k in lower for k in ('notebook', 'spark', 'livy', 'py4j')):
        return 'notebook'
    if any(k in lower for k in ('cancel', 'abort', 'user request')):
        return 'cancelled'
    return 'other'


import re as _re

def _extract_error_context(raw: str) -> dict:
    """Parse a raw error message into structured context for the UI.
    Returns {summary, entityName, errorType}."""
    summary = ''
    entity_name = ''
    error_type = ''
    lower = raw.lower()

    # Try to extract entity/table name from file paths
    # Pattern: /Files/LZ_RAW/namespace/TableName or similar
    path_match = _re.search(r'/Files/[^/]+/([^/]+/[^/\s\'"]+)', raw)
    if path_match:
        entity_name = path_match.group(1)  # e.g. "etqdb/WorkItem"

    # Try schema.table patterns
    if not entity_name:
        table_match = _re.search(r'(?:table|from|into)\s+["\[]?(\w+)["\]]?\.["\[]?(\w+)["\]]?', raw, _re.IGNORECASE)
        if table_match:
            entity_name = f'{table_match.group(1)}.{table_match.group(2)}'

    # Classify specific error type and build summary
    if 'file not found' in lower or 'path does not exist' in lower or 'not found' in lower and 'file' in lower:
        error_type = 'FILE_NOT_FOUND'
        summary = f'File not found{": " + entity_name if entity_name else ""}'
    elif 'gateway' in lower and ('offline' in lower or 'unreachable' in lower or 'not available' in lower):
        error_type = 'GATEWAY_OFFLINE'
        summary = 'Gateway machine is offline or unreachable'
    elif 'login failed' in lower:
        error_type = 'LOGIN_FAILED'
        user_match = _re.search(r"login failed for user '([^']+)'", raw, _re.IGNORECASE)
        summary = f'Login failed{" for " + user_match.group(1) if user_match else ""}'
    elif 'cannot open database' in lower or 'cannot connect' in lower:
        error_type = 'CONNECTION_REFUSED'
        summary = 'Cannot connect to database'
    elif 'timeout' in lower or 'timed out' in lower:
        error_type = 'TIMEOUT'
        summary = f'Query timed out{" on " + entity_name if entity_name else ""}'
    elif 'certificate' in lower or 'ssl' in lower or 'tls' in lower:
        error_type = 'SSL_ERROR'
        summary = 'SSL/TLS certificate validation failed'
    elif 'column' in lower and ('not found' in lower or 'does not exist' in lower or 'invalid' in lower):
        error_type = 'SCHEMA_MISMATCH'
        col_match = _re.search(r"column '([^']+)'", raw, _re.IGNORECASE)
        summary = f'Column mismatch{": " + col_match.group(1) if col_match else ""}'
    elif 'unauthorized' in lower or 'forbidden' in lower or 'access denied' in lower:
        error_type = 'AUTH_DENIED'
        summary = 'Access denied or unauthorized'
    elif 'cancel' in lower or 'abort' in lower:
        error_type = 'CANCELLED'
        summary = 'Run was cancelled'
    elif 'notebook' in lower and 'failed' in lower:
        error_type = 'NOTEBOOK_FAILED'
        summary = f'Notebook execution failed{" for " + entity_name if entity_name else ""}'
    elif 'throttl' in lower or '429' in lower or 'capacity' in lower:
        error_type = 'THROTTLED'
        summary = 'Capacity throttled — too many concurrent requests'
    elif 'delta' in lower and ('conflict' in lower or 'concurrent' in lower):
        error_type = 'DELTA_CONFLICT'
        summary = f'Delta write conflict{" on " + entity_name if entity_name else ""}'
    else:
        error_type = 'UNKNOWN'
        # Use first 120 chars of raw error as summary, strip newlines
        clean = raw.replace('\n', ' ').replace('\r', '').strip()
        summary = clean[:120] + ('...' if len(clean) > 120 else '')

    return {'summary': summary, 'entityName': entity_name, 'errorType': error_type}


_ERROR_CATEGORY_META = {
    'gateway':        {'title': 'Gateway Unreachable',          'severity': 'critical', 'suggestion': 'Verify the gateway machine is powered on, the gateway service is running, and VPN is connected.'},
    'connection':     {'title': 'Database Connection Failed',   'severity': 'critical', 'suggestion': 'SQL Server may be down, database name changed, or credentials expired. Check connection in Fabric > Manage connections.'},
    'ssl':            {'title': 'SSL/TLS Certificate Error',    'severity': 'warning',  'suggestion': 'Enable "TrustServerCertificate" in connection settings, or install the server certificate on the gateway machine.'},
    'timeout':        {'title': 'Operation Timed Out',          'severity': 'critical', 'suggestion': 'Source query exceeded timeout. Enable incremental loading (watermark-based) to reduce data volume per run.'},
    'throttling':     {'title': 'Capacity Limit / Throttling',  'severity': 'warning',  'suggestion': 'Workspace hit compute capacity limit. Wait for other jobs, reduce parallel copy degree, or request capacity upgrade.'},
    'auth':           {'title': 'Authentication / Permission',  'severity': 'warning',  'suggestion': 'Service principal or connection credentials lack required permissions. Verify connection auth type in Fabric.'},
    'schema':         {'title': 'Schema Mismatch',              'severity': 'warning',  'suggestion': 'Source table schema changed. Re-run source analysis from Source Manager to update entity configuration.'},
    'delta_conflict': {'title': 'Delta Table Write Conflict',   'severity': 'warning',  'suggestion': 'Two operations wrote to the same Delta table. Usually resolves on retry. Check for overlapping pipeline schedules.'},
    'notebook':       {'title': 'Notebook Execution Failed',    'severity': 'warning',  'suggestion': 'Check notebook logs in Fabric for full Spark stack trace. Common: missing lakehouse ref, import error, or type mismatch.'},
    'cancelled':      {'title': 'Run Cancelled',                'severity': 'info',     'suggestion': 'This run was manually cancelled or terminated by a parent pipeline.'},
    'other':          {'title': 'Pipeline Error',               'severity': 'warning',  'suggestion': 'Review the raw error details. Check Fabric portal for full activity-level diagnostics.'},
}


def get_error_intelligence() -> dict:
    """Aggregate real pipeline errors from Fabric job instances and SQL logging tables.
    Returns categorized error summaries, individual error records, and pattern counts."""
    import time as _time

    errors: list[dict] = []

    # Source 1: Fabric job instances (cached, fast)
    try:
        jobs = get_fabric_job_instances()
        for job in jobs:
            status = (job.get('status') or '').lower()
            if status != 'failed':
                continue
            raw = job.get('failureReason', '') or ''
            if isinstance(raw, dict):
                raw = raw.get('message', '') or json.dumps(raw)
            if not raw or raw == '{}':
                raw = 'Pipeline execution failed (no details available)'
            ctx = _extract_error_context(raw)
            errors.append({
                'id': job.get('id', ''),
                'source': 'fabric',
                'pipelineName': job.get('pipelineName', ''),
                'workspaceName': job.get('workspaceName', ''),
                'startTime': job.get('startTimeUtc', ''),
                'endTime': job.get('endTimeUtc', ''),
                'rawError': raw,
                'category': _classify_error(raw),
                'jobInstanceId': job.get('id', ''),
                'workspaceGuid': job.get('workspaceGuid', ''),
                'summary': ctx['summary'],
                'entityName': ctx['entityName'],
                'errorType': ctx['errorType'],
            })
    except Exception as e:
        log.warning(f'Error intelligence - Fabric jobs failed: {e}')

    # Source 2: SQL logging tables (PipelineExecution)
    try:
        execs = query_sql(
            "SELECT TOP 200 pe.PipelineExecutionId, pe.PipelineName, pe.Status, "
            "pe.StartDateTime, pe.EndDateTime, pe.ErrorMessage, pe.WorkspaceName "
            "FROM logging.PipelineExecution pe "
            "WHERE pe.Status = 'Failed' "
            "ORDER BY pe.PipelineExecutionId DESC"
        )
        for ex in execs:
            raw = ex.get('ErrorMessage', '') or ''
            if not raw:
                continue
            exec_id = str(ex.get('PipelineExecutionId', ''))
            # Avoid duplicates if Fabric API already returned this same failure
            if any(e['id'] == exec_id for e in errors):
                continue
            ctx = _extract_error_context(raw)
            errors.append({
                'id': f'sql-{exec_id}',
                'source': 'sql',
                'pipelineName': ex.get('PipelineName', ''),
                'workspaceName': ex.get('WorkspaceName', ''),
                'startTime': str(ex.get('StartDateTime', '')),
                'endTime': str(ex.get('EndDateTime', '')),
                'rawError': raw,
                'category': _classify_error(raw),
                'jobInstanceId': '',
                'workspaceGuid': '',
                'summary': ctx['summary'],
                'entityName': ctx['entityName'],
                'errorType': ctx['errorType'],
            })
    except Exception as e:
        log.warning(f'Error intelligence - SQL logging query failed: {e}')

    # Group by category for pattern analysis
    pattern_counts: dict[str, int] = {}
    for err in errors:
        cat = err['category']
        pattern_counts[cat] = pattern_counts.get(cat, 0) + 1

    # Build error summaries (grouped by category)
    summaries: list[dict] = []
    for cat, count in sorted(pattern_counts.items(), key=lambda x: -x[1]):
        meta = _ERROR_CATEGORY_META.get(cat, _ERROR_CATEGORY_META['other'])
        cat_errors = [e for e in errors if e['category'] == cat]
        # Most recent error in this category
        latest = cat_errors[0] if cat_errors else {}
        # Affected pipelines
        affected_pipelines = list(set(e['pipelineName'] for e in cat_errors if e['pipelineName']))
        summaries.append({
            'id': f'cat-{cat}',
            'category': cat,
            'title': meta['title'],
            'severity': meta['severity'],
            'suggestion': meta['suggestion'],
            'occurrenceCount': count,
            'affectedPipelines': affected_pipelines,
            'latestError': latest.get('rawError', ''),
            'latestTime': latest.get('startTime', ''),
            'latestPipeline': latest.get('pipelineName', ''),
        })

    # Severity counts
    severity_counts = {'critical': 0, 'warning': 0, 'info': 0}
    for s in summaries:
        sev = s['severity']
        if sev in severity_counts:
            severity_counts[sev] += s['occurrenceCount']

    # Compute top issue — most common errorType across all errors
    top_issue = None
    if errors:
        type_counts: dict[str, int] = {}
        for err in errors:
            et = err.get('errorType', 'UNKNOWN')
            type_counts[et] = type_counts.get(et, 0) + 1
        if type_counts:
            top_type = max(type_counts, key=type_counts.get)
            top_count = type_counts[top_type]
            # Find the category for this error type to get suggestion
            sample_err = next((e for e in errors if e.get('errorType') == top_type), {})
            cat = sample_err.get('category', 'other')
            meta = _ERROR_CATEGORY_META.get(cat, _ERROR_CATEGORY_META['other'])
            # Build human-readable description
            type_labels = {
                'FILE_NOT_FOUND': 'File Not Found — Landing Zone data missing',
                'GATEWAY_OFFLINE': 'Gateway Offline — on-prem gateway unreachable',
                'LOGIN_FAILED': 'Login Failed — database credentials rejected',
                'CONNECTION_REFUSED': 'Connection Refused — database unreachable',
                'TIMEOUT': 'Timeout — query took too long',
                'SSL_ERROR': 'SSL Error — certificate validation failed',
                'SCHEMA_MISMATCH': 'Schema Mismatch — column structure changed',
                'AUTH_DENIED': 'Access Denied — permission missing',
                'CANCELLED': 'Cancelled — run manually stopped',
                'NOTEBOOK_FAILED': 'Notebook Failed — Spark execution error',
                'THROTTLED': 'Throttled — capacity limit hit',
                'DELTA_CONFLICT': 'Delta Conflict — concurrent write collision',
                'UNKNOWN': 'Unknown Error',
            }
            top_issue = {
                'errorType': top_type,
                'label': type_labels.get(top_type, top_type),
                'count': top_count,
                'totalErrors': len(errors),
                'suggestion': meta['suggestion'],
            }

    return {
        'summaries': summaries,
        'errors': errors[:100],  # Individual errors (cap at 100)
        'patternCounts': pattern_counts,
        'severityCounts': severity_counts,
        'totalErrors': len(errors),
        'topIssue': top_issue,
    }


# ── Pipeline Run Live Monitor (SSE) ──

_run_pollers = {}          # {run_key: RunPoller} — one poller per active run
_run_pollers_lock = threading.Lock()


class RunPoller:
    """Polls Fabric API for a single pipeline run and streams updates via SSE.
    One instance per active run. Multiple SSE clients share the same poll loop."""

    def __init__(self, workspace_guid: str, pipeline_guid: str, job_instance_id: str, pipeline_name: str = ''):
        self.workspace_guid = workspace_guid
        self.pipeline_guid = pipeline_guid
        self.job_instance_id = job_instance_id
        self.pipeline_name = pipeline_name
        self.events = []       # list of SSE event dicts
        self.cond = threading.Condition()
        self.terminal = False  # True when run reaches terminal state
        self._thread = None
        self._poll_interval = 5  # seconds
        self._idle_count = 0     # consecutive polls with no delta

    @property
    def run_key(self):
        return self.job_instance_id

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        log.info(f'RunPoller started for {self.pipeline_name} ({self.job_instance_id[:8]}...)')

    def _push_event(self, event_type: str, data: dict):
        evt = {'event': event_type, 'data': data, 'id': len(self.events)}
        with self.cond:
            self.events.append(evt)
            self.cond.notify_all()

    def _poll_loop(self):
        last_snapshot = None
        try:
            while not self.terminal:
                snapshot = self._build_snapshot()
                if snapshot:
                    # Detect deltas
                    if last_snapshot is None or snapshot != last_snapshot:
                        self._push_event('snapshot', snapshot)
                        self._idle_count = 0
                        self._poll_interval = 5
                    else:
                        self._idle_count += 1
                        # Adaptive backoff: no changes → slow down polling
                        if self._idle_count > 6:
                            self._poll_interval = min(15, self._poll_interval + 2)
                    last_snapshot = snapshot

                    # Check terminal state
                    status = snapshot.get('status', '').lower()
                    if status in ('completed', 'failed', 'cancelled'):
                        self._push_event('final', snapshot)
                        self.terminal = True
                        log.info(f'RunPoller done: {self.pipeline_name} → {status}')
                        break

                time_mod_sleep(self._poll_interval)
        except Exception as e:
            log.error(f'RunPoller error for {self.job_instance_id[:8]}: {e}')
            self._push_event('error', {'message': str(e)})
            self.terminal = True

    def _build_snapshot(self) -> dict | None:
        """Build a RunSnapshot from Fabric API."""
        try:
            # 1. Get job instance status
            token = get_fabric_token('https://api.fabric.microsoft.com/.default')
            url = (f'https://api.fabric.microsoft.com/v1/workspaces/{self.workspace_guid}'
                   f'/items/{self.pipeline_guid}/jobs/instances?limit=5')
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read().decode())
            jobs = data.get('value', [])

            # Find our specific job instance
            job = None
            for j in jobs:
                if j.get('id', '').lower() == self.job_instance_id.lower():
                    job = j
                    break
            if not job:
                return None

            status_raw = job.get('status', 'Unknown')
            # Normalize: Fabric returns 'InProgress', 'Completed', 'Failed', 'Cancelled', 'NotStarted'
            status_map = {
                'inprogress': 'Running', 'completed': 'Completed',
                'failed': 'Failed', 'cancelled': 'Cancelled',
                'notstarted': 'Queued', 'deduped': 'Cancelled',
            }
            status = status_map.get(status_raw.lower(), status_raw)

            # 2. Get activity runs
            activities = get_pipeline_activity_runs(self.workspace_guid, self.job_instance_id)

            # 3. Compute percent complete
            total = len(activities) if activities else 0
            done = sum(1 for a in activities if a.get('status', '').lower() in ('succeeded', 'failed', 'cancelled'))
            pct = round((done / total) * 100) if total > 0 else (100 if status == 'Completed' else 0)

            # 4. Build failure summary if applicable
            failure_summary = None
            if status == 'Failed':
                failed_acts = [a for a in activities if a.get('status', '').lower() == 'failed']
                if failed_acts:
                    fa = failed_acts[0]
                    err = fa.get('error', {})
                    failure_summary = {
                        'activityName': fa.get('activityName', ''),
                        'activityType': fa.get('activityType', ''),
                        'errorCode': err.get('errorCode', ''),
                        'errorMessage': err.get('message', str(err) if err else job.get('failureReason', '')),
                        'suggestion': 'Check Fabric Monitor for full activity diagnostics.',
                    }
                elif job.get('failureReason'):
                    failure_summary = {
                        'activityName': '',
                        'activityType': '',
                        'errorCode': '',
                        'errorMessage': job['failureReason'],
                        'suggestion': 'Check Fabric Monitor for details.',
                    }

            return {
                'runId': self.job_instance_id,
                'pipelineName': self.pipeline_name,
                'pipelineGuid': self.pipeline_guid,
                'workspaceGuid': self.workspace_guid,
                'status': status,
                'startedAt': job.get('startTimeUtc', ''),
                'endedAt': job.get('endTimeUtc', ''),
                'percentComplete': pct,
                'totalActivities': total,
                'completedActivities': done,
                'activities': activities,
                'failureSummary': failure_summary,
            }
        except Exception as e:
            log.warning(f'RunPoller snapshot failed: {e}')
            return None


def time_mod_sleep(seconds):
    """Sleep wrapper to avoid shadowing time_mod import."""
    import time as _time
    _time.sleep(seconds)


def get_or_create_run_poller(workspace_guid: str, pipeline_guid: str,
                              job_instance_id: str, pipeline_name: str = '') -> RunPoller:
    """Get existing poller or create one. Deduplicates per run."""
    key = job_instance_id.lower()
    with _run_pollers_lock:
        if key in _run_pollers and not _run_pollers[key].terminal:
            return _run_pollers[key]
        poller = RunPoller(workspace_guid, pipeline_guid, job_instance_id, pipeline_name)
        _run_pollers[key] = poller
        poller.start()
        # Clean up old terminal pollers (keep last 20)
        terminal = [(k, v) for k, v in _run_pollers.items() if v.terminal]
        if len(terminal) > 20:
            for k, _ in terminal[:-20]:
                del _run_pollers[k]
        return poller


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
        # Bronze + Silver: join back to LZ → DataSource to get Namespace for per-source counting
        'bronze_entities': (
            'SELECT be.BronzeLayerEntityId, be.[Schema], be.Name, be.IsActive, ds.Namespace '
            'FROM integration.BronzeLayerEntity be '
            'JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId '
            'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
            'ORDER BY be.Name'
        ),
        'silver_entities': (
            'SELECT se.SilverLayerEntityId, se.[Schema], se.Name, se.IsActive, ds.Namespace '
            'FROM integration.SilverLayerEntity se '
            'JOIN integration.BronzeLayerEntity be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId '
            'JOIN integration.LandingzoneEntity le ON be.LandingzoneEntityId = le.LandingzoneEntityId '
            'JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId '
            'ORDER BY se.Name'
        ),
        'lakehouses': 'SELECT LakehouseId, Name FROM integration.Lakehouse ORDER BY Name',
        'workspaces': 'SELECT WorkspaceId, Name FROM integration.Workspace ORDER BY Name',
        'pipelines': 'SELECT PipelineId, Name, IsActive FROM integration.Pipeline ORDER BY Name',
        # Pipeline runs: group by RunGuid to get distinct runs with start/end/status
        'pipeline_runs': (
            'SELECT PipelineRunGuid, PipelineName, EntityLayer, TriggerType, '
            'MIN(CASE WHEN LogType LIKE \'Start%\' THEN LogDateTime END) AS StartTime, '
            'MAX(CASE WHEN LogType LIKE \'End%\' THEN LogDateTime END) AS EndTime, '
            'MAX(CASE WHEN LogType LIKE \'End%\' THEN LogData END) AS EndLogData, '
            'MAX(CASE WHEN LogType LIKE \'Error%\' OR LogType = \'PipelineError\' THEN LogData END) AS ErrorData, '
            'COUNT(*) AS LogCount '
            'FROM logging.PipelineExecution '
            'GROUP BY PipelineRunGuid, PipelineName, EntityLayer, TriggerType '
            'ORDER BY MIN(LogDateTime) DESC'
        ),
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
    pipeline_runs_raw = results['pipeline_runs']

    log.info(f'Control plane: 9 queries in {time.time() - t_start:.1f}s (parallel)')

    # -- Derive pipeline run statuses from log events --
    pipeline_runs = []
    for run in pipeline_runs_raw:
        start_time = run.get('StartTime')
        end_time = run.get('EndTime')
        error_data = run.get('ErrorData') or ''
        end_data = run.get('EndLogData') or ''
        # Derive status from log events
        if error_data:
            status = 'Failed'
        elif end_time and ('Error' in end_data or 'Fail' in end_data):
            status = 'Failed'
        elif end_time:
            status = 'Succeeded'
        elif start_time:
            status = 'InProgress'
        else:
            status = 'Unknown'
        # Calculate duration
        duration = None
        if start_time and end_time:
            try:
                from datetime import datetime as dt2
                t0 = dt2.fromisoformat(str(start_time).replace('Z', ''))
                t1 = dt2.fromisoformat(str(end_time).replace('Z', ''))
                dur_sec = (t1 - t0).total_seconds()
                if dur_sec < 60:
                    duration = f'{int(dur_sec)}s'
                elif dur_sec < 3600:
                    duration = f'{int(dur_sec // 60)}m {int(dur_sec % 60)}s'
                else:
                    duration = f'{int(dur_sec // 3600)}h {int((dur_sec % 3600) // 60)}m'
                duration_sec = dur_sec
            except Exception:
                duration_sec = None
        else:
            duration_sec = None
        pipeline_runs.append({
            'RunGuid': run.get('PipelineRunGuid', ''),
            'PipelineName': run.get('PipelineName', ''),
            'EntityLayer': run.get('EntityLayer', ''),
            'TriggerType': run.get('TriggerType', ''),
            'StartTime': str(start_time) if start_time else None,
            'EndTime': str(end_time) if end_time else None,
            'Status': status,
            'Duration': duration,
            'DurationSec': duration_sec,
        })

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

    # Count entities per namespace — LZ, Bronze, and Silver
    def _is_active(val):
        return str(val).lower() in ('true', '1')

    for ent in lz_entities:
        ns = ent.get('Namespace', 'Unknown')
        if ns in source_systems:
            source_systems[ns]['entities']['landing'] += 1
            if _is_active(ent.get('IsActive', '')):
                source_systems[ns]['activeEntities']['landing'] += 1
    for ent in bronze_entities:
        ns = ent.get('Namespace', 'Unknown')
        if ns in source_systems:
            source_systems[ns]['entities']['bronze'] += 1
            if _is_active(ent.get('IsActive', '')):
                source_systems[ns]['activeEntities']['bronze'] += 1
    for ent in silver_entities:
        ns = ent.get('Namespace', 'Unknown')
        if ns in source_systems:
            source_systems[ns]['entities']['silver'] += 1
            if _is_active(ent.get('IsActive', '')):
                source_systems[ns]['activeEntities']['silver'] += 1

    # Summary counts
    active_conn = sum(1 for c in connections if _is_active(c.get('IsActive', '')))
    active_ds = sum(1 for d in datasources if _is_active(d.get('IsActive', '')))
    active_lz = sum(1 for e in lz_entities if _is_active(e.get('IsActive', '')))
    active_br = sum(1 for e in bronze_entities if _is_active(e.get('IsActive', '')))
    active_sv = sum(1 for e in silver_entities if _is_active(e.get('IsActive', '')))
    active_pl = sum(1 for p in pipelines if _is_active(p.get('IsActive', '')))

    # Pipeline health from derived run statuses
    succeeded_runs = sum(1 for r in pipeline_runs if r['Status'] == 'Succeeded')
    failed_runs = sum(1 for r in pipeline_runs if r['Status'] == 'Failed')
    running_now = sum(1 for r in pipeline_runs if r['Status'] == 'InProgress')
    total_distinct_runs = len(pipeline_runs)

    # Overall health
    if failed_runs > 0 and succeeded_runs == 0:
        health = 'critical'
    elif failed_runs > 0:
        health = 'warning'
    elif total_distinct_runs == 0 and active_conn > 0:
        health = 'healthy'  # Connected but no runs yet
    elif active_conn == 0:
        health = 'setup'
    else:
        health = 'healthy'

    # Deduplicate lakehouses by name, tag with environment (DEV=1-3, PROD=4-6)
    lh_deduped = []
    lh_seen = set()
    for lh in lakehouses:
        lh_id = int(lh.get('LakehouseId', 0))
        env = 'DEV' if lh_id <= 3 else 'PROD'
        name = lh['Name']
        entry_key = f"{name}_{env}"
        if entry_key not in lh_seen:
            lh_seen.add(entry_key)
            lh_deduped.append({
                'LakehouseId': str(lh_id),
                'Name': name,
                'Environment': env,
            })

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
            'lakehouses': len(set(lh['Name'] for lh in lakehouses)),
            'workspaces': len(workspaces),
        },
        'pipelineHealth': {
            'recentRuns': total_distinct_runs,
            'succeeded': succeeded_runs,
            'failed': failed_runs,
            'running': running_now,
        },
        'sourceSystems': list(source_systems.values()),
        'lakehouses': lh_deduped,
        'workspaces': workspaces,
        'recentRuns': pipeline_runs[:15],
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


# ── Entity Digest Engine ──

_digest_cache: dict = {}  # {key: {'data': ..., 'expires': float}}
_DIGEST_TTL = 120  # 2 minutes server-side cache


def build_entity_digest(source_filter: str = None, layer_filter: str = None,
                        status_filter: str = None) -> dict:
    """Build the entity digest by calling execution.sp_BuildEntityDigest.

    Returns a single JSON structure with all entities grouped by source,
    including per-layer status, connection info, and summary counts.
    The stored proc does all the heavy lifting (joins 6+ tables, computes
    status, finds recent errors).  Python just reshapes and caches.
    """
    # ── Cache check ──
    cache_key = f'{source_filter}|{layer_filter}|{status_filter}'
    cached = _digest_cache.get(cache_key)
    if cached and time.time() < cached['expires']:
        return cached['data']

    t0 = time.time()

    # ── Call stored procedure ──
    if source_filter:
        safe_src = source_filter.replace("'", "''")
        rows = query_sql(f"EXEC execution.sp_BuildEntityDigest @SourceFilter = '{safe_src}'")
    else:
        rows = query_sql("EXEC execution.sp_BuildEntityDigest")

    # ── Build entity list and group by source ──
    sources: dict = {}

    for row in rows:
        src_key = row.get('source') or 'UNKNOWN'

        # Parse booleans (query_sql returns everything as str)
        is_active = row.get('IsActive') in (True, 1, '1', 'True', 'true')
        is_incremental = row.get('IsIncremental') in (True, 1, '1', 'True', 'true')

        # Parse nullable int IDs
        bronze_id = int(row['bronzeId']) if row.get('bronzeId') else None
        silver_id = int(row['silverId']) if row.get('silverId') else None

        # Status values
        lz_status = row.get('lzStatus') or 'not_started'
        bronze_status = row.get('bronzeStatus') or 'not_started'
        silver_status = row.get('silverStatus') or 'not_started'
        overall = row.get('overall') or 'not_started'

        # Layer filter (post-query) — skip entities that don't match
        if layer_filter:
            if layer_filter == 'landing' and lz_status == 'not_started':
                continue
            elif layer_filter == 'bronze' and bronze_status == 'not_started':
                continue
            elif layer_filter == 'silver' and silver_status == 'not_started':
                continue

        # Status filter (post-query) — skip entities that don't match overall status
        if status_filter and overall != status_filter:
            continue

        # Build error object
        last_error = None
        if row.get('lastErrorMessage'):
            last_error = {
                'message': row['lastErrorMessage'],
                'layer': row.get('lastErrorLayer') or '',
                'time': row.get('lastErrorTime') or '',
            }

        # Compute diagnosis from layer statuses
        if overall == 'complete':
            diagnosis = 'All layers loaded'
        elif overall == 'error':
            err_layer = row.get('lastErrorLayer') or 'unknown'
            diagnosis = f'Error in {err_layer} layer'
        elif overall == 'pending':
            pending_layers = []
            if bronze_status == 'pending':
                pending_layers.append('bronze')
            if silver_status == 'pending':
                pending_layers.append('silver')
            diagnosis = f'Pending: {", ".join(pending_layers)}' if pending_layers else 'Pending processing'
        elif overall == 'partial':
            loaded = []
            if lz_status == 'loaded':
                loaded.append('LZ')
            if bronze_status == 'loaded':
                loaded.append('Bronze')
            if silver_status == 'loaded':
                loaded.append('Silver')
            diagnosis = f'Partial: {", ".join(loaded)} loaded'
        else:
            diagnosis = 'Not started'

        entity = {
            'id': int(row['id']) if row.get('id') else 0,
            'tableName': row.get('tableName') or '',
            'sourceSchema': row.get('sourceSchema') or '',
            'source': src_key,
            'isActive': is_active,
            'isIncremental': is_incremental,
            'watermarkColumn': row.get('watermarkColumn') or '',
            'bronzeId': bronze_id,
            'bronzePKs': row.get('bronzePKs') or '',
            'silverId': silver_id,
            'lzStatus': lz_status,
            'lzLastLoad': row.get('lastLzLoad') or '',
            'bronzeStatus': bronze_status,
            'bronzeLastLoad': row.get('lastBrzLoad') or '',
            'silverStatus': silver_status,
            'silverLastLoad': row.get('lastSlvLoad') or '',
            'lastError': last_error,
            'diagnosis': diagnosis,
            'overall': overall,
            'connection': {
                'server': row.get('serverName') or '',
                'database': row.get('databaseName') or row.get('dbName') or '',
                'connectionName': row.get('connectionName') or '',
            },
        }

        # Group by source
        if src_key not in sources:
            sources[src_key] = {
                'key': src_key,
                'name': row.get('dbName') or src_key,
                'connection': {
                    'server': row.get('serverName') or '',
                    'database': row.get('databaseName') or row.get('dbName') or '',
                    'connectionName': row.get('connectionName') or '',
                },
                'entities': [],
                'summary': {'total': 0, 'complete': 0, 'pending': 0, 'error': 0, 'partial': 0, 'not_started': 0},
            }

        sources[src_key]['entities'].append(entity)
        sources[src_key]['summary']['total'] += 1
        if overall in sources[src_key]['summary']:
            sources[src_key]['summary'][overall] += 1

    elapsed_ms = round((time.time() - t0) * 1000)

    result = {
        'generatedAt': datetime.utcnow().isoformat() + 'Z',
        'buildTimeMs': elapsed_ms,
        'totalEntities': sum(s['summary']['total'] for s in sources.values()),
        'sources': sources,
    }

    # ── Cache the result ──
    _digest_cache[cache_key] = {'data': result, 'expires': time.time() + _DIGEST_TTL}

    return result


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

    # Auto-register Bronze + Silver entities for this LZ entity
    bronze_msg = ''
    silver_msg = ''
    try:
        ds_id = int(ds_check[0]['DataSourceId'])
        lz_row = _execute_parameterized(
            "SELECT LandingzoneEntityId FROM integration.LandingzoneEntity "
            "WHERE SourceSchema = ? AND SourceName = ? AND DataSourceId = ?",
            (schema, table, ds_id))
        if lz_row:
            lz_eid = int(lz_row[0]['LandingzoneEntityId'])
            bronze_lh = query_sql("SELECT TOP 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_BRONZE_LAYER'")
            silver_lh = query_sql("SELECT TOP 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_SILVER_LAYER'")
            if bronze_lh:
                # Check if Bronze already exists
                existing_b = _execute_parameterized(
                    "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                    (lz_eid,))
                if not existing_b:
                    query_sql(
                        f"EXEC [integration].[sp_UpsertBronzeLayerEntity] "
                        f"@BronzeLayerEntityId = 0, @LandingzoneEntityId = {lz_eid}, "
                        f"@LakehouseId = {int(bronze_lh[0]['LakehouseId'])}, "
                        f"@Schema = '{s_schema}', @Name = '{s_file}', "
                        f"@PrimaryKeys = 'N/A', @FileType = 'Delta', @IsActive = 1"
                    )
                    bronze_msg = ' + Bronze'
                    log.info(f'Bronze entity auto-registered for {schema}.{table}')

                # Get Bronze ID (just created or existing)
                b_row = _execute_parameterized(
                    "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                    (lz_eid,))
                if b_row and silver_lh:
                    b_eid = int(b_row[0]['BronzeLayerEntityId'])
                    existing_s = _execute_parameterized(
                        "SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?",
                        (b_eid,))
                    if not existing_s:
                        query_sql(
                            f"EXEC [integration].[sp_UpsertSilverLayerEntity] "
                            f"@SilverLayerEntityId = 0, @BronzeLayerEntityId = {b_eid}, "
                            f"@LakehouseId = {int(silver_lh[0]['LakehouseId'])}, "
                            f"@Schema = '{s_schema}', @Name = '{s_file}', "
                            f"@FileType = 'delta', @IsActive = 1"
                        )
                        silver_msg = ' + Silver'
                        log.info(f'Silver entity auto-registered for {schema}.{table}')
    except Exception as ex:
        log.warning(f'Auto Bronze/Silver registration failed for {schema}.{table}: {ex}')

    return {'success': True, 'message': f'Entity {schema}.{table} registered (LZ{bronze_msg}{silver_msg})'}


# ── Load Optimization Engine ──

def _connect_source_sql(server: str, database: str, username: str = '', password: str = ''):
    """Open a pyodbc connection to a source SQL Server (on-prem via gateway or direct)."""
    import pyodbc
    if username and password:
        conn_str = (
            f'DRIVER={{{SQL_DRIVER}}};SERVER={server};DATABASE={database};'
            f'UID={username};PWD={password};TrustServerCertificate=yes;'
        )
    else:
        conn_str = (
            f'DRIVER={{{SQL_DRIVER}}};SERVER={server};DATABASE={database};'
            f'Trusted_Connection=yes;TrustServerCertificate=yes;'
        )
    return pyodbc.connect(conn_str, timeout=15)


def analyze_source_tables(datasource_id: int, username: str = '', password: str = '') -> dict:
    """Analyze source SQL tables for PKs, watermark columns, and row counts.

    Connects to the source SQL Server, then for each LandingzoneEntity belonging to
    the given DataSource, discovers:
      - Primary key columns (from sys.indexes)
      - Watermark column candidates (datetime/identity/rowversion)
      - Row counts (from sys.dm_db_partition_stats)

    Returns a dict with entity analysis results and summary statistics.
    """
    # 1. Get DataSource + Connection info from metadata DB
    ds_info = query_sql(
        f"SELECT ds.DataSourceId, ds.Name AS DsName, ds.Namespace, "
        f"c.ConnectionGuid, c.Name AS ConnName "
        f"FROM integration.DataSource ds "
        f"JOIN integration.Connection c ON ds.ConnectionId = c.ConnectionId "
        f"WHERE ds.DataSourceId = {int(datasource_id)}"
    )
    if not ds_info:
        raise ValueError(f'DataSource {datasource_id} not found')
    ds = ds_info[0]

    # 2. Get gateway connection details (server/database) from Fabric API
    gw_conns = get_gateway_connections()
    gw_match = [g for g in gw_conns if g['id'].lower() == ds['ConnectionGuid'].lower()]
    if not gw_match:
        raise ValueError(f"Gateway connection {ds['ConnectionGuid'][:12]}... not found in Fabric. "
                         f"Available: {[g['displayName'] for g in gw_conns]}")
    server = gw_match[0]['server']
    database = gw_match[0]['database']

    # 3. Get all LZ entities for this DataSource
    entities = query_sql(
        f"SELECT LandingzoneEntityId, SourceSchema, SourceName, FileName, "
        f"IsIncremental, IsIncrementalColumn "
        f"FROM integration.LandingzoneEntity "
        f"WHERE DataSourceId = {int(datasource_id)} AND IsActive = 1 "
        f"ORDER BY SourceSchema, SourceName"
    )
    if not entities:
        return {'datasource': ds['DsName'], 'server': server, 'database': database,
                'entities': [], 'summary': {'total': 0}}

    log.info(f'Analyzing {len(entities)} tables in {server}/{database}...')

    # 4. Connect to source SQL Server
    try:
        src_conn = _connect_source_sql(server, database, username, password)
    except Exception as e:
        raise RuntimeError(f'Cannot connect to {server}/{database}: {str(e)[:200]}')

    src_cursor = src_conn.cursor()

    # 5. Batch-discover PKs for all tables
    pk_map = {}  # {(schema, table): [col1, col2, ...]}
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
        log.warning(f'PK discovery failed: {e}')

    # 6. Batch-discover watermark candidates for all tables
    watermark_map = {}  # {(schema, table): [{col, type, priority}, ...]}
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
            # Assign priority: rowversion=1, modified-datetime=2, created-datetime=3, identity=4, other-datetime=5
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
                'column': row.ColumnName,
                'dataType': row.DataType,
                'isIdentity': bool(row.IsIdentity),
                'priority': priority,
            })
    except Exception as e:
        log.warning(f'Watermark discovery failed: {e}')

    # 7. Batch-discover row counts
    rowcount_map = {}  # {(schema, table): int}
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
        log.warning(f'Row count discovery failed: {e}')

    src_conn.close()

    # 8. Check which entities already have Bronze/Silver registrations
    bronze_map = {}  # {lz_entity_id: bronze_entity_id}
    silver_map = {}
    try:
        bronze_rows = query_sql(
            "SELECT BronzeLayerEntityId, LandingzoneEntityId FROM integration.BronzeLayerEntity")
        for r in bronze_rows:
            bronze_map[int(r['LandingzoneEntityId'])] = int(r['BronzeLayerEntityId'])
        silver_rows = query_sql(
            "SELECT SilverLayerEntityId, BronzeLayerEntityId FROM integration.SilverLayerEntity")
        for r in silver_rows:
            silver_map[int(r['BronzeLayerEntityId'])] = int(r['SilverLayerEntityId'])
    except Exception:
        pass

    # 9. Build per-entity analysis results
    results = []
    incremental_count = 0
    full_count = 0
    has_pk_count = 0

    for e in entities:
        eid = int(e['LandingzoneEntityId'])
        schema = e['SourceSchema']
        table = e['SourceName']
        key = (schema, table)

        pks = pk_map.get(key, [])
        watermarks = sorted(watermark_map.get(key, []), key=lambda w: w['priority'])
        row_count = rowcount_map.get(key, 0)
        best_watermark = watermarks[0] if watermarks else None

        # Recommend load type
        # Priority 1-3: rowversion, Modified datetime, Created datetime
        # Priority 4: identity columns (captures INSERTs; best for append-heavy ERP/MES tables)
        if best_watermark and best_watermark['priority'] <= 4:
            recommended_load = 'INCREMENTAL'
            recommended_column = best_watermark['column']
            incremental_count += 1
        else:
            recommended_load = 'FULL'
            recommended_column = None
            full_count += 1

        if pks:
            has_pk_count += 1

        bronze_id = bronze_map.get(eid)
        silver_id = silver_map.get(bronze_id) if bronze_id else None

        results.append({
            'entityId': eid,
            'schema': schema,
            'table': table,
            'fileName': e['FileName'],
            'currentIsIncremental': e['IsIncremental'] == 'True',
            'currentIncrementalColumn': e['IsIncrementalColumn'] or None,
            'primaryKeys': pks,
            'watermarkCandidates': watermarks,
            'bestWatermark': best_watermark,
            'recommendedLoad': recommended_load,
            'recommendedColumn': recommended_column,
            'rowCount': row_count,
            'bronzeEntityId': bronze_id,
            'silverEntityId': silver_id,
            'bronzeRegistered': bronze_id is not None,
            'silverRegistered': silver_id is not None,
        })

    return {
        'datasource': ds['DsName'],
        'datasourceId': int(datasource_id),
        'server': server,
        'database': database,
        'entities': results,
        'summary': {
            'total': len(results),
            'incrementalRecommended': incremental_count,
            'fullLoadOnly': full_count,
            'hasPrimaryKeys': has_pk_count,
            'noPrimaryKeys': len(results) - has_pk_count,
            'bronzeRegistered': sum(1 for r in results if r['bronzeRegistered']),
            'silverRegistered': sum(1 for r in results if r['silverRegistered']),
        }
    }


def register_bronze_silver(datasource_id: int, entities: list[dict] = None,
                           username: str = '', password: str = '') -> dict:
    """Bulk-register Bronze and Silver entities for a DataSource.

    If `entities` is None, runs analyze_source_tables first to auto-discover PKs.
    Each entity in the list can override: primaryKeys, loadType, watermarkColumn.

    Creates BronzeLayerEntity (LH_BRONZE_LAYER) and SilverLayerEntity (LH_SILVER_LAYER)
    for every LZ entity that doesn't already have them.
    """
    # Run analysis if no entity overrides provided
    if entities is None:
        analysis = analyze_source_tables(datasource_id, username, password)
        entities = analysis['entities']

    # Get Lakehouse IDs for Bronze and Silver
    bronze_lh = query_sql("SELECT TOP 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_BRONZE_LAYER' ORDER BY LakehouseId")
    silver_lh = query_sql("SELECT TOP 1 LakehouseId FROM integration.Lakehouse WHERE Name = 'LH_SILVER_LAYER' ORDER BY LakehouseId")
    if not bronze_lh or not silver_lh:
        raise ValueError('LH_BRONZE_LAYER or LH_SILVER_LAYER not found in integration.Lakehouse')
    bronze_lh_id = int(bronze_lh[0]['LakehouseId'])
    silver_lh_id = int(silver_lh[0]['LakehouseId'])

    bronze_created = 0
    silver_created = 0
    incremental_updated = 0
    errors = []

    for e in entities:
        eid = int(e['entityId'])
        schema = e.get('schema', 'dbo')
        table = e.get('table', '')
        pks = e.get('primaryKeys', [])
        pk_str = ','.join(pks) if isinstance(pks, list) else str(pks)
        load_type = e.get('recommendedLoad', e.get('loadType', 'FULL'))
        watermark_col = e.get('recommendedColumn', e.get('watermarkColumn', ''))

        try:
            s_schema = _sanitize_sql_str(schema)
            # Look up the LZ FileName (prefixed name) for Bronze/Silver entity naming
            lz_file_row = _execute_parameterized(
                "SELECT FileName FROM integration.LandingzoneEntity WHERE LandingzoneEntityId = ?",
                (eid,))
            lz_file_name = lz_file_row[0]['FileName'] if lz_file_row else table
            s_name = _sanitize_sql_str(lz_file_name)

            # 1. Check if Bronze already exists in DB
            existing_bronze = _execute_parameterized(
                "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity WHERE LandingzoneEntityId = ?",
                (eid,))
            if not existing_bronze:
                s_pks = _sanitize_sql_str(pk_str) if pk_str else 'N/A'
                query_sql(
                    f"EXEC [integration].[sp_UpsertBronzeLayerEntity] "
                    f"@BronzeLayerEntityId = 0, @LandingzoneEntityId = {eid}, "
                    f"@LakehouseId = {bronze_lh_id}, @Schema = '{s_schema}', "
                    f"@Name = '{s_name}', @PrimaryKeys = '{s_pks}', "
                    f"@FileType = 'Delta', @IsActive = 1"
                )
                bronze_created += 1

            # 2. Get the Bronze entity ID (just created or pre-existing)
            bronze_check = _execute_parameterized(
                "SELECT BronzeLayerEntityId FROM integration.BronzeLayerEntity "
                "WHERE LandingzoneEntityId = ?", (eid,))
            if bronze_check:
                bronze_eid = int(bronze_check[0]['BronzeLayerEntityId'])

                # 3. Check if Silver already exists in DB
                existing_silver = _execute_parameterized(
                    "SELECT SilverLayerEntityId FROM integration.SilverLayerEntity WHERE BronzeLayerEntityId = ?",
                    (bronze_eid,))
                if not existing_silver:
                    query_sql(
                        f"EXEC [integration].[sp_UpsertSilverLayerEntity] "
                        f"@SilverLayerEntityId = 0, @BronzeLayerEntityId = {bronze_eid}, "
                        f"@LakehouseId = {silver_lh_id}, @Schema = '{s_schema}', "
                        f"@Name = '{s_name}', @FileType = 'delta', @IsActive = 1"
                    )
                    silver_created += 1

            # 4. Update incremental load config on LZ entity
            if load_type == 'INCREMENTAL' and watermark_col:
                s_wm = _sanitize_sql_str(watermark_col)
                query_sql(
                    f"UPDATE integration.LandingzoneEntity "
                    f"SET IsIncremental = 1, IsIncrementalColumn = '{s_wm}' "
                    f"WHERE LandingzoneEntityId = {eid}"
                )
                incremental_updated += 1

        except Exception as ex:
            errors.append({'entityId': eid, 'table': f'{schema}.{table}', 'error': str(ex)[:200]})
            log.warning(f'Failed to register Bronze/Silver for {schema}.{table}: {ex}')

    log.info(f'Bronze/Silver registration: bronze={bronze_created}, silver={silver_created}, '
             f'incremental={incremental_updated}, errors={len(errors)}')

    return {
        'success': True,
        'bronzeCreated': bronze_created,
        'silverCreated': silver_created,
        'incrementalUpdated': incremental_updated,
        'errors': errors,
        'summary': f'{bronze_created} Bronze + {silver_created} Silver entities created, '
                   f'{incremental_updated} set to incremental'
    }


def get_load_config(datasource_id: int = None) -> list[dict]:
    """Get the current load configuration matrix for all entities (or a specific datasource).

    Returns entity-level details including: load type, watermark column, last watermark value,
    Bronze/Silver registration status, and primary keys.
    """
    where = f"WHERE ds.DataSourceId = {int(datasource_id)}" if datasource_id else ""
    rows = query_sql(f"""
        SELECT le.LandingzoneEntityId AS entityId,
               ds.Namespace AS dataSource,
               ds.DataSourceId AS dataSourceId,
               le.SourceSchema AS [schema],
               le.SourceName AS [table],
               le.FileName,
               le.IsIncremental,
               le.IsIncrementalColumn AS watermarkColumn,
               llv.LoadValue AS lastWatermarkValue,
               llv.LastLoadDatetime AS lastLoadTime,
               ble.BronzeLayerEntityId AS bronzeEntityId,
               ble.PrimaryKeys AS primaryKeys,
               sle.SilverLayerEntityId AS silverEntityId
        FROM integration.LandingzoneEntity le
        JOIN integration.DataSource ds ON le.DataSourceId = ds.DataSourceId
        LEFT JOIN (
            SELECT LandingzoneEntityId, MAX(LoadValue) AS LoadValue,
                   MAX(LastLoadDatetime) AS LastLoadDatetime
            FROM execution.LandingzoneEntityLastLoadValue
            GROUP BY LandingzoneEntityId
        ) llv ON le.LandingzoneEntityId = llv.LandingzoneEntityId
        LEFT JOIN integration.BronzeLayerEntity ble ON le.LandingzoneEntityId = ble.LandingzoneEntityId
        LEFT JOIN integration.SilverLayerEntity sle ON ble.BronzeLayerEntityId = sle.BronzeLayerEntityId
        {where}
        ORDER BY ds.Name, le.SourceSchema, le.SourceName
    """)
    return rows


def update_load_config(updates: list[dict]) -> dict:
    """Batch-update IsIncremental and IsIncrementalColumn for multiple entities.

    Each update: {entityId: int, isIncremental: bool, watermarkColumn: str}
    """
    updated = 0
    for u in updates:
        eid = int(u['entityId'])
        is_inc = 1 if u.get('isIncremental', False) else 0
        wm_col = _sanitize_sql_str(u.get('watermarkColumn', ''))
        query_sql(
            f"UPDATE integration.LandingzoneEntity "
            f"SET IsIncremental = {is_inc}, IsIncrementalColumn = '{wm_col}' "
            f"WHERE LandingzoneEntityId = {eid}"
        )
        updated += 1
    return {'success': True, 'updated': updated}


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


# ── Config Manager ──

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # dashboard/app/api -> repo root

def _read_yaml(path: Path) -> dict:
    """Minimal YAML-subset reader for item_config.yaml (no PyYAML dependency)."""
    result: dict = {}
    stack: list[tuple[int, dict]] = [(-1, result)]
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        stripped = raw_line.split('#')[0].rstrip()
        if not stripped or stripped.isspace():
            continue
        indent = len(raw_line) - len(raw_line.lstrip())
        while stack and stack[-1][0] >= indent:
            stack.pop()
        parent = stack[-1][1] if stack else result
        if ':' in stripped:
            key, _, val = stripped.partition(':')
            key = key.strip().strip('"').strip("'")
            val = val.strip().strip('"').strip("'")
            if val:
                parent[key] = val
            else:
                child: dict = {}
                parent[key] = child
                stack.append((indent, child))
    return result


def get_config_manager() -> dict:
    """Gather all configuration from DB, pipeline JSONs, variable library, and item_config.yaml."""
    import glob as _glob

    # ── 1. Metadata DB ──
    db_workspaces = query_sql('SELECT WorkspaceId, WorkspaceGuid, Name FROM integration.Workspace ORDER BY WorkspaceId')
    db_lakehouses = query_sql('SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name, IsActive FROM integration.Lakehouse ORDER BY LakehouseId')
    db_connections = query_sql('SELECT ConnectionId, ConnectionGuid, Name, Type, GatewayType, DatasourceReference, IsActive FROM integration.Connection ORDER BY ConnectionId')
    db_datasources = query_sql('SELECT DataSourceId, ConnectionId, Name, Namespace, Type, Description, IsActive FROM integration.DataSource ORDER BY DataSourceId')
    db_pipelines = query_sql('SELECT PipelineId, PipelineGuid, Name, WorkspaceGuid, IsActive FROM integration.Pipeline ORDER BY PipelineId')

    # ── 2. item_config.yaml ──
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
    yaml_config: dict = {}
    if yaml_path.is_file():
        yaml_config = _read_yaml(yaml_path)

    # ── 3. Pipeline JSON parameter defaults + connection references ──
    pipeline_configs: list[dict] = []
    src_dir = _REPO_ROOT / 'src'
    for pdir in sorted(src_dir.glob('*.DataPipeline')):
        pfile = pdir / 'pipeline-content.json'
        if not pfile.is_file():
            continue
        try:
            with open(pfile, 'r', encoding='utf-8') as f:
                pdata = json.load(f)
            props = pdata.get('properties', {})
            params = props.get('parameters', {})
            # Extract Data_WorkspaceGuid default
            ws_param = params.get('Data_WorkspaceGuid', {})
            ws_default = ws_param.get('defaultValue', None) if isinstance(ws_param, dict) else None
            # Scan for all connection references and workspace IDs in the full JSON
            raw = pfile.read_text(encoding='utf-8')
            conn_refs = set()
            import re
            for m in re.finditer(r'"connection"\s*:\s*"([0-9a-fA-F-]{36})"', raw):
                conn_refs.add(m.group(1))
            for m in re.finditer(r'"connection"\s*:\s*"@item\(\)\.\w+"', raw):
                conn_refs.add(m.group(0).split('"')[3])
            # Collect pipeline invocation references
            invoke_refs = []
            for act in props.get('activities', []):
                if act.get('type') in ('InvokePipeline', 'ExecutePipeline'):
                    tp = act.get('typeProperties', {})
                    invoke_refs.append({
                        'name': act.get('name'),
                        'pipelineId': tp.get('pipelineId', ''),
                        'workspaceId': tp.get('workspaceId', ''),
                    })
                # Check ForEach inner activities too
                if act.get('type') == 'ForEach':
                    for iact in act.get('typeProperties', {}).get('activities', []):
                        if iact.get('type') == 'Switch':
                            for case in iact.get('typeProperties', {}).get('cases', []):
                                for cact in case.get('activities', []):
                                    if cact.get('type') in ('InvokePipeline', 'ExecutePipeline'):
                                        tp = cact.get('typeProperties', {})
                                        invoke_refs.append({
                                            'name': cact.get('name'),
                                            'pipelineId': tp.get('pipelineId', ''),
                                            'workspaceId': tp.get('workspaceId', ''),
                                        })
                        elif iact.get('type') in ('InvokePipeline', 'ExecutePipeline'):
                            tp = iact.get('typeProperties', {})
                            invoke_refs.append({
                                'name': iact.get('name'),
                                'pipelineId': tp.get('pipelineId', ''),
                                'workspaceId': tp.get('workspaceId', ''),
                            })

            pipeline_configs.append({
                'name': pdir.name.replace('.DataPipeline', ''),
                'wsParamDefault': ws_default,
                'connectionRefs': sorted(conn_refs),
                'invokeRefs': invoke_refs,
                'allParams': {k: v.get('defaultValue', '') if isinstance(v, dict) else v for k, v in params.items()},
            })
        except Exception as ex:
            pipeline_configs.append({'name': pdir.name, 'error': str(ex)})

    # ── 4. Variable Library ──
    var_lib: dict = {'variables': [], 'valueSets': {}}
    vl_dir = src_dir / 'VAR_CONFIG_FMD.VariableLibrary'
    vl_vars = vl_dir / 'variables.json'
    if vl_vars.is_file():
        with open(vl_vars) as f:
            var_lib['variables'] = json.load(f).get('variables', [])
    for vs_file in sorted((vl_dir / 'valueSets').glob('*.json')) if (vl_dir / 'valueSets').is_dir() else []:
        with open(vs_file) as f:
            vs_data = json.load(f)
            var_lib['valueSets'][vs_data.get('name', vs_file.stem)] = vs_data.get('variableOverrides', [])

    # ── 5. dashboard config.json (full structure by section) ──
    cfg_path = Path(__file__).parent / 'config.json'
    dash_config_full: dict = {}
    if cfg_path.is_file():
        with open(cfg_path, 'r', encoding='utf-8') as f:
            dash_config_full = json.load(f)

    # ── 6. Cross-reference & mismatch detection ──
    mismatches: list[dict] = []
    yaml_ws = yaml_config.get('workspaces', {})
    correct_data_dev = yaml_ws.get('workspace_data', '').lower()
    correct_code_dev = yaml_ws.get('workspace_code', '').lower()
    correct_config = yaml_ws.get('workspace_config', '').lower()

    # Check pipeline parameter defaults against item_config.yaml
    for pc in pipeline_configs:
        ws_def = pc.get('wsParamDefault')
        if ws_def and correct_data_dev and ws_def.lower() != correct_data_dev:
            mismatches.append({
                'severity': 'critical',
                'category': 'pipeline_param',
                'pipeline': pc['name'],
                'field': 'Data_WorkspaceGuid default',
                'current': ws_def,
                'expected': yaml_ws.get('workspace_data', ''),
                'message': f"Pipeline {pc['name']} has old workspace GUID as default parameter",
            })

    # Check DB workspaces against item_config
    yaml_ws_guids = {v.lower() for v in yaml_ws.values() if v and v != 'TBD'}
    for ws in db_workspaces:
        if ws.get('WorkspaceGuid', '').lower() not in yaml_ws_guids:
            mismatches.append({
                'severity': 'warning',
                'category': 'db_workspace',
                'field': ws.get('Name', ''),
                'current': ws.get('WorkspaceGuid', ''),
                'expected': '(not in item_config.yaml)',
                'message': f"DB workspace '{ws.get('Name')}' GUID not found in item_config.yaml",
            })

    # ── 7. Live Fabric entities (pull directly from REST API) ──
    fabric_entities: dict = {'workspaces': {}, 'items': {}}
    try:
        yaml_ws = yaml_config.get('workspaces', {})
        ws_map = {
            'workspace_data': yaml_ws.get('workspace_data', ''),
            'workspace_code': yaml_ws.get('workspace_code', ''),
            'workspace_config': yaml_ws.get('workspace_config', ''),
            'workspace_data_prod': yaml_ws.get('workspace_data_prod', ''),
            'workspace_code_prod': yaml_ws.get('workspace_code_prod', ''),
        }
        for ws_key, ws_guid in ws_map.items():
            if not ws_guid or ws_guid == 'TBD':
                continue
            try:
                ws_info = _fabric_api_get(f'workspaces/{ws_guid}')
                fabric_entities['workspaces'][ws_guid] = ws_info.get('displayName', ws_guid)
                items_data = _fabric_api_get(f'workspaces/{ws_guid}/items')
                fabric_entities['items'][ws_guid] = [
                    {
                        'id': it.get('id', ''),
                        'displayName': it.get('displayName', ''),
                        'type': it.get('type', ''),
                    }
                    for it in items_data.get('value', [])
                ]
            except Exception as ex:
                log.warning(f'Config Manager: failed to fetch Fabric items for {ws_key} ({ws_guid}): {ex}')
    except Exception as ex:
        log.warning(f'Config Manager: Fabric entity fetch failed: {ex}')

    # Also get live connections from Fabric
    fabric_connections: list[dict] = []
    try:
        conn_data = _fabric_api_get('connections')
        for c in conn_data.get('value', []):
            fabric_connections.append({
                'id': c.get('id', ''),
                'displayName': c.get('displayName', ''),
                'type': c.get('connectionDetails', {}).get('type', ''),
                'credentialType': c.get('credentialDetails', {}).get('credentialType', ''),
            })
    except Exception as ex:
        log.warning(f'Config Manager: failed to fetch Fabric connections: {ex}')

    return {
        'database': {
            'workspaces': db_workspaces,
            'lakehouses': db_lakehouses,
            'connections': db_connections,
            'datasources': db_datasources,
            'pipelines': db_pipelines,
        },
        'itemConfig': yaml_config,
        'pipelineConfigs': pipeline_configs,
        'variableLibrary': var_lib,
        'dashboardConfig': dash_config_full,
        'mismatches': mismatches,
        'fabricEntities': fabric_entities,
        'fabricConnections': fabric_connections,
    }


def get_notebook_config() -> dict:
    """Get all configuration data relevant to the setup notebook.
    Reads item_config.yaml, both variable libraries, and the template→real ID mapping.
    """
    src_dir = _REPO_ROOT / 'src'
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'

    # ── 1. item_config.yaml ──
    yaml_config = _read_yaml(yaml_path) if yaml_path.is_file() else {}

    # ── 2. VAR_CONFIG_FMD (framework config variables) ──
    var_config: dict = {'variables': [], 'valueSets': {}}
    vc_dir = src_dir / 'VAR_CONFIG_FMD.VariableLibrary'
    vc_vars = vc_dir / 'variables.json'
    if vc_vars.is_file():
        with open(vc_vars, encoding='utf-8') as f:
            var_config['variables'] = json.load(f).get('variables', [])
    for vs_file in sorted((vc_dir / 'valueSets').glob('*.json')) if (vc_dir / 'valueSets').is_dir() else []:
        with open(vs_file, encoding='utf-8') as f:
            vs_data = json.load(f)
            var_config['valueSets'][vs_data.get('name', vs_file.stem)] = vs_data.get('variableOverrides', [])

    # ── 3. VAR_FMD (key vault & runtime variables) ──
    var_fmd: dict = {'variables': [], 'valueSets': {}}
    vf_dir = src_dir / 'VAR_FMD.VariableLibrary'
    vf_vars = vf_dir / 'variables.json'
    if vf_vars.is_file():
        with open(vf_vars, encoding='utf-8') as f:
            var_fmd['variables'] = json.load(f).get('variables', [])
    for vs_file in sorted((vf_dir / 'valueSets').glob('*.json')) if (vf_dir / 'valueSets').is_dir() else []:
        with open(vs_file, encoding='utf-8') as f:
            vs_data = json.load(f)
            var_fmd['valueSets'][vs_data.get('name', vs_file.stem)] = vs_data.get('variableOverrides', [])

    # ── 4. Template → Real ID mapping (from deploy config) ──
    template_mapping = {}
    for ws_id, ws_label in _DEPLOY_WORKSPACE_LABELS.items():
        id_map = _DEPLOY_TEMPLATE_TO_REAL.get(ws_id, {})
        pipeline_ids = _DEPLOY_PIPELINE_IDS.get(ws_id, {})
        template_mapping[ws_label] = {
            'workspaceId': ws_id,
            'idReplacements': id_map,
            'pipelineIds': pipeline_ids,
            'replacementCount': len(id_map),
            'pipelineCount': len(pipeline_ids),
        }

    # ── 5. Missing connections (deactivated during deploy) ──
    missing_conns = list(_DEPLOY_MISSING_CONNECTIONS)

    return {
        'itemConfig': yaml_config,
        'varConfigFmd': var_config,
        'varFmd': var_fmd,
        'templateMapping': template_mapping,
        'missingConnections': missing_conns,
    }


def update_notebook_config(body: dict) -> dict:
    """Update a notebook configuration value (item_config.yaml or variable library)."""
    target = body.get('target', '')

    if target == 'item_config':
        section = body['section']
        key = body['key']
        new_val = body['newValue'].strip()
        yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
        yaml_data = _read_yaml(yaml_path)
        if section not in yaml_data:
            return {'error': f'Section {section} not found in item_config.yaml'}
        if isinstance(yaml_data[section], dict):
            yaml_data[section][key] = new_val
        else:
            return {'error': f'Section {section} is not a dict'}
        # Write back — preserve structure with simple YAML serialization
        lines = []
        for sec_name, sec_val in yaml_data.items():
            lines.append(f'{sec_name}:')
            if isinstance(sec_val, dict):
                for k, v in sec_val.items():
                    lines.append(f'    {k}: "{v}"')
            lines.append('')
        yaml_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return {'success': True, 'updated': 'item_config', 'section': section, 'key': key, 'newValue': new_val}

    elif target == 'var_config_fmd':
        var_name = body['variableName']
        new_val = body['newValue'].strip()
        var_path = _REPO_ROOT / 'src' / 'VAR_CONFIG_FMD.VariableLibrary' / 'variables.json'
        with open(var_path, encoding='utf-8') as f:
            data = json.load(f)
        for v in data.get('variables', []):
            if v['name'] == var_name:
                v['value'] = new_val
                break
        else:
            return {'error': f'Variable {var_name} not found'}
        with open(var_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        return {'success': True, 'updated': 'var_config_fmd', 'variable': var_name, 'newValue': new_val}

    elif target == 'var_fmd':
        var_name = body['variableName']
        new_val = body['newValue'].strip()
        var_path = _REPO_ROOT / 'src' / 'VAR_FMD.VariableLibrary' / 'variables.json'
        with open(var_path, encoding='utf-8') as f:
            data = json.load(f)
        for v in data.get('variables', []):
            if v['name'] == var_name:
                v['value'] = new_val
                break
        else:
            return {'error': f'Variable {var_name} not found'}
        with open(var_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        return {'success': True, 'updated': 'var_fmd', 'variable': var_name, 'newValue': new_val}

    return {'error': f'Unknown target: {target}'}


def _fabric_api_get(path: str) -> dict:
    """Make a GET request to the Fabric REST API."""
    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    url = f'https://api.fabric.microsoft.com/v1/{path}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


def find_notebook_in_workspace(workspace_id: str, notebook_name: str) -> str | None:
    """Find a notebook item ID by name in a workspace."""
    try:
        data = _fabric_api_get(f'workspaces/{workspace_id}/items?type=Notebook')
        for item in data.get('value', []):
            if item.get('displayName', '').lower() == notebook_name.lower():
                return item['id']
    except Exception as ex:
        log.error(f'Failed to list notebooks in workspace {workspace_id}: {ex}')
    return None


def _resolve_workspace_name(workspace_id: str) -> str | None:
    """Resolve a workspace GUID to its Fabric display name."""
    try:
        data = _fabric_api_get(f'workspaces/{workspace_id}')
        return data.get('displayName')
    except Exception:
        return None


def deploy_preflight() -> dict:
    """Pre-flight check: scan Fabric for existing workspaces, connections, and the setup notebook.
    Returns a structured report of what exists vs what will be created.
    Resolves all GUIDs to human-readable Fabric display names."""
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
    yaml_config = _read_yaml(yaml_path) if yaml_path.is_file() else {}
    ws_config = yaml_config.get('workspaces', {})
    conn_config = yaml_config.get('connections', {})

    result = {'workspaces': [], 'connections': [], 'notebook': None, 'ready': True}

    # Check workspaces — resolve display names from Fabric
    workspace_checks = [
        ('Config (keep)', ws_config.get('workspace_config', ''), False),
        ('DEV DATA', ws_config.get('workspace_data', ''), True),
        ('DEV CODE', ws_config.get('workspace_code', ''), True),
        ('PROD DATA', ws_config.get('workspace_data_prod', ''), True),
        ('PROD CODE', ws_config.get('workspace_code_prod', ''), True),
    ]
    for label, ws_id, will_delete in workspace_checks:
        entry = {'label': label, 'id': ws_id, 'exists': False, 'willDelete': will_delete, 'displayName': None}
        if ws_id and ws_id != 'TBD':
            try:
                data = _fabric_api_get(f'workspaces/{ws_id}')
                entry['exists'] = True
                entry['displayName'] = data.get('displayName')
            except Exception:
                pass
        result['workspaces'].append(entry)

    # Check connections — resolve display names from Fabric
    conn_name_map: dict[str, str] = {}   # id -> displayName
    try:
        token = get_fabric_token('https://api.fabric.microsoft.com/.default')
        url = 'https://api.fabric.microsoft.com/v1/connections'
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        resp = urllib.request.urlopen(req, timeout=30)
        all_conns = json.loads(resp.read()).get('value', [])
        conn_id_set = {c['id'] for c in all_conns}
        conn_name_map = {c['id']: c.get('displayName', '') for c in all_conns}
    except Exception:
        all_conns = []
        conn_id_set = set()

    for label, guid in conn_config.items():
        entry = {
            'label': label,
            'id': guid,
            'exists': guid in conn_id_set,
            'displayName': conn_name_map.get(guid),
        }
        result['connections'].append(entry)

    # Check setup notebook — NB_SETUP_FMD is the orchestrator (triggers NB_UTILITIES_SETUP_FMD)
    config_ws = ws_config.get('workspace_config', '')
    if config_ws and config_ws != 'TBD':
        nb_id = find_notebook_in_workspace(config_ws, 'NB_SETUP_FMD')
        if nb_id:
            result['notebook'] = {'id': nb_id, 'name': 'NB_SETUP_FMD', 'exists': True}
        else:
            result['notebook'] = {'id': None, 'name': 'NB_SETUP_FMD', 'exists': False}
            result['ready'] = False
    else:
        result['notebook'] = {'id': None, 'name': 'NB_SETUP_FMD', 'exists': False}
        result['ready'] = False

    return result


# ── Deployment Status ──

# Known workspace names that the setup notebook creates
_EXPECTED_WORKSPACES = {
    'INTEGRATION DATA (D)': 'workspace_data',
    'INTEGRATION CODE (D)': 'workspace_code',
    'INTEGRATION DATA (P)': 'workspace_data_prod',
    'INTEGRATION CODE (P)': 'workspace_code_prod',
}

# Config workspace is the one that houses the notebook (not created by it)
_CONFIG_WORKSPACE_ID = '147f6bac-bd0c-4c30-9b76-0f1c94987dda'
_SETUP_NOTEBOOK_NAME = 'NB_SETUP_FMD'


def get_deployment_status() -> dict:
    """Check if NB_SETUP_FMD is currently running and discover new workspaces when done.

    Returns:
        status: 'idle' | 'running' | 'completed' | 'failed'
        job: latest job details (if any)
        newWorkspaces: dict of discovered workspaces (when completed)
        newSqlEndpoint: SQL endpoint of the new database (when completed)
    """
    result = {'status': 'idle', 'job': None, 'newWorkspaces': None, 'newSqlEndpoint': None, 'newItems': None}

    try:
        # Find NB_SETUP_FMD in the config workspace
        nb_id = find_notebook_in_workspace(_CONFIG_WORKSPACE_ID, _SETUP_NOTEBOOK_NAME)
        if not nb_id:
            result['status'] = 'no_notebook'
            result['message'] = 'NB_SETUP_FMD not found in config workspace'
            return result

        # Get recent job instances
        data = _fabric_api_get(
            f'workspaces/{_CONFIG_WORKSPACE_ID}/items/{nb_id}/jobs/instances?limit=3'
        )
        jobs = data.get('value', [])
        if not jobs:
            result['status'] = 'idle'
            result['message'] = 'No job history'
            return result

        latest = jobs[0]
        job_status = latest.get('status', '')
        result['job'] = {
            'id': latest.get('id', ''),
            'status': job_status,
            'startTime': latest.get('startTimeUtc', ''),
            'endTime': latest.get('endTimeUtc', ''),
            'failureReason': latest.get('failureReason'),
        }

        if job_status == 'InProgress' or job_status == 'NotStarted':
            result['status'] = 'running'
            result['message'] = 'Environment setup in progress...'
            # Also discover any workspaces that have been created so far
            result['newWorkspaces'] = _discover_new_workspaces()
            return result

        if job_status == 'Failed':
            result['status'] = 'failed'
            result['message'] = latest.get('failureReason') or 'Deployment failed'
            return result

        if job_status == 'Completed':
            # Only show overlay if it completed recently (within 2 hours)
            end_time = latest.get('endTimeUtc', '')
            if end_time:
                from datetime import datetime, timezone, timedelta
                try:
                    end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                    if datetime.now(timezone.utc) - end_dt > timedelta(hours=2):
                        result['status'] = 'idle'
                        result['message'] = 'Last deployment completed (not recent)'
                        return result
                except (ValueError, TypeError):
                    pass  # If we can't parse the time, proceed to show completed
            result['status'] = 'completed'
            result['message'] = 'Deployment completed'

            # Discover the new workspaces and their items
            ws_map = _discover_new_workspaces()
            result['newWorkspaces'] = ws_map

            # Find the new SQL database endpoint
            config_ws = ws_map.get('config_workspace')
            if config_ws:
                result['newSqlEndpoint'] = _discover_sql_endpoint(config_ws)

            # Discover items in each workspace
            items_summary = {}
            for role, ws_id in ws_map.items():
                if ws_id and role != 'config_workspace':
                    try:
                        ws_items = _fabric_api_get(f'workspaces/{ws_id}/items')
                        items_summary[role] = len(ws_items.get('value', []))
                    except Exception:
                        items_summary[role] = 0
            result['newItems'] = items_summary
            return result

        result['status'] = job_status.lower()
        return result

    except Exception as ex:
        log.error(f'Deployment status check failed: {ex}')
        result['status'] = 'error'
        result['message'] = str(ex)
        return result


def _discover_new_workspaces() -> dict:
    """Scan Fabric for workspaces matching the expected names from the setup notebook."""
    ws_map = {}
    try:
        all_ws = _fabric_api_get('workspaces')
        name_to_id = {w['displayName']: w['id'] for w in all_ws.get('value', [])}

        for display_name, config_key in _EXPECTED_WORKSPACES.items():
            ws_map[config_key] = name_to_id.get(display_name)

        # Also find the INTEGRATION CONFIG workspace (SQL database lives here)
        ws_map['config_workspace'] = name_to_id.get('INTEGRATION CONFIG')

    except Exception as ex:
        log.error(f'Workspace discovery failed: {ex}')
    return ws_map


def _discover_sql_endpoint(config_workspace_id: str) -> dict | None:
    """Find the SQL database in the config workspace and return its endpoint."""
    try:
        items = _fabric_api_get(f'workspaces/{config_workspace_id}/items?type=SQLDatabase')
        for item in items.get('value', []):
            # Look for our framework database
            name = item.get('displayName', '')
            if 'INTEGRATION' in name.upper() or 'FMD' in name.upper():
                db_id = item['id']
                # Get database details for the connection string
                detail = _fabric_api_get(f'workspaces/{config_workspace_id}/sqlDatabases/{db_id}')
                props = detail.get('properties', {})
                return {
                    'id': db_id,
                    'displayName': name,
                    'server': props.get('serverFqdn', ''),
                    'database': props.get('databaseName', name),
                    'connectionString': props.get('connectionString', ''),
                }
        # Fallback: return first SQL database found
        if items.get('value'):
            item = items['value'][0]
            db_id = item['id']
            detail = _fabric_api_get(f'workspaces/{config_workspace_id}/sqlDatabases/{db_id}')
            props = detail.get('properties', {})
            return {
                'id': db_id,
                'displayName': item.get('displayName', ''),
                'server': props.get('serverFqdn', ''),
                'database': props.get('databaseName', ''),
                'connectionString': props.get('connectionString', ''),
            }
    except Exception as ex:
        log.error(f'SQL endpoint discovery failed: {ex}')
    return None


def apply_new_deployment_config(body: dict) -> dict:
    """After deployment completes, update config.json and item_config.yaml with new GUIDs.
    Called by the frontend once the user (or auto-process) confirms the new environment."""
    try:
        new_ws = body.get('workspaces', {})
        new_sql = body.get('sqlEndpoint', {})

        # Update config.json
        config_path = Path(__file__).parent / 'config.json'
        with open(config_path, 'r') as f:
            cfg = json.load(f)

        if new_ws.get('workspace_data'):
            cfg['fabric']['workspace_data_id'] = new_ws['workspace_data']
        if new_ws.get('workspace_code'):
            cfg['fabric']['workspace_code_id'] = new_ws['workspace_code']
        if new_sql.get('server'):
            cfg['sql']['server'] = new_sql['server']
        if new_sql.get('database'):
            cfg['sql']['database'] = new_sql['database']

        with open(config_path, 'w') as f:
            json.dump(cfg, f, indent=2)

        # Update item_config.yaml
        yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
        if yaml_path.is_file():
            lines = []
            with open(yaml_path, 'r') as f:
                content = f.read()

            yaml_cfg = _read_yaml(yaml_path)
            ws_section = yaml_cfg.get('workspaces', {})

            # Rebuild workspace section with new values
            new_yaml_lines = ['workspaces:\n']
            key_map = {
                'workspace_data': new_ws.get('workspace_data', ws_section.get('workspace_data', '')),
                'workspace_code': new_ws.get('workspace_code', ws_section.get('workspace_code', '')),
                'workspace_config': new_ws.get('config_workspace', ws_section.get('workspace_config', '')),
                'workspace_data_prod': new_ws.get('workspace_data_prod', ws_section.get('workspace_data_prod', '')),
                'workspace_code_prod': new_ws.get('workspace_code_prod', ws_section.get('workspace_code_prod', '')),
            }
            for key, val in key_map.items():
                new_yaml_lines.append(f'    {key}: "{val}"\n')

            # Keep everything after the workspaces section
            in_ws = False
            rest_lines = []
            for line in content.split('\n'):
                if line.startswith('workspaces:'):
                    in_ws = True
                    continue
                if in_ws and (line.startswith('    ') or line.strip() == ''):
                    if line.strip() == '' and not any(l.strip() for l in content.split('\n')[content.split('\n').index(line)+1:] if l.startswith('    ')):
                        in_ws = False
                        rest_lines.append(line)
                    continue
                else:
                    in_ws = False
                    rest_lines.append(line)

            # Write updated yaml
            with open(yaml_path, 'w') as f:
                f.writelines(new_yaml_lines)
                f.write('\n')
                f.write('\n'.join(rest_lines))

            # Also update the database section if we have new SQL info
            if new_sql.get('server') or new_sql.get('id'):
                yaml_cfg = _read_yaml(yaml_path)
                db_section = yaml_cfg.get('database', {})
                # Simple re-write approach
                content = yaml_path.read_text()
                if new_sql.get('id'):
                    old_id = db_section.get('id', '')
                    if old_id:
                        content = content.replace(old_id, new_sql['id'])
                if new_sql.get('server'):
                    old_server = db_section.get('endpoint', '')
                    if old_server:
                        content = content.replace(old_server, new_sql['server'])
                if new_sql.get('displayName'):
                    old_name = db_section.get('displayName', '')
                    if old_name:
                        content = content.replace(old_name, new_sql['displayName'])
                yaml_path.write_text(content)

        log.info(f'Deployment config updated: workspaces={new_ws}, sql={new_sql}')
        return {'success': True, 'message': 'Configuration updated. Restart server to apply.'}

    except Exception as ex:
        log.exception('Failed to apply new deployment config')
        return {'error': str(ex)}


def delete_fabric_workspace(workspace_id: str) -> dict:
    """Delete a Fabric workspace by ID."""
    try:
        token = get_fabric_token('https://api.fabric.microsoft.com/.default')
        url = f'https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}'
        req = urllib.request.Request(url, method='DELETE',
                                    headers={'Authorization': f'Bearer {token}'})
        resp = urllib.request.urlopen(req, timeout=30)
        log.info(f'Deleted workspace {workspace_id} — status {resp.status}')
        sys.stdout.flush()
        return {'success': True, 'workspaceId': workspace_id, 'status': resp.status}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log.error(f'Failed to delete workspace {workspace_id}: {e.code} — {body[:200]}')
        return {'error': f'Failed to delete workspace {workspace_id}: HTTP {e.code}'}
    except Exception as ex:
        return {'error': f'Failed to delete workspace {workspace_id}: {ex}'}


def deploy_wipe_and_trigger() -> dict:
    """Full deployment flow: delete old workspaces, then trigger the setup notebook.
    Returns the trigger result (notebook ID, workspace ID, job location)."""
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
    yaml_config = _read_yaml(yaml_path) if yaml_path.is_file() else {}
    ws_config = yaml_config.get('workspaces', {})

    log_entries = []

    # Step 1: Delete DEV and PROD workspaces
    workspaces_to_delete = [
        ('DEV DATA', ws_config.get('workspace_data', '')),
        ('DEV CODE', ws_config.get('workspace_code', '')),
        ('PROD DATA', ws_config.get('workspace_data_prod', '')),
        ('PROD CODE', ws_config.get('workspace_code_prod', '')),
    ]
    for label, ws_id in workspaces_to_delete:
        if not ws_id or ws_id == 'TBD':
            log_entries.append(f'Skipping {label} — no workspace ID configured')
            continue
        # Check if workspace exists first
        try:
            _fabric_api_get(f'workspaces/{ws_id}')
        except Exception:
            log_entries.append(f'{label} ({ws_id[:8]}...) — not found, skipping')
            continue
        result = delete_fabric_workspace(ws_id)
        if result.get('success'):
            log_entries.append(f'Deleted {label} workspace ({ws_id[:8]}...)')
        else:
            log_entries.append(f'Failed to delete {label}: {result.get("error", "unknown")}')

    # Step 2: Trigger the notebook
    log_entries.append('Triggering setup notebook...')
    trigger_result = trigger_setup_notebook()
    trigger_result['deleteLog'] = log_entries
    return trigger_result


def trigger_setup_notebook() -> dict:
    """Trigger the NB_UTILITIES_SETUP_FMD notebook in the CONFIG workspace.
    Returns the job location URL for polling status.
    """
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
    yaml_config = _read_yaml(yaml_path) if yaml_path.is_file() else {}
    config_ws = yaml_config.get('workspaces', {}).get('workspace_config', '')

    if not config_ws:
        return {'error': 'workspace_config not set in item_config.yaml'}

    log.info(f'Looking for NB_SETUP_FMD (orchestrator) in workspace {config_ws}')
    sys.stdout.flush()

    # NB_SETUP_FMD is the orchestrator — it loads NB_UTILITIES_SETUP_FMD internally
    notebook_id = find_notebook_in_workspace(config_ws, 'NB_SETUP_FMD')
    if not notebook_id:
        for name in ['NB_UTILITIES_SETUP_FMD', 'SETUP_FMD']:
            notebook_id = find_notebook_in_workspace(config_ws, name)
            if notebook_id:
                break

    if not notebook_id:
        return {'error': f'Setup notebook not found in CONFIG workspace ({config_ws}). '
                         f'Deploy it first or check the workspace_config GUID.'}

    log.info(f'Found notebook: {notebook_id} — triggering job')
    sys.stdout.flush()

    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{config_ws}'
        f'/items/{notebook_id}/jobs/instances?jobType=RunNotebook'
    )
    req = urllib.request.Request(url, method='POST', data=b'{}',
                                headers={'Authorization': f'Bearer {token}',
                                         'Content-Type': 'application/json'})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        location = resp.headers.get('Location', '')
        log.info(f'Notebook triggered — status: {resp.status}, location: {location}')
        sys.stdout.flush()
        return {
            'success': True,
            'notebookId': notebook_id,
            'workspaceId': config_ws,
            'status': resp.status,
            'location': location,
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log.error(f'Notebook trigger failed: {e.code} — {body}')
        err_msg = body[:300]
        try:
            err_data = json.loads(body)
            err_msg = f"{err_data.get('errorCode', '')}: {err_data.get('message', body)[:300]}"
        except Exception:
            pass
        return {'error': f'Fabric API error {e.code}: {err_msg}'}


def get_notebook_job_status(workspace_id: str, notebook_id: str) -> dict:
    """Get recent job instances for a notebook."""
    try:
        data = _fabric_api_get(
            f'workspaces/{workspace_id}/items/{notebook_id}/jobs/instances?limit=5'
        )
        jobs = []
        for job in data.get('value', []):
            jobs.append({
                'id': job.get('id', ''),
                'status': job.get('status', ''),
                'startTime': job.get('startTimeUtc', ''),
                'endTime': job.get('endTimeUtc', ''),
                'failureReason': job.get('failureReason'),
            })
        return {'jobs': jobs}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return {'error': f'API error {e.code}: {body[:200]}'}
    except Exception as ex:
        return {'error': str(ex)}


# ── Notebook Debug Runner ──

def notebook_debug_list() -> dict:
    """List all notebooks in the CODE workspace with their IDs."""
    code_ws = CONFIG['fabric'].get('workspace_code_id', '')
    if not code_ws:
        return {'error': 'workspace_code_id not configured'}
    try:
        data = _fabric_api_get(f'workspaces/{code_ws}/items?type=Notebook')
        notebooks = []
        for item in data.get('value', []):
            notebooks.append({
                'id': item['id'],
                'name': item['displayName'],
            })
        notebooks.sort(key=lambda x: x['name'])
        return {'workspaceId': code_ws, 'notebooks': notebooks}
    except Exception as ex:
        return {'error': str(ex)}


def notebook_debug_get_entities(layer: str = 'bronze') -> dict:
    """Get the entity list from the stored proc (same as what the pipeline passes).

    Uses _Full variants of stored procs because the originals now return
    lightweight signals (to bypass ADF 1MB pipeline parameter limit).
    The _Full procs return the complete JSON payload that the dashboard needs.
    """
    try:
        if layer == 'bronze':
            rows = query_sql('EXEC [execution].[sp_GetBronzelayerEntity_Full]')
        elif layer == 'silver':
            rows = query_sql('EXEC [execution].[sp_GetSilverlayerEntity_Full]')
        elif layer == 'landing':
            # No stored proc exists for landing zone — query the view directly
            lz_rows = query_sql('''
                SELECT EntityId, DataSourceName, DataSourceNamespace, SourceSchema,
                       SourceName, TargetFilePath, TargetFileName, TargetFileType,
                       LOWER(CONVERT(NVARCHAR(36), TargetLakehouseGuid)) AS TargetLakehouseGuid,
                       LOWER(CONVERT(NVARCHAR(36), WorkspaceGuid)) AS WorkspaceGuid,
                       ConnectionGuid, ConnectionType, IsIncremental
                FROM [execution].[vw_LoadSourceToLandingzone]
            ''')
            if not lz_rows:
                return {'entities': [], 'totalCount': 0, 'notebookParams': None}
            entity_summary = []
            params = []
            for r in lz_rows:
                entity_summary.append({
                    'namespace': (r.get('DataSourceNamespace') or '').lower(),
                    'schema': r.get('SourceSchema', ''),
                    'table': r.get('SourceName', ''),
                    'fileName': r.get('TargetFileName', ''),
                })
                params.append({
                    'path': 'PL_FMD_LOAD_LANDINGZONE',
                    'params': {
                        'DataSourceNamespace': (r.get('DataSourceNamespace') or '').lower(),
                        'TargetSchema': r.get('SourceSchema', ''),
                        'TargetName': r.get('SourceName', ''),
                        'SourceFileName': r.get('TargetFileName', ''),
                        'TargetLakehouse': r.get('TargetLakehouseGuid', ''),
                        'TargetWorkspace': r.get('WorkspaceGuid', ''),
                        'ConnectionGuid': r.get('ConnectionGuid', ''),
                        'LandingzoneEntityId': r.get('EntityId', ''),
                    }
                })
            return {
                'entities': entity_summary,
                'totalCount': len(entity_summary),
                'notebookParams': params,
                '_note': 'Landing zone uses pipeline Copy Activities, not notebooks',
            }
        else:
            return {'error': f'Unknown layer: {layer}'}

        if not rows:
            return {'entities': [], 'totalCount': 0, 'notebookParams': None}

        # The stored proc returns a NotebookParams column with the JSON payload
        nb_params = rows[0].get('NotebookParams', rows[0].get('notebookParams', ''))
        try:
            params = json.loads(nb_params) if isinstance(nb_params, str) else nb_params
        except (json.JSONDecodeError, TypeError):
            params = []

        # Extract entity summary for the UI
        entity_summary = []
        for p in (params if isinstance(params, list) else []):
            prm = p.get('params', {})
            entity_summary.append({
                'namespace': prm.get('DataSourceNamespace', ''),
                'schema': prm.get('TargetSchema', ''),
                'table': prm.get('TargetName', ''),
                'fileName': prm.get('SourceFileName', ''),
            })

        return {
            'entities': entity_summary,
            'totalCount': len(entity_summary),
            'notebookParams': params,
        }
    except Exception as ex:
        return {'error': str(ex)}


def notebook_debug_run(body: dict) -> dict:
    """Run a notebook directly via Fabric API with controlled parameters.
    body: {
        notebookId: str,         # Fabric notebook ID
        layer: 'bronze'|'silver'|'landing',  # which entity set to use
        maxEntities: int,        # limit number of entities (0 = all)
        dataSourceFilter: str,   # optional: filter by DataSourceNamespace
        chunkMode: str,          # 'batch' or '' (empty = let chunking decide)
        customParams: dict,      # optional: override params
    }
    """
    code_ws = CONFIG['fabric'].get('workspace_code_id', '')
    if not code_ws:
        return {'error': 'workspace_code_id not configured'}

    notebook_id = body.get('notebookId', '')
    if not notebook_id:
        return {'error': 'notebookId is required'}

    layer = body.get('layer', 'bronze')
    max_entities = int(body.get('maxEntities', 0))
    ds_filter = body.get('dataSourceFilter', '').strip()
    chunk_mode = body.get('chunkMode', '')

    # Get entities from stored proc
    entity_data = notebook_debug_get_entities(layer)
    if 'error' in entity_data:
        return entity_data

    params_list = entity_data.get('notebookParams', [])
    if not params_list:
        return {'error': 'No entities returned from stored proc'}

    # Apply data source filter
    if ds_filter:
        params_list = [
            p for p in params_list
            if p.get('params', {}).get('DataSourceNamespace', '') == ds_filter
        ]
        if not params_list:
            return {'error': f'No entities found for DataSourceNamespace={ds_filter}'}

    # Apply entity limit
    original_count = len(params_list)
    if max_entities > 0:
        params_list = params_list[:max_entities]

    # Build notebook run payload
    run_params = {
        'Path': {
            'value': json.dumps(params_list),
            'type': 'string'
        }
    }
    if chunk_mode:
        run_params['chunk_mode'] = {'value': chunk_mode, 'type': 'string'}

    # Add any custom params
    custom = body.get('customParams', {})
    for k, v in custom.items():
        run_params[k] = {'value': str(v), 'type': 'string'}

    payload = json.dumps({'executionData': {'parameters': run_params}}).encode()

    # Trigger notebook run via Fabric API
    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    url = (
        f'https://api.fabric.microsoft.com/v1/workspaces/{code_ws}'
        f'/items/{notebook_id}/jobs/instances?jobType=RunNotebook'
    )
    req = urllib.request.Request(url, method='POST', data=payload,
                                headers={'Authorization': f'Bearer {token}',
                                         'Content-Type': 'application/json'})
    try:
        resp = urllib.request.urlopen(req)
        location = resp.headers.get('Location', '')
        job_id = location.rstrip('/').split('/')[-1] if location else ''
        log.info(f'Notebook debug run started: {notebook_id} with {len(params_list)} entities (job={job_id})')
        return {
            'success': True,
            'jobInstanceId': job_id,
            'notebookId': notebook_id,
            'workspaceId': code_ws,
            'entityCount': len(params_list),
            'originalCount': original_count,
            'dataSourceFilter': ds_filter or None,
            'chunkMode': chunk_mode or 'auto',
            'location': location,
        }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        log.error(f'Notebook debug run failed: {e.code} — {err_body[:300]}')
        return {'error': f'Fabric API error {e.code}: {err_body[:300]}'}


def notebook_debug_job_status(job_id: str, notebook_id: str = '') -> dict:
    """Get status of a specific notebook debug run job by job instance ID."""
    code_ws = CONFIG['fabric'].get('workspace_code_id', '')
    if not code_ws:
        return {'error': 'workspace_code_id not configured'}
    try:
        if notebook_id:
            # Use the correct job instances API (not the operations API)
            url = (
                f'https://api.fabric.microsoft.com/v1/workspaces/{code_ws}'
                f'/items/{notebook_id}/jobs/instances/{job_id}'
            )
        else:
            # Fallback to operations API if no notebook ID provided
            url = f'https://api.fabric.microsoft.com/v1/operations/{job_id}'
        token = get_fabric_token('https://api.fabric.microsoft.com/.default')
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        # Job instances API returns different field names than operations API
        if notebook_id:
            return {
                'status': data.get('status', 'Unknown'),
                'startTime': data.get('startTimeUtc', ''),
                'endTime': data.get('endTimeUtc', ''),
                'failureReason': data.get('failureReason'),
            }
        else:
            return {
                'status': data.get('status', 'Unknown'),
                'percentComplete': data.get('percentComplete', 0),
                'startTime': data.get('createdTimeUtc', ''),
                'endTime': data.get('lastUpdatedTimeUtc', ''),
                'error': data.get('error'),
            }
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        return {'error': f'Could not get job status: {e.code} — {err_body[:200]}'}
    except Exception as ex:
        return {'error': str(ex)}


def update_config_value(body: dict) -> dict:
    """Update a configuration value in the metadata DB or pipeline JSON."""
    target = body.get('target', '')  # 'workspace', 'lakehouse', 'connection', 'datasource', 'pipeline_param'

    if target == 'workspace':
        ws_id = int(body['workspaceId'])
        new_guid = body['newGuid'].strip()
        new_name = body.get('newName', '').strip()
        if new_guid:
            query_sql(f"UPDATE integration.Workspace SET WorkspaceGuid = '{new_guid}' WHERE WorkspaceId = {ws_id}")
        if new_name:
            query_sql(f"UPDATE integration.Workspace SET Name = '{new_name}' WHERE WorkspaceId = {ws_id}")
        return {'success': True, 'updated': 'workspace', 'workspaceId': ws_id}

    elif target == 'lakehouse':
        lh_id = int(body['lakehouseId'])
        updates = []
        if body.get('newGuid'):
            updates.append(f"LakehouseGuid = '{body['newGuid'].strip()}'")
        if body.get('newWorkspaceGuid'):
            updates.append(f"WorkspaceGuid = '{body['newWorkspaceGuid'].strip()}'")
        if body.get('newName'):
            updates.append(f"Name = '{body['newName'].strip()}'")
        if updates:
            query_sql(f"UPDATE integration.Lakehouse SET {', '.join(updates)} WHERE LakehouseId = {lh_id}")
        return {'success': True, 'updated': 'lakehouse', 'lakehouseId': lh_id}

    elif target == 'connection':
        conn_id = int(body['connectionId'])
        updates = []
        if body.get('newGuid'):
            updates.append(f"ConnectionGuid = '{body['newGuid'].strip()}'")
        if body.get('newType'):
            updates.append(f"Type = '{body['newType'].strip()}'")
        if body.get('newName'):
            updates.append(f"Name = '{body['newName'].strip()}'")
        if updates:
            query_sql(f"UPDATE integration.Connection SET {', '.join(updates)} WHERE ConnectionId = {conn_id}")
        return {'success': True, 'updated': 'connection', 'connectionId': conn_id}

    elif target == 'pipeline_param':
        pipeline_name = body['pipelineName']
        param_name = body['paramName']
        new_value = body['newValue'].strip()
        pfile = _REPO_ROOT / 'src' / f'{pipeline_name}.DataPipeline' / 'pipeline-content.json'
        if not pfile.is_file():
            return {'error': f'Pipeline file not found: {pfile}'}
        with open(pfile, 'r', encoding='utf-8') as f:
            pdata = json.load(f)
        params = pdata.get('properties', {}).get('parameters', {})
        if param_name in params:
            params[param_name]['defaultValue'] = new_value
            with open(pfile, 'w', encoding='utf-8') as f:
                json.dump(pdata, f, indent=2)
            return {'success': True, 'updated': 'pipeline_param', 'pipeline': pipeline_name, 'param': param_name, 'newValue': new_value}
        return {'error': f'Parameter {param_name} not found in {pipeline_name}'}

    elif target == 'datasource':
        ds_id = int(body['dataSourceId'])
        updates = []
        if body.get('newName'):
            updates.append(f"Name = '{body['newName'].strip()}'")
        if body.get('newNamespace'):
            updates.append(f"Namespace = '{body['newNamespace'].strip()}'")
        if body.get('newType'):
            updates.append(f"Type = '{body['newType'].strip()}'")
        if body.get('newConnectionId'):
            updates.append(f"ConnectionId = {int(body['newConnectionId'])}")
        if body.get('newIsActive') is not None:
            updates.append(f"IsActive = {1 if body['newIsActive'] else 0}")
        if updates:
            query_sql(f"UPDATE integration.DataSource SET {', '.join(updates)} WHERE DataSourceId = {ds_id}")
        return {'success': True, 'updated': 'datasource', 'dataSourceId': ds_id}

    elif target == 'pipeline_db':
        p_id = int(body['pipelineId'])
        updates = []
        if body.get('newGuid'):
            updates.append(f"PipelineGuid = '{body['newGuid'].strip()}'")
        if body.get('newWorkspaceGuid'):
            updates.append(f"WorkspaceGuid = '{body['newWorkspaceGuid'].strip()}'")
        if body.get('newName'):
            updates.append(f"Name = '{body['newName'].strip()}'")
        if body.get('newIsActive') is not None:
            updates.append(f"IsActive = {1 if body['newIsActive'] else 0}")
        if updates:
            query_sql(f"UPDATE integration.Pipeline SET {', '.join(updates)} WHERE PipelineId = {p_id}")
        return {'success': True, 'updated': 'pipeline_db', 'pipelineId': p_id}

    elif target == 'dashboard_config':
        section = body['section']     # 'fabric', 'sql', 'server', 'purview', 'logging'
        key = body['key']             # e.g. 'tenant_id', 'workspace_data_id'
        new_val = body['newValue'].strip()
        cfg_path = Path(__file__).parent / 'config.json'
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if section not in cfg:
            return {'error': f'Unknown config section: {section}'}
        if key not in cfg[section]:
            return {'error': f'Unknown key {key} in section {section}'}
        cfg[section][key] = new_val
        with open(cfg_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)
            f.write('\n')
        return {'success': True, 'updated': 'dashboard_config', 'section': section, 'key': key, 'newValue': new_val}

    elif target == 'pipeline_guid_replace':
        old_guid = body['oldGuid'].strip().lower()
        new_guid = body['newGuid'].strip()
        affected = []
        src_dir = _REPO_ROOT / 'src'
        for pdir in src_dir.glob('*.DataPipeline'):
            pfile = pdir / 'pipeline-content.json'
            if not pfile.is_file():
                continue
            content = pfile.read_text(encoding='utf-8')
            if old_guid in content.lower():
                import re
                new_content = re.sub(re.escape(old_guid), new_guid, content, flags=re.IGNORECASE)
                pfile.write_text(new_content, encoding='utf-8')
                affected.append(pdir.name.replace('.DataPipeline', ''))
        return {'success': True, 'updated': 'pipeline_guid_replace', 'oldGuid': old_guid, 'newGuid': new_guid, 'affected': affected}

    else:
        return {'error': f'Unknown target: {target}'}


def find_guid_references(guid: str) -> dict:
    """Find every location where a given GUID appears across all framework configs.

    Returns a list of 'references', each with:
      - location: human-readable path (e.g. "Workspace #1 → WorkspaceGuid")
      - target: the update target type for updating this reference
      - params: the parameters needed to call update_config_value
    """
    import glob as _glob
    guid_lower = guid.strip().lower()
    if len(guid_lower) < 8:
        return {'error': 'GUID too short for reference search', 'references': []}

    refs: list[dict] = []

    # ── 1. DB Workspaces ──
    rows = query_sql('SELECT WorkspaceId, WorkspaceGuid, Name FROM integration.Workspace')
    for r in rows:
        if (r.get('WorkspaceGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Workspace #{r['WorkspaceId']} \"{r['Name']}\" → WorkspaceGuid",
                'target': 'workspace',
                'params': {'workspaceId': r['WorkspaceId']},
                'field': 'newGuid',
            })

    # ── 2. DB Lakehouses ──
    rows = query_sql('SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name FROM integration.Lakehouse')
    for r in rows:
        if (r.get('LakehouseGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Lakehouse #{r['LakehouseId']} \"{r['Name']}\" → LakehouseGuid",
                'target': 'lakehouse',
                'params': {'lakehouseId': r['LakehouseId']},
                'field': 'newGuid',
            })
        if (r.get('WorkspaceGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Lakehouse #{r['LakehouseId']} \"{r['Name']}\" → WorkspaceGuid",
                'target': 'lakehouse',
                'params': {'lakehouseId': r['LakehouseId']},
                'field': 'newWorkspaceGuid',
            })

    # ── 3. DB Connections ──
    rows = query_sql('SELECT ConnectionId, ConnectionGuid, Name FROM integration.Connection')
    for r in rows:
        if (r.get('ConnectionGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Connection #{r['ConnectionId']} \"{r['Name']}\" → ConnectionGuid",
                'target': 'connection',
                'params': {'connectionId': r['ConnectionId']},
                'field': 'newGuid',
            })

    # ── 4. DB Pipelines ──
    rows = query_sql('SELECT PipelineId, PipelineGuid, WorkspaceGuid, Name FROM integration.Pipeline')
    for r in rows:
        if (r.get('PipelineGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Pipeline #{r['PipelineId']} \"{r['Name']}\" → PipelineGuid",
                'target': 'pipeline_db',
                'params': {'pipelineId': r['PipelineId']},
                'field': 'newGuid',
            })
        if (r.get('WorkspaceGuid') or '').lower() == guid_lower:
            refs.append({
                'location': f"Pipeline #{r['PipelineId']} \"{r['Name']}\" → WorkspaceGuid",
                'target': 'pipeline_db',
                'params': {'pipelineId': r['PipelineId']},
                'field': 'newWorkspaceGuid',
            })

    # ── 5. Pipeline JSON parameter defaults ──
    src_dir = _REPO_ROOT / 'src'
    for pdir in sorted(src_dir.glob('*.DataPipeline')):
        pfile = pdir / 'pipeline-content.json'
        if not pfile.is_file():
            continue
        try:
            with open(pfile, 'r', encoding='utf-8') as f:
                pdata = json.load(f)
            params = pdata.get('properties', {}).get('parameters', {})
            for pname, pval in params.items():
                default = pval.get('defaultValue', '')
                if isinstance(default, str) and default.lower() == guid_lower:
                    pipeline_name = pdir.name.replace('.DataPipeline', '')
                    refs.append({
                        'location': f"Pipeline JSON \"{pipeline_name}\" → param {pname}",
                        'target': 'pipeline_param',
                        'params': {'pipelineName': pipeline_name, 'paramName': pname},
                        'field': 'newValue',
                    })
        except Exception:
            pass

    # ── 6. Dashboard config.json ──
    cfg_path = Path(__file__).parent / 'config.json'
    if cfg_path.is_file():
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            for section, values in cfg.items():
                if isinstance(values, dict):
                    for key, val in values.items():
                        if isinstance(val, str) and val.lower() == guid_lower:
                            refs.append({
                                'location': f"Dashboard config → {section}.{key}",
                                'target': 'dashboard_config',
                                'params': {'section': section, 'key': key},
                                'field': 'newValue',
                            })
        except Exception:
            pass

    # ── 7. item_config.yaml (read-only — just flag it) ──
    yaml_path = _REPO_ROOT / 'config' / 'item_config.yaml'
    if yaml_path.is_file():
        try:
            yaml_data = _read_yaml(yaml_path)
            for section_name, section_data in yaml_data.items():
                if isinstance(section_data, dict):
                    for key, val in section_data.items():
                        if isinstance(val, str) and val.lower() == guid_lower:
                            refs.append({
                                'location': f"item_config.yaml → {section_name}.{key}",
                                'target': 'yaml_readonly',
                                'params': {},
                                'field': '',
                            })
        except Exception:
            pass

    return {'guid': guid, 'references': refs, 'count': len(refs)}


# ── Pipeline Deployment to Fabric ──

# Template → Real ID mappings (from deploy_pipelines.py)
# These map source/template GUIDs to actual deployed GUIDs per workspace
_DEPLOY_TEMPLATE_TO_REAL = {
    # CODE_DEV workspace
    "0bd63996-3a38-493b-825e-b6f26a04ae99": {
        "40e27fdc-775a-4ee2-84d5-48893c92d7cc": "1d947c6d-4350-48c5-8b98-9c21d8862fe7",
        "4b4840bc-5a9f-434e-8345-3f528d1f39bf": "37216369-bcf6-403d-bd61-831b895ee36a",
        "456ec477-b392-4576-8070-ad5cf1fd5a30": "631720ce-a9d3-4c98-943f-99a4b776550f",
        "740e290a-ea29-474f-a3d6-91768f5466ea": "16fdd640-4b73-41bc-8f31-70cedc100f3a",
        "bfe7a852-2306-4ea1-8605-0cd7473dadf8": "71ac3394-accc-44eb-b8df-2d02fc2b3777",
        "4972831f-6320-ab73-46e2-336d0bc59199": "f2f2b693-2692-453c-9c0c-2fb5285cc937",
        "bdb7c7d1-db6c-b117-483a-06fac2abc979": "2114cfd3-6e59-4950-a4a1-3cb359985b45",
        "d20eb24b-abeb-92d0-4c84-932ed3597147": "3269810b-9a33-41b9-bbfc-71e1bc585950",
        "a7f32c61-f86b-4484-b2e2-366d839bcb42": "2c54becd-5b1d-4ad7-ba90-f56bc6e44dbf",
        "2d7d2d52-be18-b5ea-4ccd-b7c0abb80439": "7da96b25-5027-48e4-a16e-2e39437a0ca2",
        "38f17b20-2d5a-8f67-4801-9c6bcb0f651b": "cdeca701-a720-4336-b93c-f1a242834ee7",
        "5c592df9-8582-4572-9e4e-d6166ef575df": "d8686569-8c8e-4544-b25a-1d7878b2ff5e",
        "a5918d08-0395-45ba-9c8c-f53d78b465eb": "6c008157-5441-4f95-a2a1-241e95156892",
        "36346796-f9dc-47b9-a248-c440a11c1aa0": "be7f5e16-3053-4c62-80a6-0bc3e29950ee",
        "28c5f888-0efc-4b60-b568-c82f47680680": "e06e964c-28e3-4cab-9bc0-27054f8c8007",
        "76f19233-94ef-a100-48dd-7f32bec279e3": "a6dfd4fe-6661-4aeb-a344-5fdd44e47a59",
        "e3793389-17ee-b401-4669-ef22ffe790e1": "8dab42f0-2b98-44b4-99f4-1871b22f823c",
        "4ee59a0f-ce5b-81d5-4477-eeac0e61c8a5": "a81c22a2-a7e1-4436-850e-3a3e76ff0c9a",
        "03e51795-feb0-b062-472f-81f44460c3b8": "044b65c9-2deb-40d6-8fb5-8fa4df7e9af8",
        "5d74cbab-2d1e-4b8a-a438-86cbab219dc9": "596bc924-1b23-4771-a11e-81e2c4b574f2",
        "693d01c3-999c-4022-9da6-a94134c7e57e": "a6563d8d-247d-4789-82c4-9dd42810eba1",
        "38f06ae6-bf9a-4f2c-a364-461c66b8f104": "c2be11ec-4294-4cd0-aa51-9cd984c7f01a",
        "1b6d7d0d-d04b-4bc2-a6da-7a876216561d": "ec06fc10-3328-4bec-b8b1-e3c6b5c02fff",
        "20cbc814-b94e-9c75-4cf3-c5bb3886877b": "e1fddeb4-84d3-47c3-8b1a-93913ae8b9fa",
        "bf2101e2-a101-b8df-43bf-5f6ba130a279": "a576b2cf-9c04-46f7-a069-fe8c0906b5ac",
        "a69cb3e2-52a1-abee-4335-29721d1d5828": "2006ff28-c4bb-4995-9913-6b251f0f5e0e",
    },
    # CODE_PROD workspace
    "1d1ae6c6-70a1-4f7e-849d-60820ea13646": {
        "40e27fdc-775a-4ee2-84d5-48893c92d7cc": "350f08db-936e-42d9-8d3e-70fdee0d3df8",
        "4b4840bc-5a9f-434e-8345-3f528d1f39bf": "a9f1bc85-c478-414a-989f-12658b9ab80d",
        "456ec477-b392-4576-8070-ad5cf1fd5a30": "b7dfe5e3-c1df-4f1d-a2fc-ee8d4cf406e2",
        "740e290a-ea29-474f-a3d6-91768f5466ea": "caf59496-344a-438c-938a-67728a8be871",
        "bfe7a852-2306-4ea1-8605-0cd7473dadf8": "355d6931-88e7-4978-94ab-e94b7fa170ec",
        "4972831f-6320-ab73-46e2-336d0bc59199": "13a9b6c1-761f-4d02-88d4-c1e2888f1ee8",
        "bdb7c7d1-db6c-b117-483a-06fac2abc979": "5c309197-3a85-4d12-a49c-962f41b347c4",
        "d20eb24b-abeb-92d0-4c84-932ed3597147": "441c35a5-3fbd-44ab-b42a-3f9f8685af2c",
        "a7f32c61-f86b-4484-b2e2-366d839bcb42": "c4de0075-e830-474c-b1de-de412ba2801c",
        "2d7d2d52-be18-b5ea-4ccd-b7c0abb80439": "bb6ff0b7-f099-4c8e-81b4-615e6a12c482",
        "38f17b20-2d5a-8f67-4801-9c6bcb0f651b": "ff6227de-3766-45bd-bed0-c5c7c5b33693",
        "5c592df9-8582-4572-9e4e-d6166ef575df": "29a7e1e9-7186-4505-ac38-a1252cebe733",
        "a5918d08-0395-45ba-9c8c-f53d78b465eb": "707abdba-52d3-4d8b-9a80-9888c47bbb2f",
        "36346796-f9dc-47b9-a248-c440a11c1aa0": "60482ef6-0887-41f6-9291-58b469af1a5e",
        "28c5f888-0efc-4b60-b568-c82f47680680": "ff8b9d11-8421-4143-9bfb-026045fadc24",
        "76f19233-94ef-a100-48dd-7f32bec279e3": "3812ffb2-aa54-42b8-bf20-bc74190def91",
        "e3793389-17ee-b401-4669-ef22ffe790e1": "73d2fd50-b0bd-4278-ab0c-6c3b4e3b98cc",
        "4ee59a0f-ce5b-81d5-4477-eeac0e61c8a5": "d7d1063e-8d9e-48f1-b705-2d343176274f",
        "03e51795-feb0-b062-472f-81f44460c3b8": "66ba6ea1-5c2a-48ce-a02c-64731598de9b",
        "5d74cbab-2d1e-4b8a-a438-86cbab219dc9": "048ce567-83f2-4815-b781-500cfda132dc",
        "693d01c3-999c-4022-9da6-a94134c7e57e": "5bb26855-97a2-4cae-a797-1e95463d3059",
        "38f06ae6-bf9a-4f2c-a364-461c66b8f104": "5835aa29-bdbf-4b2d-8473-4b414a77f34f",
        "1b6d7d0d-d04b-4bc2-a6da-7a876216561d": "2b752ca4-5aa8-4ed0-9831-e86c1b3ad37b",
        "20cbc814-b94e-9c75-4cf3-c5bb3886877b": "cd4361a9-dcd2-4079-8443-6509a773fea8",
        "bf2101e2-a101-b8df-43bf-5f6ba130a279": "17897811-5d9e-49e1-ab3d-2484977570f3",
        "a69cb3e2-52a1-abee-4335-29721d1d5828": "2c38dfb5-9052-4bb2-a4b3-62c7062d3f23",
    },
}

_DEPLOY_PIPELINE_IDS = {
    "0bd63996-3a38-493b-825e-b6f26a04ae99": {
        "PL_FMD_LDZ_COMMAND_ADF": "e06e964c-28e3-4cab-9bc0-27054f8c8007",
        "PL_FMD_LDZ_COMMAND_ADLS": "6c008157-5441-4f95-a2a1-241e95156892",
        "PL_FMD_LDZ_COMMAND_ASQL": "d8686569-8c8e-4544-b25a-1d7878b2ff5e",
        "PL_FMD_LDZ_COMMAND_FTP": "8dab42f0-2b98-44b4-99f4-1871b22f823c",
        "PL_FMD_LDZ_COMMAND_NOTEBOOK": "a81c22a2-a7e1-4436-850e-3a3e76ff0c9a",
        "PL_FMD_LDZ_COMMAND_ONELAKE": "be7f5e16-3053-4c62-80a6-0bc3e29950ee",
        "PL_FMD_LDZ_COMMAND_ORACLE": "044b65c9-2deb-40d6-8fb5-8fa4df7e9af8",
        "PL_FMD_LDZ_COMMAND_SFTP": "a6dfd4fe-6661-4aeb-a344-5fdd44e47a59",
        "PL_FMD_LDZ_COPY_FROM_ADF": "71ac3394-accc-44eb-b8df-2d02fc2b3777",
        "PL_FMD_LDZ_COPY_FROM_ADLS_01": "16fdd640-4b73-41bc-8f31-70cedc100f3a",
        "PL_FMD_LDZ_COPY_FROM_ASQL_01": "631720ce-a9d3-4c98-943f-99a4b776550f",
        "PL_FMD_LDZ_COPY_FROM_CUSTOM_NB": "cdeca701-a720-4336-b93c-f1a242834ee7",
        "PL_FMD_LDZ_COPY_FROM_FTP_01": "f2f2b693-2692-453c-9c0c-2fb5285cc937",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01": "3269810b-9a33-41b9-bbfc-71e1bc585950",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01": "2c54becd-5b1d-4ad7-ba90-f56bc6e44dbf",
        "PL_FMD_LDZ_COPY_FROM_ORACLE_01": "7da96b25-5027-48e4-a16e-2e39437a0ca2",
        "PL_FMD_LDZ_COPY_FROM_SFTP_01": "2114cfd3-6e59-4950-a4a1-3cb359985b45",
        "PL_FMD_LOAD_ALL": "ec06fc10-3328-4bec-b8b1-e3c6b5c02fff",
        "PL_FMD_LOAD_BRONZE": "596bc924-1b23-4771-a11e-81e2c4b574f2",
        "PL_FMD_LOAD_LANDINGZONE": "c2be11ec-4294-4cd0-aa51-9cd984c7f01a",
        "PL_FMD_LOAD_SILVER": "a6563d8d-247d-4789-82c4-9dd42810eba1",
        "PL_TOOLING_POST_ASQL_TO_FMD": "e1fddeb4-84d3-47c3-8b1a-93913ae8b9fa",
    },
    "1d1ae6c6-70a1-4f7e-849d-60820ea13646": {
        "PL_FMD_LDZ_COMMAND_ADF": "ff8b9d11-8421-4143-9bfb-026045fadc24",
        "PL_FMD_LDZ_COMMAND_ADLS": "707abdba-52d3-4d8b-9a80-9888c47bbb2f",
        "PL_FMD_LDZ_COMMAND_ASQL": "29a7e1e9-7186-4505-ac38-a1252cebe733",
        "PL_FMD_LDZ_COMMAND_FTP": "73d2fd50-b0bd-4278-ab0c-6c3b4e3b98cc",
        "PL_FMD_LDZ_COMMAND_NOTEBOOK": "d7d1063e-8d9e-48f1-b705-2d343176274f",
        "PL_FMD_LDZ_COMMAND_ONELAKE": "60482ef6-0887-41f6-9291-58b469af1a5e",
        "PL_FMD_LDZ_COMMAND_ORACLE": "66ba6ea1-5c2a-48ce-a02c-64731598de9b",
        "PL_FMD_LDZ_COMMAND_SFTP": "3812ffb2-aa54-42b8-bf20-bc74190def91",
        "PL_FMD_LDZ_COPY_FROM_ADF": "355d6931-88e7-4978-94ab-e94b7fa170ec",
        "PL_FMD_LDZ_COPY_FROM_ADLS_01": "caf59496-344a-438c-938a-67728a8be871",
        "PL_FMD_LDZ_COPY_FROM_ASQL_01": "b7dfe5e3-c1df-4f1d-a2fc-ee8d4cf406e2",
        "PL_FMD_LDZ_COPY_FROM_CUSTOM_NB": "ff6227de-3766-45bd-bed0-c5c7c5b33693",
        "PL_FMD_LDZ_COPY_FROM_FTP_01": "13a9b6c1-761f-4d02-88d4-c1e2888f1ee8",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01": "441c35a5-3fbd-44ab-b42a-3f9f8685af2c",
        "PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01": "c4de0075-e830-474c-b1de-de412ba2801c",
        "PL_FMD_LDZ_COPY_FROM_ORACLE_01": "bb6ff0b7-f099-4c8e-81b4-615e6a12c482",
        "PL_FMD_LDZ_COPY_FROM_SFTP_01": "5c309197-3a85-4d12-a49c-962f41b347c4",
        "PL_FMD_LOAD_ALL": "2b752ca4-5aa8-4ed0-9831-e86c1b3ad37b",
        "PL_FMD_LOAD_BRONZE": "048ce567-83f2-4815-b781-500cfda132dc",
        "PL_FMD_LOAD_LANDINGZONE": "5835aa29-bdbf-4b2d-8473-4b414a77f34f",
        "PL_FMD_LOAD_SILVER": "5bb26855-97a2-4cae-a797-1e95463d3059",
        "PL_TOOLING_POST_ASQL_TO_FMD": "cd4361a9-dcd2-4079-8443-6509a773fea8",
    },
}

_DEPLOY_WORKSPACE_LABELS = {
    "0bd63996-3a38-493b-825e-b6f26a04ae99": "CODE_DEV",
    "1d1ae6c6-70a1-4f7e-849d-60820ea13646": "CODE_PROD",
}

_DEPLOY_MISSING_CONNECTIONS = {
    "02e107b8-e97e-4b00-a28c-668cf9ce3d9a",  # CON_FMD_ADF_PIPELINES
    "5929775e-aff1-430c-b56e-f855d0bc63b8",  # CON_FMD_FABRIC_NOTEBOOKS
}


def _deploy_deactivate_missing(data: dict) -> int:
    """Set activities referencing missing connections to Inactive."""
    count = 0
    def walk(activities):
        nonlocal count
        for act in activities:
            content_str = json.dumps(act)
            if any(cid in content_str for cid in _DEPLOY_MISSING_CONNECTIONS):
                act['state'] = 'Inactive'
                act['onInactiveMarkAs'] = 'Succeeded'
                count += 1
            if act.get('type') == 'ForEach':
                walk(act.get('typeProperties', {}).get('activities', []))
    walk(data.get('properties', {}).get('activities', []))
    return count


def _deploy_prepare_json(pipeline_name: str, workspace_id: str) -> tuple:
    """Read source JSON, replace template IDs with real ones for target workspace."""
    src_path = _REPO_ROOT / 'src' / f'{pipeline_name}.DataPipeline' / 'pipeline-content.json'
    content = src_path.read_text(encoding='utf-8')

    id_map = _DEPLOY_TEMPLATE_TO_REAL[workspace_id]
    replacements = 0
    for template_id, real_id in id_map.items():
        n = content.count(template_id)
        if n > 0:
            content = content.replace(template_id, real_id)
            replacements += n

    data = json.loads(content)
    deactivated = _deploy_deactivate_missing(data)
    if deactivated > 0:
        content = json.dumps(data)

    return content, replacements, deactivated


def _deploy_single_pipeline(token: str, workspace_id: str, pipeline_id: str, content: str) -> tuple:
    """Deploy one pipeline definition via Fabric updateDefinition API."""
    import base64
    encoded = base64.b64encode(content.encode()).decode()
    payload = {
        'definition': {
            'parts': [{
                'path': 'pipeline-content.json',
                'payload': encoded,
                'payloadType': 'InlineBase64',
            }]
        }
    }
    url = f'https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{pipeline_id}/updateDefinition'
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return True, resp.status, ''
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return False, e.code, body
    except urllib.error.URLError as e:
        return False, 0, f'Connection error: {e.reason}'
    except Exception as e:
        return False, 0, f'Unexpected error: {str(e)}'


def deploy_pipelines_to_fabric(pipeline_names: list = None, workspaces: list = None) -> dict:
    """Deploy pipeline definitions from source JSON to Fabric.

    Args:
        pipeline_names: List of pipeline names to deploy, or None for all.
        workspaces: List of workspace IDs to deploy to, or None for both DEV + PROD.

    Returns dict with results per pipeline per workspace.
    """
    log.info('Pipeline deployment started'); sys.stdout.flush()
    try:
        token = get_fabric_token('https://api.fabric.microsoft.com/.default')
    except Exception as ex:
        log.error(f'Failed to acquire Fabric token: {ex}'); sys.stdout.flush()
        return {'success': False, 'deployed': 0, 'failed': 1, 'total': 1,
                'results': [{'workspace': 'N/A', 'pipeline': 'N/A', 'success': False, 'error': f'Token error: {ex}'}]}
    log.info('Fabric API token acquired'); sys.stdout.flush()

    target_workspaces = workspaces or list(_DEPLOY_PIPELINE_IDS.keys())
    results = []
    total_ok = 0
    total_fail = 0

    for ws_id in target_workspaces:
        if ws_id not in _DEPLOY_PIPELINE_IDS:
            results.append({'workspace': ws_id, 'error': f'Unknown workspace ID'})
            continue

        ws_label = _DEPLOY_WORKSPACE_LABELS.get(ws_id, ws_id)
        ws_pipelines = _DEPLOY_PIPELINE_IDS[ws_id]
        log.info(f'Deploying to {ws_label} ({len(ws_pipelines)} pipelines)'); sys.stdout.flush()

        # Filter to requested pipelines if specified
        names_to_deploy = pipeline_names or list(ws_pipelines.keys())

        for pl_name in sorted(names_to_deploy):
            pl_id = ws_pipelines.get(pl_name)
            if not pl_id:
                log.warning(f'  [SKIP] {pl_name} — not in {ws_label} mapping'); sys.stdout.flush()
                results.append({
                    'workspace': ws_label,
                    'pipeline': pl_name,
                    'success': False,
                    'error': f'Pipeline not found in {ws_label} workspace mapping',
                })
                total_fail += 1
                continue

            try:
                content, replacements, deactivated = _deploy_prepare_json(pl_name, ws_id)
                ok, status, err = _deploy_single_pipeline(token, ws_id, pl_id, content)

                deact_msg = f', {deactivated} deactivated' if deactivated else ''
                if ok:
                    log.info(f'  [OK]   {pl_name} ({replacements} IDs replaced{deact_msg})'); sys.stdout.flush()
                    results.append({
                        'workspace': ws_label,
                        'pipeline': pl_name,
                        'success': True,
                        'replacements': replacements,
                        'deactivated': deactivated,
                    })
                    total_ok += 1
                else:
                    err_msg = err[:200]
                    try:
                        err_data = json.loads(err)
                        err_msg = f"{err_data.get('errorCode', '')}: {err_data.get('message', err)[:200]}"
                    except Exception:
                        pass
                    log.error(f'  [FAIL] {pl_name} → HTTP {status}: {err_msg}'); sys.stdout.flush()
                    results.append({
                        'workspace': ws_label,
                        'pipeline': pl_name,
                        'success': False,
                        'httpStatus': status,
                        'error': err_msg,
                    })
                    total_fail += 1
            except FileNotFoundError:
                log.error(f'  [FAIL] {pl_name} — source JSON not found'); sys.stdout.flush()
                results.append({
                    'workspace': ws_label,
                    'pipeline': pl_name,
                    'success': False,
                    'error': f'Source JSON not found',
                })
                total_fail += 1
            except Exception as ex:
                results.append({
                    'workspace': ws_label,
                    'pipeline': pl_name,
                    'success': False,
                    'error': str(ex)[:200],
                })
                total_fail += 1

            # Small delay to avoid throttling
            time.sleep(0.3)

    log.info(f'Pipeline deployment complete: {total_ok} succeeded, {total_fail} failed')
    return {
        'success': total_fail == 0,
        'deployed': total_ok,
        'failed': total_fail,
        'total': total_ok + total_fail,
        'results': results,
    }


# ── Deployment Manager (SSE streaming + background thread) ──

_deploy_lock = threading.Lock()
_deploy_state = {
    'status': 'idle',          # idle | running | completed | failed | cancelled
    'phase': 0,
    'phase_name': '',
    'phases': [],              # [{num, name, status, items, elapsed}]
    'logs': [],                # [{ts, level, message}]
    'started_at': None,
    'completed_at': None,
    'config_used': {},
    'result': {},              # final workspace_ids, connection_ids etc.
    'cancel_requested': False,
}
_deploy_events = []            # list of SSE event dicts
_deploy_cond = threading.Condition()  # notifies SSE listeners
_deploy_thread = None


def _deploy_event(event_type: str, data: dict):
    """Push an SSE event to all listeners."""
    evt = {'event': event_type, 'data': data, 'id': len(_deploy_events)}
    with _deploy_cond:
        _deploy_events.append(evt)
        _deploy_cond.notify_all()


def _deploy_log(message: str, level: str = 'info'):
    """Add a log entry and push as SSE event."""
    entry = {'ts': time.time(), 'level': level, 'message': message}
    with _deploy_lock:
        _deploy_state['logs'].append(entry)
        if len(_deploy_state['logs']) > 2000:
            _deploy_state['logs'] = _deploy_state['logs'][-1000:]
    _deploy_event('log', entry)


class _CaptureStream:
    """Intercepts print() output from deploy phases and converts to structured events."""

    STATUS_TAGS = {
        '[CREATED]': 'created',
        '[EXISTS]': 'exists',
        '[OK]': 'ok',
        '[FAIL]': 'failed',
        '[SKIP]': 'skipped',
        '[WARN]': 'warning',
        '[DRY]': 'dry_run',
        '[MANUAL]': 'manual',
    }

    def __init__(self, original):
        self.original = original
        self._current_phase = 0

    def write(self, text):
        if self.original:
            self.original.write(text)
        if not text or text.isspace():
            return
        for line in text.split('\n'):
            stripped = line.strip()
            if not stripped:
                continue
            # Detect level
            level = 'info'
            if '[FAIL]' in stripped or '[ERROR]' in stripped:
                level = 'error'
            elif '[WARN]' in stripped:
                level = 'warning'
            # Check for status tags → item_status events
            for tag, status in self.STATUS_TAGS.items():
                if tag in stripped:
                    _deploy_event('item_status', {
                        'phase': self._current_phase,
                        'status': status,
                        'message': stripped,
                    })
                    break
            _deploy_log(stripped, level)

    def flush(self):
        if self.original:
            self.original.flush()

    def fileno(self):
        if self.original:
            return self.original.fileno()
        raise AttributeError('no fileno')

    def isatty(self):
        return False


def _run_deployment(config: dict):
    """Background thread: runs deploy_from_scratch phases."""
    global _deploy_state

    # Import the deploy script (force-reload so code changes are picked up)
    import importlib
    deploy_dir = Path(__file__).resolve().parent.parent.parent.parent
    sys.path.insert(0, str(deploy_dir))
    try:
        import deploy_from_scratch as dfs
        importlib.reload(dfs)
    except (ImportError, Exception) as e:
        _deploy_log(f'Failed to import deploy_from_scratch: {e}', 'error')
        with _deploy_lock:
            _deploy_state['status'] = 'failed'
        _deploy_event('deploy_complete', {'success': False, 'error': str(e)})
        return

    # Build synthetic args
    class Args:
        env = config.get('env', 'all')
        dry_run = config.get('dryRun', False)
        resume = config.get('resume', False)
        skip_phase = config.get('skipPhases', [])
        start_phase = config.get('startPhase', 1)
        capacity_id = config.get('capacityId', '')
        capacity_name = config.get('capacityName', '')

    args = Args()

    # Monkeypatch input() to prevent blocking on Phase 4 manual prompts
    manual_connections = config.get('manualConnections', {})

    def _fake_input(prompt=''):
        _deploy_log(f'[AUTO-INPUT] {prompt}', 'info')
        for conn_name, guid in manual_connections.items():
            if conn_name in prompt:
                _deploy_log(f'[AUTO-INPUT] Providing GUID: {guid}', 'info')
                return guid
        return ''  # skip by default

    import builtins
    original_input = builtins.input
    builtins.input = _fake_input

    # Capture stdout
    capture = _CaptureStream(sys.__stdout__)
    old_stdout = sys.stdout
    sys.stdout = capture

    # Initialize state
    if args.resume:
        state = dfs.load_state()
        completed = state.get('completed_phases', [])
        if completed:
            args.start_phase = max(completed) + 1
    else:
        state = {'completed_phases': [], 'mapping_table': [], 'workspace_ids': {},
                 'connection_ids': {}, 'lakehouse_ids': {}, 'sql_db': {}, 'item_ids': {}}

    # Pre-inject manual connection GUIDs into config yaml connections
    if manual_connections:
        yaml_conns = state.get('config', {}).get('yaml', {}).get('connections', {})
        for conn_name, guid in manual_connections.items():
            if guid and guid != '00000000-0000-0000-0000-000000000000':
                yaml_conns[conn_name] = guid

    start_time = time.time()
    with _deploy_lock:
        _deploy_state['started_at'] = start_time
        _deploy_state['phases'] = [
            {'num': num, 'name': name, 'status': 'pending', 'items': [], 'elapsed': 0}
            for num, name, _ in dfs.PHASES
        ]

    for phase_num, phase_name, phase_fn in dfs.PHASES:
        # Check cancel
        with _deploy_lock:
            if _deploy_state['cancel_requested']:
                _deploy_state['status'] = 'cancelled'
                _deploy_log('Deployment cancelled by user.', 'warning')
                _deploy_event('deploy_complete', {'success': False, 'cancelled': True})
                break

        if phase_num < args.start_phase:
            continue
        if phase_num in args.skip_phase:
            _deploy_log(f'[SKIP] Phase {phase_num}: {phase_name}')
            _deploy_event('phase_skip', {'phase': phase_num, 'name': phase_name})
            with _deploy_lock:
                for p in _deploy_state['phases']:
                    if p['num'] == phase_num:
                        p['status'] = 'skipped'
            continue

        # Start phase
        capture._current_phase = phase_num
        with _deploy_lock:
            _deploy_state['phase'] = phase_num
            _deploy_state['phase_name'] = phase_name
            for p in _deploy_state['phases']:
                if p['num'] == phase_num:
                    p['status'] = 'running'
        _deploy_event('phase_start', {'phase': phase_num, 'name': phase_name})
        phase_start = time.time()

        try:
            phase_fn(state, args)
            elapsed = time.time() - phase_start
            state['completed_phases'].append(phase_num)
            if not args.dry_run:
                dfs.save_state(state)
            with _deploy_lock:
                for p in _deploy_state['phases']:
                    if p['num'] == phase_num:
                        p['status'] = 'completed'
                        p['elapsed'] = round(elapsed, 1)
            _deploy_event('phase_complete', {
                'phase': phase_num, 'name': phase_name, 'elapsed': round(elapsed, 1),
            })
        except SystemExit as e:
            elapsed = time.time() - phase_start
            _deploy_log(f'Phase {phase_num} called sys.exit({e.code})', 'error')
            with _deploy_lock:
                for p in _deploy_state['phases']:
                    if p['num'] == phase_num:
                        p['status'] = 'failed'
                        p['elapsed'] = round(elapsed, 1)
            _deploy_event('phase_failed', {
                'phase': phase_num, 'name': phase_name,
                'error': f'sys.exit({e.code})', 'elapsed': round(elapsed, 1),
            })
            dfs.save_state(state)
        except Exception as e:
            elapsed = time.time() - phase_start
            _deploy_log(f'Phase {phase_num} error: {e}', 'error')
            with _deploy_lock:
                for p in _deploy_state['phases']:
                    if p['num'] == phase_num:
                        p['status'] = 'failed'
                        p['elapsed'] = round(elapsed, 1)
            _deploy_event('phase_failed', {
                'phase': phase_num, 'name': phase_name,
                'error': str(e), 'elapsed': round(elapsed, 1),
            })
            dfs.save_state(state)

    # Restore stdout and input
    sys.stdout = old_stdout
    builtins.input = original_input

    total_elapsed = time.time() - start_time
    with _deploy_lock:
        if _deploy_state['status'] != 'cancelled':
            failed = any(p['status'] == 'failed' for p in _deploy_state['phases'])
            _deploy_state['status'] = 'failed' if failed else 'completed'
        _deploy_state['completed_at'] = time.time()
        _deploy_state['result'] = {
            'workspace_ids': state.get('workspace_ids', {}),
            'connection_ids': state.get('connection_ids', {}),
            'lakehouse_ids': state.get('lakehouse_ids', {}),
            'sql_db': state.get('sql_db', {}),
            'item_count': len(state.get('item_ids', {})),
            'mapping_count': len(state.get('mapping_table', [])),
            'elapsed': round(total_elapsed, 1),
        }

    _deploy_event('deploy_complete', {
        'success': _deploy_state['status'] == 'completed',
        'elapsed': round(total_elapsed, 1),
        'result': _deploy_state['result'],
    })


def start_deployment(config: dict) -> dict:
    """Start a deployment in a background thread. Returns immediately."""
    global _deploy_thread, _deploy_state, _deploy_events

    with _deploy_lock:
        if _deploy_state['status'] == 'running':
            return {'ok': False, 'error': 'Deployment already running'}

        # Reset state
        _deploy_state = {
            'status': 'running',
            'phase': 0,
            'phase_name': '',
            'phases': [],
            'logs': [],
            'started_at': None,
            'completed_at': None,
            'config_used': config,
            'result': {},
            'cancel_requested': False,
        }

    with _deploy_cond:
        _deploy_events.clear()

    _deploy_thread = threading.Thread(target=_run_deployment, args=(config,), daemon=True)
    _deploy_thread.start()

    return {'ok': True, 'message': 'Deployment started'}


def get_deploy_state() -> dict:
    """Return current deployment state."""
    with _deploy_lock:
        return dict(_deploy_state)


def cancel_deployment() -> dict:
    """Request cancellation of running deployment."""
    with _deploy_lock:
        if _deploy_state['status'] != 'running':
            return {'ok': False, 'error': 'No deployment running'}
        _deploy_state['cancel_requested'] = True
    return {'ok': True, 'message': 'Cancel requested — deployment will stop after current phase'}


# ── HTTP Handler ──

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True

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

    def _sse_pipeline_stream(self, workspace_guid: str, pipeline_guid: str,
                               job_instance_id: str, pipeline_name: str = ''):
        """Stream pipeline run events via Server-Sent Events."""
        poller = get_or_create_run_poller(workspace_guid, pipeline_guid,
                                          job_instance_id, pipeline_name)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self._cors()
        self.end_headers()

        cursor = 0
        try:
            # Replay existing events for late joiners
            with poller.cond:
                for evt in poller.events[cursor:]:
                    line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                    self.wfile.write(line.encode())
                cursor = len(poller.events)
            self.wfile.flush()

            # Stream new events
            while True:
                with poller.cond:
                    while cursor >= len(poller.events):
                        poller.cond.wait(timeout=15)
                        if cursor >= len(poller.events):
                            try:
                                self.wfile.write(b": keepalive\n\n")
                                self.wfile.flush()
                            except (BrokenPipeError, ConnectionResetError):
                                return
                    new_events = poller.events[cursor:]
                    cursor = len(poller.events)

                for evt in new_events:
                    line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                    self.wfile.write(line.encode())
                self.wfile.flush()

                # Stop streaming on terminal event
                if any(e['event'] in ('final', 'error') for e in new_events):
                    break
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _sse_deploy_stream(self):
        """Stream deployment events via Server-Sent Events."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self._cors()
        self.end_headers()

        cursor = 0  # track position in _deploy_events
        try:
            # Send any existing events first (replay for late joiners)
            with _deploy_cond:
                for evt in _deploy_events[cursor:]:
                    line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                    self.wfile.write(line.encode())
                cursor = len(_deploy_events)
            self.wfile.flush()

            # Stream new events as they arrive
            while True:
                with _deploy_cond:
                    while cursor >= len(_deploy_events):
                        # Wait for new events (timeout every 15s to send keepalive)
                        _deploy_cond.wait(timeout=15)
                        if cursor >= len(_deploy_events):
                            # Send keepalive comment
                            try:
                                self.wfile.write(b": keepalive\n\n")
                                self.wfile.flush()
                            except (BrokenPipeError, ConnectionResetError):
                                return
                    new_events = _deploy_events[cursor:]
                    cursor = len(_deploy_events)

                for evt in new_events:
                    line = f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\nid: {evt['id']}\n\n"
                    self.wfile.write(line.encode())
                self.wfile.flush()

                # Check if deploy is done
                if any(e['event'] == 'deploy_complete' for e in new_events):
                    break

        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # Client disconnected

    def do_GET(self):
        log.info(f'GET {self.path}')
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
            elif self.path == '/api/error-intelligence':
                self._json_response(get_error_intelligence())
            elif self.path == '/api/fabric-jobs':
                self._json_response(get_fabric_job_instances())
            # ── Pipeline Runner GET endpoints ──
            elif self.path == '/api/runner/sources':
                self._json_response(runner_get_sources())
            elif self.path.startswith('/api/runner/entities'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ds_id = int(qs.get('dataSourceId', ['0'])[0])
                if not ds_id:
                    self._error_response('dataSourceId is required', 400)
                else:
                    self._json_response(runner_get_entities(ds_id))
            elif self.path == '/api/runner/state':
                self._json_response(runner_get_state())
            elif self.path.startswith('/api/pipeline-activity-runs'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceGuid', [''])[0]
                job_id = qs.get('jobInstanceId', [''])[0]
                if not ws or not job_id:
                    self._error_response('workspaceGuid and jobInstanceId are required', 400)
                else:
                    self._json_response(get_pipeline_activity_runs(ws, job_id))
            elif self.path == '/api/live-monitor':
                self._json_response(get_live_monitor())
            elif self.path == '/api/copy-executions':
                self._json_response(get_copy_executions())
            elif self.path == '/api/notebook-executions':
                self._json_response(get_notebook_executions())
            elif self.path == '/api/schema':
                self._json_response(get_schema_info())
            elif self.path.startswith('/api/entity-digest'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                source = qs.get('source', [None])[0]
                layer = qs.get('layer', [None])[0]
                status = qs.get('status', [None])[0]
                self._json_response(build_entity_digest(source, layer, status))
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
            # Config Manager
            elif self.path == '/api/config-manager':
                self._json_response(get_config_manager())
            elif self.path == '/api/notebook-config':
                self._json_response(get_notebook_config())
            elif self.path.startswith('/api/config-manager/references?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                guid_val = qs.get('guid', [''])[0]
                if not guid_val:
                    self._error_response('guid parameter is required', 400)
                else:
                    self._json_response(find_guid_references(guid_val))
            # List all Fabric workspaces (for dropdowns)
            elif self.path == '/api/fabric/workspaces':
                try:
                    data = _fabric_api_get('workspaces')
                    items = [{'id': w['id'], 'displayName': w.get('displayName', '')}
                             for w in data.get('value', [])]
                    items.sort(key=lambda x: x['displayName'].lower())
                    self._json_response({'workspaces': items})
                except Exception as ex:
                    self._json_response({'workspaces': [], 'error': str(ex)})
            # List all Fabric connections (for dropdowns)
            elif self.path == '/api/fabric/connections':
                try:
                    token = get_fabric_token('https://api.fabric.microsoft.com/.default')
                    url = 'https://api.fabric.microsoft.com/v1/connections'
                    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
                    resp = urllib.request.urlopen(req, timeout=30)
                    all_c = json.loads(resp.read()).get('value', [])
                    items = [{'id': c['id'],
                              'displayName': c.get('displayName', ''),
                              'type': c.get('connectionDetails', {}).get('type', '')}
                             for c in all_c]
                    items.sort(key=lambda x: x['displayName'].lower())
                    self._json_response({'connections': items})
                except Exception as ex:
                    self._json_response({'connections': [], 'error': str(ex)})
            # List Azure AD security groups (for admin group dropdown)
            elif self.path == '/api/fabric/security-groups':
                try:
                    token = get_fabric_token('https://graph.microsoft.com/.default')
                    # List security-enabled groups, filter to security groups (not M365/distribution)
                    url = "https://graph.microsoft.com/v1.0/groups?$filter=securityEnabled eq true&$select=id,displayName,description&$top=200&$orderby=displayName"
                    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
                    resp = urllib.request.urlopen(req, timeout=30)
                    all_groups = json.loads(resp.read()).get('value', [])
                    items = [{'id': g['id'],
                              'displayName': g.get('displayName', ''),
                              'description': g.get('description', '')}
                             for g in all_groups]
                    self._json_response({'groups': items})
                except Exception as ex:
                    self._json_response({'groups': [], 'error': str(ex)})
            # Resolve a workspace GUID to its Fabric display name
            elif self.path.startswith('/api/fabric/resolve-workspace?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws_id = qs.get('id', [''])[0]
                if not ws_id:
                    self._error_response('id parameter is required', 400)
                else:
                    name = _resolve_workspace_name(ws_id)
                    if name:
                        self._json_response({'id': ws_id, 'displayName': name})
                    else:
                        self._json_response({'id': ws_id, 'displayName': None, 'error': 'Workspace not found'})
            # Notebook job status polling
            elif self.path.startswith('/api/notebook/job-status?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceId', [''])[0]
                nb = qs.get('notebookId', [''])[0]
                if not ws or not nb:
                    self._error_response('workspaceId and notebookId are required', 400)
                else:
                    self._json_response(get_notebook_job_status(ws, nb))
            # Notebook Debug Runner
            elif self.path == '/api/notebook-debug/notebooks':
                self._json_response(notebook_debug_list())
            elif self.path.startswith('/api/notebook-debug/entities'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                layer = qs.get('layer', ['bronze'])[0]
                self._json_response(notebook_debug_get_entities(layer))
            elif self.path.startswith('/api/notebook-debug/job-status?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                job_id = qs.get('jobId', [''])[0]
                nb_id = qs.get('notebookId', [''])[0]
                if job_id and nb_id:
                    self._json_response(notebook_debug_job_status(job_id, nb_id))
                elif job_id:
                    self._json_response(notebook_debug_job_status(job_id))
                elif nb_id:
                    code_ws = CONFIG['fabric'].get('workspace_code_id', '')
                    self._json_response(get_notebook_job_status(code_ws, nb_id))
                else:
                    self._error_response('jobId or notebookId required', 400)
            # Diagnostic: list stored procedures
            elif self.path == '/api/diag/stored-procs':
                try:
                    rows = query_sql("SELECT s.name as [schema], p.name as [proc] FROM sys.procedures p JOIN sys.schemas s ON p.schema_id = s.schema_id ORDER BY s.name, p.name")
                    self._json_response({'procs': rows or []})
                except Exception as ex:
                    self._json_response({'error': str(ex)})
            # Deploy pre-flight check
            elif self.path == '/api/deploy/preflight':
                self._json_response(deploy_preflight())
            # Deployment status (notebook running + auto-discover new env)
            elif self.path == '/api/deployment/status':
                self._json_response(get_deployment_status())
            # Pipeline run snapshot (REST, for initial load / non-SSE clients)
            elif self.path.startswith('/api/pipeline/run-snapshot?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceGuid', [''])[0]
                pg = qs.get('pipelineGuid', [''])[0]
                ji = qs.get('jobInstanceId', [''])[0]
                pn = qs.get('pipelineName', [''])[0]
                if not ws or not pg or not ji:
                    self._error_response('workspaceGuid, pipelineGuid, and jobInstanceId required', 400)
                else:
                    poller = get_or_create_run_poller(ws, pg, ji, pn)
                    # Return latest snapshot event or empty
                    snapshots = [e['data'] for e in poller.events if e['event'] in ('snapshot', 'final')]
                    self._json_response(snapshots[-1] if snapshots else {'status': 'Initializing', 'runId': ji})
            # Pipeline failure trace — recursively finds the root cause in nested pipelines
            elif self.path.startswith('/api/pipeline/failure-trace?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceGuid', [''])[0]
                ji = qs.get('jobInstanceId', [''])[0]
                pn = qs.get('pipelineName', [''])[0]
                if not ws or not ji:
                    self._error_response('workspaceGuid and jobInstanceId required', 400)
                else:
                    result = trace_pipeline_failure(ws, ji, pn)
                    self._json_response(result)
            # Pipeline run live monitor (SSE)
            elif self.path.startswith('/api/pipeline/stream?'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ws = qs.get('workspaceGuid', [''])[0]
                pg = qs.get('pipelineGuid', [''])[0]
                ji = qs.get('jobInstanceId', [''])[0]
                pn = qs.get('pipelineName', [''])[0]
                if not ws or not pg or not ji:
                    self._error_response('workspaceGuid, pipelineGuid, and jobInstanceId required', 400)
                else:
                    self._sse_pipeline_stream(ws, pg, ji, pn)
                return  # SSE handler manages its own response lifecycle
            # Deployment Manager endpoints
            elif self.path == '/api/deploy/stream':
                self._sse_deploy_stream()
                return  # SSE handler manages its own response lifecycle
            elif self.path == '/api/deploy/state':
                self._json_response(get_deploy_state())
            # Load Optimization Engine endpoints
            elif self.path.startswith('/api/analyze-source'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ds_id = qs.get('datasource', [''])[0]
                if not ds_id or not ds_id.isdigit():
                    self._error_response('datasource param required (DataSourceId)', 400)
                else:
                    username = qs.get('username', [''])[0]
                    password = qs.get('password', [''])[0]
                    self._json_response(analyze_source_tables(int(ds_id), username, password))
            elif self.path.startswith('/api/load-config'):
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                ds_id = qs.get('datasource', [''])[0]
                self._json_response(get_load_config(int(ds_id) if ds_id and ds_id.isdigit() else None))
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
            elif self.path == '/api/config-manager/update':
                self._json_response(update_config_value(body))
            elif self.path == '/api/notebook-config/update':
                self._json_response(update_notebook_config(body))
            elif self.path == '/api/deploy-pipelines':
                names = body.get('pipelines')  # None = all
                workspaces = body.get('workspaces')  # None = both DEV+PROD
                self._json_response(deploy_pipelines_to_fabric(names, workspaces))
            elif self.path == '/api/pipeline/trigger':
                pipeline_name = body.get('pipelineName', '').strip()
                if not pipeline_name:
                    self._error_response('pipelineName is required', 400)
                else:
                    self._json_response(trigger_pipeline(pipeline_name))
            # ── Pipeline Runner endpoints ──
            elif self.path == '/api/runner/prepare':
                ds_ids = body.get('dataSourceIds', [])
                entity_ids = body.get('entityIds')  # optional
                layer = body.get('layer', 'full')
                if not ds_ids:
                    self._error_response('dataSourceIds is required', 400)
                else:
                    self._json_response(runner_prepare_scope(ds_ids, entity_ids, layer))
            elif self.path == '/api/runner/trigger':
                pipeline_name = body.get('pipelineName', '').strip()
                if not pipeline_name:
                    self._error_response('pipelineName is required', 400)
                else:
                    self._json_response(runner_trigger(pipeline_name))
            elif self.path == '/api/runner/restore':
                self._json_response(runner_restore())
            # Notebook Debug Runner
            elif self.path == '/api/notebook-debug/run':
                self._json_response(notebook_debug_run(body))
            # One-click notebook deploy
            elif self.path == '/api/notebook/trigger':
                self._json_response(trigger_setup_notebook())
            # Full wipe + deploy
            elif self.path == '/api/deploy/wipe-and-trigger':
                self._json_response(deploy_wipe_and_trigger())
            elif self.path == '/api/deployment/apply-config':
                self._json_response(apply_new_deployment_config(body))
            # Load Optimization Engine endpoints
            elif self.path == '/api/register-bronze-silver':
                ds_id = body.get('datasourceId')
                if not ds_id:
                    self._error_response('datasourceId is required', 400)
                else:
                    entities = body.get('entities')  # None = all
                    username = body.get('username', '')
                    password = body.get('password', '')
                    self._json_response(register_bronze_silver(int(ds_id), entities, username, password))
            elif self.path == '/api/load-config':
                updates = body.get('updates', [])
                if not updates:
                    self._error_response('updates array is required', 400)
                else:
                    self._json_response(update_load_config(updates))
            # Deployment Manager endpoints
            elif self.path == '/api/deploy/start':
                self._json_response(start_deployment(body))
            elif self.path == '/api/deploy/cancel':
                self._json_response(cancel_deployment())
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
    log.info('  GET  /api/entity-digest      (Digest Engine — stored proc)')
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
    log.info('  POST /api/deploy/start')
    log.info('  GET  /api/deploy/stream      (SSE)')
    log.info('  GET  /api/deploy/state')
    log.info('  POST /api/deploy/cancel')
    log.info('  GET  /api/analyze-source     (Load Optimization)')
    log.info('  GET  /api/load-config')
    log.info('  POST /api/register-bronze-silver')
    log.info('  POST /api/load-config        (update)')
    log.info(f'  Snapshot:   {CONTROL_PLANE_SNAPSHOT}')
    if mode == 'production':
        log.info('')
        log.info('  /*   → Static files from dist/')
    log.info('=' * 60)

    # Auto-create dashboard-only tables if they don't exist
    ensure_onboarding_table()

    server = ThreadedHTTPServer((HOST, PORT), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info('Shutting down.')
        server.server_close()
