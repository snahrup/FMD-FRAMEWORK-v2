import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";

export interface TimelineNode {
  iteration: number;
  passed: number;
  total: number;
  failed: number;
  delta: number;
  filesChanged?: string[];
  active?: boolean;
}

interface RunTimelineProps {
  nodes: TimelineNode[];
  selectedIteration: number | null;
  onSelect: (iteration: number) => void;
}

function getNodeColor(node: TimelineNode): string {
  if (node.failed === 0) return "bg-[var(--cl-success)]";
  if (node.delta > 0) return "bg-[var(--cl-warning)]";
  if (node.delta < 0) return "bg-[var(--cl-error)]";
  return "bg-muted-foreground/60";
}

function getLineColor(from: TimelineNode, to: TimelineNode): string {
  if (to.delta > 0) return "bg-[var(--cl-success)]/60";
  if (to.delta < 0) return "bg-[var(--cl-error)]/60";
  return "bg-border";
}

export default function RunTimeline({ nodes, selectedIteration, onSelect }: RunTimelineProps) {
  const shouldReduceMotion = useReducedMotion();

  if (nodes.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 text-center text-muted-foreground text-sm">
        No iterations yet
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6">
      <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase mb-6">Run Timeline</h3>

      <div className="flex items-center justify-center overflow-x-auto py-2">
        {nodes.map((node, idx) => (
          <div key={node.iteration} className="flex items-center">
            {/* Connector line */}
            {idx > 0 && (
              <div className="flex flex-col items-center mx-1">
                <div className={cn("h-0.5 w-8 md:w-16 transition-colors", getLineColor(nodes[idx - 1], node))} />
                {node.filesChanged && node.filesChanged.length > 0 && (
                  <span className="text-[10px] text-muted-foreground mt-1 max-w-[80px] truncate text-center">
                    {node.filesChanged.length} files
                  </span>
                )}
              </div>
            )}

            {/* Node */}
            <button
              onClick={() => onSelect(node.iteration)}
              className="flex flex-col items-center gap-1.5 group cursor-pointer"
            >
              <motion.div
                className={cn(
                  "relative rounded-full w-10 h-10 flex items-center justify-center text-white text-xs font-bold",
                  "transition-all duration-[var(--duration-normal)]",
                  "ring-2 ring-transparent",
                  getNodeColor(node),
                  selectedIteration === node.iteration && "ring-foreground/30 scale-110",
                  node.active && "animate-pulse"
                )}
                whileHover={shouldReduceMotion ? {} : { scale: 1.15 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.95 }}
              >
                {node.iteration === 0 ? "—" : `#${node.iteration}`}

                {/* Active indicator */}
                {node.active && !shouldReduceMotion && (
                  <motion.div
                    className="absolute -inset-1 rounded-full border-2 border-[var(--cl-info)]"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
              </motion.div>

              {/* Score label */}
              <div className="text-center">
                <span className={cn(
                  "text-xs font-semibold",
                  node.failed === 0 ? "text-[var(--cl-success)]" : "text-foreground"
                )}>
                  {node.passed}/{node.total}
                </span>
                {node.iteration > 0 && node.delta !== 0 && (
                  <span className={cn(
                    "text-[10px] ml-1",
                    node.delta > 0 ? "text-[var(--cl-success)]" : "text-[var(--cl-error)]"
                  )}>
                    {node.delta > 0 ? `+${node.delta}` : node.delta}
                  </span>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
