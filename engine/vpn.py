"""
FMD v3 Engine — VPN connectivity manager.

Detects when the corporate VPN (WatchGuard Mobile VPN with SSL) is down
and auto-connects so the engine doesn't burn hours retrying dead connections.

Flow:
  1. Ping a known source server (fast TCP check on port 1433)
  2. If unreachable, launch WatchGuard client with saved credentials
  3. Wait for connectivity (user taps 2FA on phone)
  4. Return True when VPN is up, False if timeout exceeded

Password is read from:
  1. Environment variable FMD_VPN_PASSWORD
  2. Or file at ~/.fmd_vpn_cred (single line, the password)
"""

import ctypes
import logging
import os
import socket
import subprocess
import time
from pathlib import Path

log = logging.getLogger("fmd.vpn")

# WatchGuard client path
_WGSSLVPN = r"C:\Program Files (x86)\WatchGuard\WatchGuard Mobile VPN with SSL\wgsslvpnc.exe"

# Source servers to probe (any one reachable = VPN is up)
_PROBE_TARGETS = [
    ("m3-db1", 1433),
    ("M3-DB3", 1433),
    ("sqllogshipprd", 1433),
    ("sql2016live", 1433),
]


def is_vpn_up(timeout_seconds: float = 3.0) -> bool:
    """Quick TCP probe — returns True if ANY source server is reachable."""
    for host, port in _PROBE_TARGETS:
        try:
            sock = socket.create_connection((host, port), timeout=timeout_seconds)
            sock.close()
            log.debug("VPN probe: %s:%d reachable", host, port)
            return True
        except (OSError, socket.timeout):
            continue
    log.warning("VPN probe: all %d servers unreachable", len(_PROBE_TARGETS))
    return False


def _get_vpn_password() -> str | None:
    """Read VPN password from env var or credential file."""
    # 1. Environment variable
    pwd = os.environ.get("FMD_VPN_PASSWORD")
    if pwd:
        return pwd

    # 2. Credential file
    cred_file = Path.home() / ".fmd_vpn_cred"
    if cred_file.exists():
        pwd = cred_file.read_text(encoding="utf-8").strip()
        if pwd:
            return pwd

    return None


def _is_vpn_client_running() -> bool:
    """Check if wgsslvpnc.exe is already running."""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq wgsslvpnc.exe"],
            capture_output=True, text=True, timeout=5,
        )
        return "wgsslvpnc.exe" in result.stdout
    except Exception:
        return False


def _launch_vpn_client() -> bool:
    """Launch the WatchGuard client GUI."""
    if not Path(_WGSSLVPN).exists():
        log.error("WatchGuard client not found at %s", _WGSSLVPN)
        return False

    if _is_vpn_client_running():
        log.info("WatchGuard client already running — bringing to foreground")
        # Bring existing window to front
        _bring_vpn_to_front()
        return True

    log.info("Launching WatchGuard VPN client...")
    try:
        subprocess.Popen([_WGSSLVPN], shell=False)
        time.sleep(2)  # Give it time to load
        return True
    except Exception as exc:
        log.error("Failed to launch VPN client: %s", exc)
        return False


def _bring_vpn_to_front():
    """Bring the WatchGuard window to the foreground using PowerShell."""
    try:
        subprocess.run(
            [
                "powershell.exe", "-Command",
                '(New-Object -ComObject WScript.Shell).AppActivate("WatchGuard")',
            ],
            capture_output=True, timeout=5,
        )
    except Exception:
        log.debug("Could not focus WatchGuard window — may not be open")


def _auto_fill_password(password: str) -> bool:
    """Auto-fill the password in the WatchGuard login window via PowerShell SendKeys.

    WatchGuard SSL VPN client has: Server dropdown, Username field, Password field, Connect button.
    Username is already saved (registry RememberMe=2). We just need to:
      1. Focus the password field
      2. Type the password
      3. Press Enter (or click Connect)
    """
    log.info("Attempting to auto-fill VPN password...")
    time.sleep(1)  # Wait for window to be ready

    # PowerShell script to:
    # 1. Activate the WatchGuard window
    # 2. Tab to password field (it's the 3rd field: server, username, password)
    # 3. Send the password
    # 4. Press Enter to connect
    #
    # NOTE: SendKeys is fragile — if the window layout changes, this breaks.
    # But it works for the current WatchGuard SSL VPN client version.
    ps_script = f'''
$wshell = New-Object -ComObject WScript.Shell
$activated = $wshell.AppActivate("WatchGuard Mobile VPN")
if (-not $activated) {{
    Start-Sleep -Milliseconds 500
    $activated = $wshell.AppActivate("WatchGuard")
}}
if ($activated) {{
    Start-Sleep -Milliseconds 300
    # Click into password field — Tab twice from username
    $wshell.SendKeys("{{TAB}}{{TAB}}")
    Start-Sleep -Milliseconds 200
    # Clear any existing password
    $wshell.SendKeys("^a")
    Start-Sleep -Milliseconds 100
    # Type the password
    $wshell.SendKeys("{password}")
    Start-Sleep -Milliseconds 200
    # Press Enter to connect
    $wshell.SendKeys("{{ENTER}}")
    Write-Output "OK"
}} else {{
    Write-Output "FAIL: Could not activate WatchGuard window"
}}
'''
    try:
        result = subprocess.run(
            ["powershell.exe", "-Command", ps_script],
            capture_output=True, text=True, timeout=10,
        )
        if "OK" in result.stdout:
            log.info("Password auto-filled, waiting for 2FA approval...")
            return True
        else:
            log.warning("Could not activate VPN window: %s", result.stdout.strip())
            return False
    except Exception as exc:
        log.error("Password auto-fill failed: %s", exc)
        return False


def ensure_vpn(
    timeout_seconds: float = 120.0,
    auto_fill: bool = True,
    poll_interval: float = 3.0,
) -> bool:
    """Ensure VPN is connected. Auto-launch + auto-fill if needed.

    Args:
        timeout_seconds: Max seconds to wait for VPN to come up (default 2 min).
        auto_fill: If True, attempt to auto-fill the password.
        poll_interval: Seconds between connectivity checks.

    Returns:
        True if VPN is up (already was, or successfully connected).
        False if timeout exceeded.
    """
    # Already connected?
    if is_vpn_up():
        log.info("VPN already connected")
        return True

    log.warning("VPN is DOWN — attempting auto-connect...")

    # Launch the client
    if not _launch_vpn_client():
        log.error("Could not launch VPN client")
        return False

    # Auto-fill password if we have it
    password = _get_vpn_password()
    if auto_fill and password:
        _auto_fill_password(password)
    elif not password:
        log.info(
            "No VPN password found. Set FMD_VPN_PASSWORD env var or create ~/.fmd_vpn_cred file. "
            "Waiting for manual login..."
        )

    # Poll until VPN comes up or timeout
    deadline = time.time() + timeout_seconds
    attempt = 0
    while time.time() < deadline:
        time.sleep(poll_interval)
        attempt += 1
        if is_vpn_up():
            log.info("VPN connected after %d checks (%.0fs)", attempt, attempt * poll_interval)
            return True
        if attempt % 10 == 0:
            remaining = deadline - time.time()
            log.info("Still waiting for VPN... (%.0fs remaining)", remaining)

    log.error("VPN connection timed out after %.0fs", timeout_seconds)
    return False
