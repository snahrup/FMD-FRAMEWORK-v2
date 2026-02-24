import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Link2, ArrowRight } from 'lucide-react';
import { mockBlendSuggestions, layerConfig } from '@/data/blenderMockData';
import type { BlendSuggestion } from '@/types/blender';

interface BlendSuggestionsProps {
  sourceTableId: string;
  selectedBlendId: string | null;
  onSelectBlend: (blendId: string) => void;
}

export function BlendSuggestions({ sourceTableId, selectedBlendId, onSelectBlend }: BlendSuggestionsProps) {
  // TODO: Replace with live API call to get blend suggestions
  // For now, show empty state — mock data is hidden
  const suggestions: BlendSuggestion[] = [];

  if (suggestions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8 text-center">
        <div>
          <Link2 className="w-8 h-8 opacity-20 mx-auto mb-3" />
          <p className="font-medium text-foreground/60 mb-1">No blend suggestions yet</p>
          <p className="text-xs leading-relaxed">
            Blend suggestions will appear once tables are profiled and join relationships are detected by the framework.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-display font-semibold">Blend Suggestions</h3>
        <span className="text-[10px] text-muted-foreground">{suggestions.length} potential joins</span>
      </div>

      {suggestions.map(suggestion => (
        <BlendCard
          key={suggestion.id}
          suggestion={suggestion}
          isSelected={selectedBlendId === suggestion.id}
          onClick={() => onSelectBlend(suggestion.id)}
        />
      ))}
    </div>
  );
}

function BlendCard({ suggestion, isSelected, onClick }: {
  suggestion: BlendSuggestion;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { sourceTable, targetTable, matchScore, joinKeys, joinType, cardinality, explanation } = suggestion;

  const scoreColor = matchScore >= 90 ? 'text-success' : matchScore >= 70 ? 'text-warning' : 'text-destructive';
  const scoreBg = matchScore >= 90 ? 'bg-success/10' : matchScore >= 70 ? 'bg-warning/10' : 'bg-destructive/10';

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all duration-[var(--duration-fast)]",
        isSelected
          ? "ring-2 ring-primary shadow-[var(--shadow-md)]"
          : "hover:shadow-[var(--shadow-card-hover)]"
      )}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2.5">
        {/* Tables + Score */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: layerConfig[sourceTable.layer].color }}
              />
              <span className="text-xs font-medium truncate">{sourceTable.name}</span>
            </div>
          </div>

          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ background: layerConfig[targetTable.layer].color }}
              />
              <span className="text-xs font-medium truncate">{targetTable.name}</span>
            </div>
          </div>

          {/* Score circle */}
          <div className={cn("flex items-center justify-center h-9 w-9 rounded-full flex-shrink-0", scoreBg)}>
            <span className={cn("text-xs font-bold font-mono", scoreColor)}>{matchScore}</span>
          </div>
        </div>

        {/* Join keys */}
        <div className="flex flex-wrap gap-1.5">
          {joinKeys.map((jk, i) => (
            <div key={i} className="flex items-center gap-1 text-[10px] bg-muted/50 rounded-full px-2 py-0.5">
              <Link2 className="h-2.5 w-2.5 text-primary" />
              <span className="font-mono">{jk.source}</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-mono">{jk.target}</span>
            </div>
          ))}
        </div>

        {/* Metadata badges */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[9px]">{joinType.toUpperCase()}</Badge>
          <Badge variant="outline" className="text-[9px]">{cardinality}</Badge>
        </div>

        {/* Explanation */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">{explanation}</p>
      </CardContent>
    </Card>
  );
}
