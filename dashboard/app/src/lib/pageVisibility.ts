// ============================================================================
// Page Visibility — server-persisted admin control over sidebar nav items
// ============================================================================

const API = "/api";
const ADMIN_SESSION_KEY = "fmd-admin-session";

let _cache: string[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30s

type AdminSession = {
  token: string;
  expiresAt: number;
};

function readAdminSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || !parsed.expiresAt) return null;
    if (Date.now() >= parsed.expiresAt * 1000) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeAdminSession(session: AdminSession): void {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function hasAdminSession(): boolean {
  return readAdminSession() !== null;
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function getHiddenPages(): Promise<string[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  try {
    const res = await fetch(`${API}/admin/config`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    _cache = data.hiddenPages ?? [];
    _cacheTime = Date.now();
    return _cache!;
  } catch {
    return _cache ?? [];
  }
}

export async function updateHiddenPages(pages: string[], password?: string): Promise<void> {
  const session = readAdminSession();
  const authPayload = session
    ? { session_token: session.token }
    : password
      ? { password }
      : {};
  const res = await fetch(`${API}/admin/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hiddenPages: pages, ...authPayload }),
  });
  if (!res.ok) {
    if (res.status === 403) {
      clearAdminSession();
    }
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status}`);
  }
  _cache = pages;
  _cacheTime = Date.now();
  window.dispatchEvent(new CustomEvent("fmd-page-visibility-changed", { detail: pages }));
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/admin/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.ok === true && data.sessionToken && data.expiresAt) {
      writeAdminSession({ token: data.sessionToken, expiresAt: data.expiresAt });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
