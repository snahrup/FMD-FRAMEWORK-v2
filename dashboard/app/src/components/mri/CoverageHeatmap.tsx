/**
 * CoverageHeatmap — Which pages/components are tested, by layer (visual, API, E2E).
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Grid3X3 } from "lucide-react";
import type { VisualDiff, BackendTestResult } from "@/hooks/useMRI";

interface Props {
  visualDiffs: VisualDiff[];
  backendResults: BackendTestResult[];
  totalTests: number;
}

interface CoverageCell {
  name: string;
  hasE2E: boolean;
  hasVisual: boolean;
  hasAPI: boolean;
  layers: number;
}

export default function CoverageHeatmap({ visualDiffs, backendResults, totalTests }: Props) {
  // Build a map of unique test/page names to their coverage layers
  const coverageMap = new Map<string, CoverageCell>();

  // Extract page names from visual diffs (test names often contain the page)
  for (const diff of visualDiffs) {
    const name = extractPageName(diff.testName);
    const existing = coverageMap.get(name) || { name, hasE2E: true, hasVisual: false, hasAPI: false, layers: 1 };
    existing.hasVisual = true;
    existing.layers = [existing.hasE2E, existing.hasVisual, existing.hasAPI].filter(Boolean).length;
    coverageMap.set(name, existing);
  }

  // Extract endpoint names from backend results
  for (const result of backendResults) {
    const name = extractPageName(result.name);
    const existing = coverageMap.get(name) || { name, hasE2E: false, hasVisual: false, hasAPI: false, layers: 0 };
    existing.hasAPI = true;
    existing.layers = [existing.hasE2E, existing.hasVisual, existing.hasAPI].filter(Boolean).length;
    coverageMap.set(name, existing);
  }

  const cells = [...coverageMap.values()].sort((a, b) => b.layers - a.layers);
  const maxLayers = 3;

  if (cells.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Grid3X3 className="h-6 w-6 mb-2 opacity-40" />
        <p className="text-xs">No coverage data</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Test Coverage Map
      </h4>

      {/* Legend */}
      <div className="flex items-center gap-3 mb-3 text-[10px]">
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-info" />
          <span className="text-muted-foreground">E2E</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-success" />
          <span className="text-muted-foreground">Visual</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-warning" />
          <span className="text-muted-foreground">API</span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {cells.map((cell) => {
          const intensity = cell.layers / maxLayers;
          return (
            <div
              key={cell.name}
              className={cn(
                "rounded-[var(--radius-sm)] border px-3 py-2 text-center transition-colors",
                intensity >= 1
                  ? "border-success/40 bg-success/10"
                  : intensity >= 0.66
                  ? "border-info/40 bg-info/10"
                  : intensity >= 0.33
                  ? "border-warning/40 bg-warning/10"
                  : "border-border bg-muted"
              )}
              title={`${cell.name}: ${[cell.hasE2E && "E2E", cell.hasVisual && "Visual", cell.hasAPI && "API"].filter(Boolean).join(", ")}`}
            >
              <p className="text-xs font-medium truncate">{cell.name}</p>
              <div className="flex items-center justify-center gap-1 mt-1">
                {cell.hasE2E && <div className="h-1.5 w-1.5 rounded-full bg-info" />}
                {cell.hasVisual && <div className="h-1.5 w-1.5 rounded-full bg-success" />}
                {cell.hasAPI && <div className="h-1.5 w-1.5 rounded-full bg-warning" />}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        {cells.length} areas covered across {totalTests} total tests
      </p>
    </div>
  );
}

/** Extract a human-readable page/area name from a test name */
function extractPageName(testName: string): string {
  // Common patterns: "Engine Control > loads KPIs" → "Engine Control"
  // "GET /api/engine/status" → "Engine Status"
  const arrowIdx = testName.indexOf(">");
  if (arrowIdx > 0) return testName.slice(0, arrowIdx).trim();

  const dashIdx = testName.indexOf(" - ");
  if (dashIdx > 0) return testName.slice(0, dashIdx).trim();

  // API endpoints
  if (testName.startsWith("GET ") || testName.startsWith("POST ")) {
    const parts = testName.split("/").filter(Boolean);
    return parts.slice(-2).join(" ").replace(/[_-]/g, " ");
  }

  // Fallback: first 3 words
  return testName.split(/\s+/).slice(0, 3).join(" ");
}
