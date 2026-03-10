import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Data Source Display Names ──
// Delegate to centralized source config. Import resolveSourceLabel from
// '@/hooks/useSourceConfig' for new code. This wrapper kept for backward compat.
import { resolveSourceLabel } from '@/hooks/useSourceConfig';

export function getSourceDisplayName(rawName: string): string {
  return resolveSourceLabel(rawName);
}
