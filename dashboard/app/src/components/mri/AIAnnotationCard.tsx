/**
 * AIAnnotationCard — Claude's analysis of a visual diff: risk badge, changes list, suggestions.
 */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Brain, ShieldAlert, ShieldCheck, AlertTriangle, Lightbulb, Eye, ChevronDown,
} from "lucide-react";
import { useState } from "react";
import type { AIAnalysis } from "@/hooks/useMRI";

interface Props {
  analyses: AIAnalysis[];
  compact?: boolean;
}

function SingleAnalysis({ analysis, compact }: { analysis: AIAnalysis; compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);

  const riskIcon = analysis.riskLevel === "high"
    ? ShieldAlert
    : analysis.riskLevel === "medium"
    ? AlertTriangle
    : ShieldCheck;

  const riskColor = analysis.riskLevel === "high"
    ? "text-destructive"
    : analysis.riskLevel === "medium"
    ? "text-warning"
    : "text-success";

  const RiskIcon = riskIcon;

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <Brain className="h-4 w-4 text-info flex-shrink-0" />
        <span className="text-sm font-medium flex-1 truncate">{analysis.testName}</span>
        <Badge
          variant={analysis.riskLevel === "high" ? "destructive" : analysis.riskLevel === "medium" ? "outline" : "secondary"}
          className="text-[10px] gap-1"
        >
          <RiskIcon className={cn("h-3 w-3", riskColor)} />
          {analysis.riskLevel}
        </Badge>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {/* Description */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              <Eye className="inline h-3 w-3 mr-1" />
              Description
            </p>
            <p className="text-sm text-foreground/90">{analysis.screenshotDescription}</p>
          </div>

          {/* Visual Changes */}
          {analysis.visualChanges.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                Changes Detected
              </p>
              <ul className="space-y-1">
                {analysis.visualChanges.map((change, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <div className={cn("mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0", riskColor.replace("text-", "bg-"))} />
                    {change}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {analysis.suggestedFixes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                <Lightbulb className="inline h-3 w-3 mr-1" />
                Suggested Fixes
              </p>
              <ul className="space-y-1">
                {analysis.suggestedFixes.map((fix, i) => (
                  <li key={i} className="text-sm text-muted-foreground bg-muted rounded-[var(--radius-sm)] px-3 py-1.5">
                    {fix}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/60">
            Analyzed {new Date(analysis.timestamp).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AIAnnotationCard({ analyses, compact }: Props) {
  if (analyses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Brain className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No AI analysis results yet</p>
        <p className="text-xs mt-1">Enable AI in .mri.yaml to get visual analysis</p>
      </div>
    );
  }

  const high = analyses.filter(a => a.riskLevel === "high").length;
  const med = analyses.filter(a => a.riskLevel === "medium").length;
  const low = analyses.filter(a => a.riskLevel === "low").length;

  return (
    <div className="space-y-3">
      {/* Risk summary */}
      <div className="flex items-center gap-4 px-1">
        <span className="text-xs text-muted-foreground">Risk breakdown:</span>
        {high > 0 && (
          <Badge variant="destructive" className="text-[10px]">{high} high</Badge>
        )}
        {med > 0 && (
          <Badge variant="outline" className="text-[10px]">{med} medium</Badge>
        )}
        {low > 0 && (
          <Badge variant="secondary" className="text-[10px]">{low} low</Badge>
        )}
      </div>

      {/* Individual analyses — high risk first */}
      {[...analyses]
        .sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.riskLevel] - order[b.riskLevel];
        })
        .map((a) => (
          <SingleAnalysis key={a.testName} analysis={a} compact={compact} />
        ))}
    </div>
  );
}
