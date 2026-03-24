/**
 * BaselineManager — Accept/reject baselines per test, with bulk actions.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Image, CheckCheck, Clock, AlertTriangle,
} from "lucide-react";
import type { VisualDiff, BaselineEntry } from "@/hooks/useMRI";

interface Props {
  diffs: VisualDiff[];
  baselines: BaselineEntry[];
  onAccept: (testName: string) => void;
  onAcceptAll: () => void;
}

export default function BaselineManager({ diffs, baselines, onAccept, onAcceptAll }: Props) {
  const actionable = diffs.filter(d => d.status === "mismatch" || d.status === "new");
  const matches = diffs.filter(d => d.status === "match").length;

  if (actionable.length === 0 && baselines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Image className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No baselines yet</p>
        <p className="text-xs mt-1">Run visual tests to capture screenshots, then accept them as baselines</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + bulk action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {baselines.length} baselines, {matches} matching, {actionable.length} need review
          </span>
        </div>
        {actionable.length > 0 && (
          <Button
            size="sm"
            onClick={onAcceptAll}
            className="gap-1.5"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Accept All ({actionable.length})
          </Button>
        )}
      </div>

      {/* Actionable items */}
      {actionable.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Needs Review
          </h4>
          {actionable.map((diff) => (
            <div
              key={diff.testName}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3"
            >
              <AlertTriangle className={cn(
                "h-4 w-4 flex-shrink-0",
                diff.status === "mismatch" ? "text-destructive" : "text-info"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{diff.testName}</p>
                <p className="text-xs text-muted-foreground">
                  {diff.status === "mismatch"
                    ? `${diff.mismatchPercentage.toFixed(2)}% changed`
                    : "New screenshot — no baseline exists"}
                </p>
              </div>
              <Badge variant={diff.status === "mismatch" ? "destructive" : "outline"} className="text-[10px]">
                {diff.status}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAccept(diff.testName)}
                className="gap-1 h-7 text-xs"
              >
                <CheckCircle2 className="h-3 w-3" />
                Accept
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Current baselines */}
      {baselines.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Current Baselines ({baselines.length})
          </h4>
          <div className="rounded-[var(--radius-lg)] border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30">
                  <th scope="col" className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Test</th>
                  <th scope="col" className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Viewport</th>
                  <th scope="col" className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((b, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{b.testName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{b.viewport}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                      <Clock className="inline h-3 w-3 mr-1" />
                      {new Date(b.lastUpdated).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
