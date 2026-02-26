import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Data Source Display Names ──
// Maps raw DB names to user-friendly labels used across the FMD project.
const DATA_SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'mes': 'MES',
  'ETQStagingPRD': 'ETQ',
  'm3fdbprd': 'M3',
  'DI_PRD_Staging': 'M3 Cloud',
};

export function getSourceDisplayName(rawName: string): string {
  return DATA_SOURCE_DISPLAY_NAMES[rawName] ?? rawName;
}
