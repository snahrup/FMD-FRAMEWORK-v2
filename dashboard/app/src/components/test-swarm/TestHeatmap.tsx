/**
 * Test × Iteration heatmap — classic BI grid showing which tests
 * are green/red across each iteration. Instantly reveals persistent
 * failures vs early fixes.
 */

import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";

interface HeatmapCell {
  testName: string;
  iteration: number;
  status: "passed" | "failed" | "skipped" | "error" | "none";
}

interface TestHeatmapProps {
  /** Map of iteration number → array of test results */
  iterations: Map<number, Array<{ name: string; status: "passed" | "failed" | "skipped" | "error" }>>;
  /** Total iteration count (for column headers) */
  iterationCount: number;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  passed: "bg-[var(--bp-operational)]",
  failed: "bg-[var(--bp-fault)]",
  error: "bg-[var(--bp-fault)]",
  skipped: "bg-[var(--bp-dismissed)]",
  none: "bg-muted",
};

const STATUS_LABELS: Record<string, string> = {
  passed: "Pass",
  failed: "Fail",
  error: "Error",
  skipped: "Skip",
  none: "—",
};

export default function TestHeatmap({ iterations, iterationCount, className }: TestHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ test: string; iter: number } | null>(null);

  // Collect all unique test names across all iterations, sorted by "most failures first"
  const { testNames, grid } = useMemo(() => {
    const nameSet = new Map<string, number>(); // name → failure count

    for (const [, tests] of iterations) {
      for (const t of tests) {
        const prev = nameSet.get(t.name) || 0;
        nameSet.set(t.name, prev + (t.status === "failed" || t.status === "error" ? 1 : 0));
      }
    }

    // Sort: most failures first, then alphabetical
    const sorted = [...nameSet.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);

    // Build grid lookup
    const grid = new Map<string, HeatmapCell>();
    for (const [iter, tests] of iterations) {
      for (const t of tests) {
        grid.set(`${t.name}:${iter}`, { testName: t.name, iteration: iter, status: t.status });
      }
    }

    return { testNames: sorted, grid };
  }, [iterations]);

  if (testNames.length === 0 || iterationCount === 0) {
    return null;
  }

  const iterNums = Array.from({ length: iterationCount }, (_, i) => i + 1);

  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <h4 className="text-sm font-medium text-foreground">Test Heatmap</h4>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--bp-operational)]" /> Pass</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--bp-fault)]" /> Fail</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--bp-dismissed)]" /> Skip</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm text-left px-3 py-2 text-muted-foreground font-medium min-w-[200px] max-w-[300px]">
                Test
              </th>
              {iterNums.map(n => (
                <th key={n} className="px-1.5 py-2 text-center text-muted-foreground font-medium w-10">
                  #{n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {testNames.map((testName) => (
              <tr key={testName} className="border-t border-border/10 hover:bg-muted/50 transition-colors">
                <td className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm px-3 py-1.5 font-mono text-foreground/80 truncate max-w-[300px]" title={testName}>
                  {testName}
                </td>
                {iterNums.map(n => {
                  const cell = grid.get(`${testName}:${n}`);
                  const status = cell?.status || "none";
                  const isHovered = hoveredCell?.test === testName && hoveredCell?.iter === n;

                  return (
                    <td key={n} className="px-1.5 py-1.5 text-center">
                      <motion.div
                        role="gridcell"
                        aria-label={`${testName} iteration ${n}: ${STATUS_LABELS[status]}`}
                        className={cn(
                          "w-7 h-5 rounded-[3px] mx-auto cursor-default transition-all",
                          STATUS_COLORS[status],
                          status === "passed" && "opacity-80",
                          isHovered && "ring-2 ring-foreground/30 scale-110"
                        )}
                        onHoverStart={() => setHoveredCell({ test: testName, iter: n })}
                        onHoverEnd={() => setHoveredCell(null)}
                        initial={false}
                        whileHover={{ scale: 1.2 }}
                        title={`${testName} — Iter #${n}: ${STATUS_LABELS[status]}`}
                        style={{ willChange: "transform" }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip overlay */}
      {hoveredCell && (
        <div className="px-4 py-2 border-t border-border/20 bg-muted text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{hoveredCell.test}</span>
          <span className="mx-2">→</span>
          Iteration #{hoveredCell.iter}: <span className="font-medium">{STATUS_LABELS[grid.get(`${hoveredCell.test}:${hoveredCell.iter}`)?.status || "none"]}</span>
        </div>
      )}
    </div>
  );
}
