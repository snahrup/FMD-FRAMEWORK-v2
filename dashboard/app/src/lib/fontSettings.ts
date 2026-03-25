/**
 * Font Settings — single source of truth for the dashboard font.
 *
 * All typography in the app cascades from the CSS variable `--font-family`.
 * This module manages user font preference via localStorage and applies it
 * by setting that one variable on :root. The Google Fonts stylesheet is
 * dynamically injected so only the selected font is loaded.
 */

const STORAGE_KEY = "fmd-font";
const LINK_ID = "fmd-google-font";

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family value (what gets set on --font-family) */
  family: string;
  /** Google Fonts URL parameter (family=...) */
  googleFamily: string;
  /** Weights to load */
  weights: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "manrope",
    label: "Manrope",
    family: "'Manrope', system-ui, sans-serif",
    googleFamily: "Manrope",
    weights: "300;400;500;600;700;800",
  },
  {
    id: "inter",
    label: "Inter",
    family: "'Inter', system-ui, sans-serif",
    googleFamily: "Inter",
    weights: "300;400;500;600;700;800",
  },
  {
    id: "dm-sans",
    label: "DM Sans",
    family: "'DM Sans', system-ui, sans-serif",
    googleFamily: "DM+Sans",
    weights: "300;400;500;600;700;800",
  },
  {
    id: "plus-jakarta",
    label: "Plus Jakarta Sans",
    family: "'Plus Jakarta Sans', system-ui, sans-serif",
    googleFamily: "Plus+Jakarta+Sans",
    weights: "300;400;500;600;700;800",
  },
  {
    id: "outfit",
    label: "Outfit",
    family: "'Outfit', system-ui, sans-serif",
    googleFamily: "Outfit",
    weights: "300;400;500;600;700",
  },
  {
    id: "geist",
    label: "Geist Sans",
    family: "'Geist', system-ui, sans-serif",
    googleFamily: "Geist",
    weights: "300;400;500;600;700;800",
  },
];

const DEFAULT_FONT = FONT_OPTIONS[0]; // Manrope

/** Get the stored font ID, falling back to default */
export function getStoredFont(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_FONT.id;
  } catch {
    return DEFAULT_FONT.id;
  }
}

/** Find a FontOption by ID */
function findFont(id: string): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) || DEFAULT_FONT;
}

/** Apply a font: update CSS variable, swap Google Fonts stylesheet, persist */
export function applyFont(fontId: string): void {
  const font = findFont(fontId);

  // 1. Set the CSS variable — everything cascades from this
  document.documentElement.style.setProperty("--font-family", font.family);

  // 2. Swap the Google Fonts link
  const url = `https://fonts.googleapis.com/css2?family=${font.googleFamily}:wght@${font.weights}&display=swap`;
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = url;

  // 3. Persist
  try {
    localStorage.setItem(STORAGE_KEY, fontId);
  } catch {
    // localStorage unavailable — font still applies for this session
  }
}

/** Initialize font on app startup — call once from main.tsx */
export function initFont(): void {
  const fontId = getStoredFont();
  if (fontId !== DEFAULT_FONT.id) {
    applyFont(fontId);
  }
}
