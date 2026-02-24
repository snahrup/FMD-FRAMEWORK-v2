// ============================================================================
// Feature Flags — localStorage-persisted toggles for experimental features
// ============================================================================

export interface LabsFlags {
  cleansingRuleEditor: boolean;
  scdAuditView: boolean;
  goldMlvManager: boolean;
  dqScorecard: boolean;
}

const STORAGE_KEY = "fmd-labs-flags";

const DEFAULTS: LabsFlags = {
  cleansingRuleEditor: false,
  scdAuditView: false,
  goldMlvManager: false,
  dqScorecard: false,
};

export function getLabsFlags(): LabsFlags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setLabsFlags(flags: LabsFlags): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  // Dispatch a custom event so AppLayout can react without prop drilling
  window.dispatchEvent(new CustomEvent("fmd-labs-changed", { detail: flags }));
}

export function setLabsFlag<K extends keyof LabsFlags>(key: K, value: boolean): LabsFlags {
  const flags = getLabsFlags();
  flags[key] = value;
  setLabsFlags(flags);
  return flags;
}

export function anyLabsEnabled(flags?: LabsFlags): boolean {
  const f = flags ?? getLabsFlags();
  return Object.values(f).some(Boolean);
}
