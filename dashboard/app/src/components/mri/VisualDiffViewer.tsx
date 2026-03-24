/**
 * VisualDiffViewer — Before/after/diff with 3 viewing modes:
 * 1. Side-by-side: baseline left, actual right, diff below
 * 2. Overlay slider: stacked images, drag vertical line to reveal
 * 3. Onion skin: actual overlaid on baseline, adjustable opacity
 */
import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Columns3, Layers, Blend, ZoomIn, ZoomOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VisualDiff, AIAnalysis } from "@/hooks/useMRI";

const API = import.meta.env.VITE_API_URL || "";

type ViewMode = "side-by-side" | "slider" | "onion";

interface Props {
  diff: VisualDiff;
  analysis?: AIAnalysis;
  runId: string;
}

function artifactUrl(runId: string, relPath: string): string {
  // Build API URL for serving artifacts from .mri/runs/{runId}/...
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  return `${API}/api/mri/artifacts/runs/${runId}/screenshots/${filename}`;
}

function diffArtifactUrl(runId: string, relPath: string): string {
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  return `${API}/api/mri/artifacts/runs/${runId}/diffs/${filename}`;
}

function baselineArtifactUrl(relPath: string): string {
  const filename = relPath.split(/[/\\]/).pop() || relPath;
  // Baselines are at the root .mri/baselines/ level
  return `${API}/api/mri/artifacts/baselines/${filename}`;
}

export default function VisualDiffViewer({ diff, analysis, runId }: Props) {
  const [mode, setMode] = useState<ViewMode>("side-by-side");
  const [sliderPos, setSliderPos] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [zoom, setZoom] = useState(1);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const hasBaseline = diff.status === "mismatch";
  const actualUrl = artifactUrl(runId, diff.actualPath);
  const baselineUrl = hasBaseline ? baselineArtifactUrl(diff.baselinePath) : null;
  const diffUrl = diff.diffPath ? diffArtifactUrl(runId, diff.diffPath) : null;

  const handleSliderMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging.current || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  const modeButtons: Array<{ mode: ViewMode; icon: React.ElementType; label: string }> = [
    { mode: "side-by-side", icon: Columns3, label: "Side by Side" },
    { mode: "slider", icon: Layers, label: "Overlay Slider" },
    { mode: "onion", icon: Blend, label: "Onion Skin" },
  ];

  const riskBadge = analysis ? (
    <Badge
      variant={analysis.riskLevel === "high" ? "destructive" : analysis.riskLevel === "medium" ? "outline" : "secondary"}
      className="ml-2"
    >
      {analysis.riskLevel} risk
    </Badge>
  ) : null;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{diff.testName}</h3>
          <Badge variant={diff.status === "match" ? "secondary" : diff.status === "mismatch" ? "destructive" : "outline"}>
            {diff.status}
          </Badge>
          {riskBadge}
          {diff.mismatchPercentage > 0 && (
            <span className="text-xs text-muted-foreground">
              {diff.mismatchPercentage.toFixed(2)}% changed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* View mode toggles */}
          {hasBaseline && modeButtons.map(({ mode: m, icon: Icon, label }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={label}
              className={cn(
                "p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}

          {/* Zoom */}
          <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
            <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} aria-label="Zoom out" className="p-1 rounded hover:bg-accent cursor-pointer">
              <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} aria-label="Zoom in" className="p-1 rounded hover:bg-accent cursor-pointer">
              <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 overflow-auto" style={{ maxHeight: 600 }}>
        {mode === "side-by-side" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {baselineUrl && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Baseline</p>
                  <div className="rounded-[var(--radius-md)] border border-border overflow-hidden bg-muted">
                    <img
                      src={baselineUrl}
                      alt="Baseline"
                      className="w-full object-contain"
                      style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                    />
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  {hasBaseline ? "Actual" : "Screenshot (new)"}
                </p>
                <div className="rounded-[var(--radius-md)] border border-border overflow-hidden bg-muted">
                  <img
                    src={actualUrl}
                    alt="Actual"
                    className="w-full object-contain"
                    style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  />
                </div>
              </div>
            </div>
            {diffUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium">Diff (magenta = changed pixels)</p>
                <div className="rounded-[var(--radius-md)] border border-border overflow-hidden bg-muted">
                  <img
                    src={diffUrl}
                    alt="Diff"
                    className="w-full object-contain"
                    style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "slider" && baselineUrl && (
          <div>
            <div
              ref={sliderRef}
              aria-label="Drag to compare baseline and actual screenshots"
              className="relative rounded-[var(--radius-md)] border border-border overflow-hidden cursor-col-resize select-none"
              onMouseDown={() => { isDragging.current = true; }}
              onMouseUp={() => { isDragging.current = false; }}
              onMouseLeave={() => { isDragging.current = false; }}
              onMouseMove={handleSliderMove}
              onTouchStart={() => { isDragging.current = true; }}
              onTouchEnd={() => { isDragging.current = false; }}
              onTouchMove={handleSliderMove}
            >
              {/* Baseline (full width) */}
              <img
                src={baselineUrl}
                alt="Baseline"
                className="w-full object-contain"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
              />
              {/* Actual (clipped) */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                <img
                  src={actualUrl}
                  alt="Actual"
                  className="w-full object-contain"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                />
              </div>
              {/* Slider line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-lg z-10"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-primary border-2 border-primary-foreground shadow-lg flex items-center justify-center">
                  <Columns3 className="h-3 w-3 text-primary-foreground" />
                </div>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Baseline</span>
              <span>Actual</span>
            </div>
          </div>
        )}

        {mode === "onion" && baselineUrl && (
          <div>
            <div className="relative rounded-[var(--radius-md)] border border-border overflow-hidden">
              <img
                src={baselineUrl}
                alt="Baseline"
                className="w-full object-contain"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
              />
              <img
                src={actualUrl}
                alt="Actual"
                className="absolute inset-0 w-full object-contain"
                style={{
                  opacity: opacity / 100,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-xs text-muted-foreground">Baseline</span>
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                aria-label="Onion skin opacity"
                className="flex-1 accent-primary"
              />
              <span className="text-xs text-muted-foreground">Actual</span>
              <span className="text-xs font-mono text-muted-foreground w-10">{opacity}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
