/**
 * ScreenshotGallery — Grid of test screenshots with status badges and click-to-expand.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, AlertTriangle, Plus, CheckCircle2, Maximize2 } from "lucide-react";
import type { VisualDiff, AIAnalysis } from "@/hooks/useMRI";

const API = import.meta.env.VITE_API_URL || "";

interface Props {
  diffs: VisualDiff[];
  aiAnalyses: AIAnalysis[];
  runId: string;
  onSelect: (diff: VisualDiff) => void;
  filter?: "all" | "mismatch" | "new" | "match";
}

function screenshotUrl(runId: string, path: string): string {
  const filename = path.split(/[/\\]/).pop() || path;
  return `${API}/api/mri/artifacts/runs/${runId}/screenshots/${filename}`;
}

const statusConfig = {
  match: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "Match" },
  mismatch: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10", label: "Mismatch" },
  new: { icon: Plus, color: "text-info", bg: "bg-info/10", label: "New" },
  missing_baseline: { icon: Eye, color: "text-warning", bg: "bg-warning/10", label: "No Baseline" },
};

export default function ScreenshotGallery({ diffs, aiAnalyses, runId, onSelect, filter = "all" }: Props) {
  const [previewDiff, setPreviewDiff] = useState<VisualDiff | null>(null);

  const filtered = filter === "all" ? diffs : diffs.filter(d => d.status === filter);

  const getAnalysis = (testName: string) => aiAnalyses.find(a => a.testName === testName);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((diff) => {
          const cfg = statusConfig[diff.status];
          const analysis = getAnalysis(diff.testName);
          return (
            <button
              key={diff.testName}
              onClick={() => onSelect(diff)}
              className={cn(
                "group rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden",
                "transition-all duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)] hover:border-primary/30 cursor-pointer",
                "text-left"
              )}
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted overflow-hidden">
                <img
                  src={screenshotUrl(runId, diff.actualPath)}
                  alt={diff.testName}
                  className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                {/* Status badge overlay */}
                <div className="absolute top-2 left-2">
                  <Badge variant="secondary" className={cn("text-[10px] gap-1", cfg.bg, cfg.color)}>
                    <cfg.icon className="h-3 w-3" />
                    {cfg.label}
                  </Badge>
                </div>
                {/* AI risk badge */}
                {analysis && analysis.riskLevel !== "low" && (
                  <div className="absolute top-2 right-2">
                    <Badge
                      variant={analysis.riskLevel === "high" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {analysis.riskLevel}
                    </Badge>
                  </div>
                )}
                {/* Expand icon on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                  <div className="p-2 rounded-full bg-background/80 backdrop-blur-sm">
                    <Maximize2 className="h-4 w-4 text-foreground" />
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <p className="text-xs font-medium truncate">{diff.testName}</p>
                {diff.mismatchPercentage > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {diff.mismatchPercentage.toFixed(2)}% changed ({diff.mismatchPixels.toLocaleString()} px)
                  </p>
                )}
                {analysis && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {analysis.screenshotDescription}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Eye className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-sm">No screenshots match this filter</p>
        </div>
      )}

      {/* Quick preview dialog */}
      <Dialog open={!!previewDiff} onOpenChange={() => setPreviewDiff(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewDiff?.testName}</DialogTitle>
          </DialogHeader>
          {previewDiff && (
            <img
              src={screenshotUrl(runId, previewDiff.actualPath)}
              alt={previewDiff.testName}
              className="w-full rounded-[var(--radius-md)] border border-border"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
