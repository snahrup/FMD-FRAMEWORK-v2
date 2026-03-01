import os
import urllib.request
import urllib.parse
import json
import struct
import sys
import itertools

# ---- Auth ----
TENANT_ID  = "ca81e9fd-06dd-49cf-b5a9-ee7441ff5303"
CLIENT_ID  = "ac937c5d-4bdd-438f-be8b-84a850021d2d"
CLIENT_SECRET = os.environ.get("FABRIC_CLIENT_SECRET", "")
SQL_SERVER = "7xuydsw5a3hutnnj5z2ed72tam-mhwnfrrtsrmuhgfc2b5tety7li.database.fabric.microsoft.com"
SQL_PORT   = 1433
DATABASE   = "SQL_INTEGRATION_FRAMEWORK-027d772b-cfc0-472f-a3a6-fafd3f584f4f"

SCOPE = "https://database.windows.net/.default"

def get_token():
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": SCOPE,
    }).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
    return body["access_token"]

# ---- TDS helpers (minimal, enough for simple queries) ----
import socket
import ssl
import hashlib
import hmac

def build_prelogin():
    # PRELOGIN packet
    version_offset = 6 + 1  # 1 option + terminator
    version_data = b'\x10\x00\x00\x00' + b'\x00' + b'\x00'  # version 16.0.0.0 subbuild 0
    option_version = struct.pack('>BHH', 0x00, version_offset, len(version_data))
    terminator = b'\xff'
    token_data = option_version + terminator + version_data
    return token_data

def build_tds_packet(packet_type, data, last=True):
    status = 0x01 if last else 0x00
    length = 8 + len(data)
    header = struct.pack('>BBHHBB', packet_type, status, length, 0, 1, 0)
    return header + data

def read_tds_packet(sock):
    header = b''
    while len(header) < 8:
        chunk = sock.recv(8 - len(header))
        if not chunk:
            raise ConnectionError("Connection closed")
        header += chunk
    ptype, status, length, spid, packet_id, window = struct.unpack('>BBHHBB', header)
    remaining = length - 8
    data = b''
    while len(data) < remaining:
        chunk = sock.recv(remaining - len(data))
        if not chunk:
            raise ConnectionError("Connection closed reading data")
        data += chunk
    return ptype, status, data

def read_all_tds_response(sock):
    """Read all packets until EOM (status bit 0x01)"""
    all_data = b''
    while True:
        ptype, status, data = read_tds_packet(sock)
        all_data += data
        if status & 0x01:
            break
    return all_data

print("This approach with raw TDS is too complex. Let me use pyodbc instead.")
sys.exit(1)
