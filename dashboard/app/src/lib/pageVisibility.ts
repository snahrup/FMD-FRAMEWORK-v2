// ============================================================================
// Page Visibility — server-persisted admin control over sidebar nav items
// ============================================================================

const API = "/api";

let _cache: string[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000; // 30s

export async function getHiddenPages(): Promise<string[]> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  try {
    const res = await fetch(`${API}/admin/config`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    _cache = data.hiddenPages ?? [];
    _cacheTime = Date.now();
    return _cache;
  } catch {
    return _cache ?? [];
  }
}

export async function updateHiddenPages(pages: string[], password: string): Promise<void> {
  const res = await fetch(`${API}/admin/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hiddenPages: pages, password }),
  });
  if (!res.ok) {
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
    return data.ok === true;
  } catch {
    return false;
  }
}
