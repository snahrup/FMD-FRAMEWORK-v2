import { cn } from "@/lib/utils";
import { useState } from "react";
import { FileCode, Plus, Minus } from "lucide-react";

interface FileChange {
  file: string;
  added: number;
  removed: number;
}

interface DiffViewerProps {
  files: FileChange[];
  patch?: string;
  className?: string;
}

function ChangeBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  if (total === 0) return null;
  const maxBlocks = 20;
  const addBlocks = Math.round((added / total) * Math.min(total, maxBlocks));
  const removeBlocks = Math.round((removed / total) * Math.min(total, maxBlocks));

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: addBlocks }).map((_, i) => (
        <div key={`a${i}`} className="w-1.5 h-3 rounded-sm bg-[var(--bp-operational)]" />
      ))}
      {Array.from({ length: removeBlocks }).map((_, i) => (
        <div key={`r${i}`} className="w-1.5 h-3 rounded-sm bg-[var(--bp-fault)]" />
      ))}
    </div>
  );
}

export default function DiffViewer({ files, patch, className }: DiffViewerProps) {
  const [showPatch, setShowPatch] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const totalAdded = files.reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = files.reduce((sum, f) => sum + f.removed, 0);

  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <h4 className="text-sm font-medium text-foreground">Files Changed</h4>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-[var(--bp-operational)]">
            <Plus className="h-3 w-3" />{totalAdded}
          </span>
          <span className="flex items-center gap-1 text-[var(--bp-fault)]">
            <Minus className="h-3 w-3" />{totalRemoved}
          </span>
          {patch && (
            <button
              onClick={() => setShowPatch(!showPatch)}
              className="text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {showPatch ? "Hide diff" : "Show diff"}
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-border/10">
        {files.map((file) => (
          <button
            key={file.file}
            onClick={() => setSelectedFile(selectedFile === file.file ? null : file.file)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
              selectedFile === file.file && "bg-muted"
            )}
          >
            <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 text-sm font-mono text-foreground truncate">{file.file}</span>
            <span className="text-xs text-[var(--bp-operational)] tabular-nums">+{file.added}</span>
            <span className="text-xs text-[var(--bp-fault)] tabular-nums">-{file.removed}</span>
            <ChangeBar added={file.added} removed={file.removed} />
          </button>
        ))}
      </div>

      {/* Patch viewer */}
      {showPatch && patch && (
        <div className="border-t border-border/20 max-h-[500px] overflow-auto">
          <pre className="text-xs font-mono p-4 leading-relaxed whitespace-pre-wrap">
            {patch.split("\n").map((line, i) => {
              let color = "text-foreground/70";
              if (line.startsWith("+") && !line.startsWith("+++")) color = "text-[var(--bp-operational)]";
              else if (line.startsWith("-") && !line.startsWith("---")) color = "text-[var(--bp-fault)]";
              else if (line.startsWith("@@")) color = "text-[var(--bp-info)]";
              else if (line.startsWith("diff")) color = "text-foreground font-bold";
              return (
                <span key={i} className={cn("block", color)}>
                  {line}
                </span>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}
