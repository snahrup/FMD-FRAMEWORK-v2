import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Download, CheckCircle2, XCircle, Copy,
} from 'lucide-react';
import { mockBlendSuggestions, generateBlendPreviewRows, formatNumber } from '@/data/blenderMockData';
import type { BlendSuggestion, BlendRecipe } from '@/types/blender';

interface BlendPreviewProps {
  blendId: string;
}

export function BlendPreview({ blendId }: BlendPreviewProps) {
  const [copied, setCopied] = useState(false);

  // TODO: Replace with live API call to load blend preview
  // Mock data is hidden — show empty state for now
  const suggestion: BlendSuggestion | undefined = undefined;
  if (!suggestion) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center px-8">
        <div>
          <XCircle className="w-8 h-8 opacity-20 mx-auto mb-3" />
          <p className="font-medium text-foreground/60 mb-1">No blend preview available</p>
          <p className="text-xs leading-relaxed">
            Select a blend suggestion to see a preview of the joined data.
            Blend suggestions will appear once table relationships are detected.
          </p>
        </div>
      </div>
    );
  }

  const rows = generateBlendPreviewRows(blendId);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const recipe = buildRecipe(suggestion);

  const handleExportRecipe = () => {
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blend-recipe-${suggestion.sourceTable.name}-${suggestion.targetTable.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyRecipe = () => {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-display font-semibold">Blend Preview</h3>
          <p className="text-[11px] text-muted-foreground">
            {suggestion.sourceTable.name} {suggestion.joinType.toUpperCase()} JOIN {suggestion.targetTable.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyRecipe} className="h-7 text-[11px]">
            {copied ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            {copied ? 'Copied' : 'Copy Recipe'}
          </Button>
          <Button size="sm" onClick={handleExportRecipe} className="h-7 text-[11px]">
            <Download className="h-3 w-3 mr-1" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="hover:shadow-none">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated Rows</span>
            </div>
            <span className="text-lg font-semibold font-mono">{formatNumber(suggestion.estimatedRows)}</span>
          </CardContent>
        </Card>
        <Card className="hover:shadow-none">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Join Type</span>
            </div>
            <Badge variant="outline" className="text-xs">{suggestion.joinType.toUpperCase()}</Badge>
          </CardContent>
        </Card>
        <Card className="hover:shadow-none">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cardinality</span>
            </div>
            <Badge variant="outline" className="text-xs">{suggestion.cardinality}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Sample data table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-muted-foreground">Sample Data (LIMIT {rows.length})</h4>
        </div>
        <div className="border border-border rounded-[var(--radius-lg)] overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {columns.map(col => (
                  <th key={col} className="text-left px-3 py-1.5 font-mono font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                  {columns.map(col => (
                    <td key={col} className="px-3 py-1 font-mono whitespace-nowrap">{row[col]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recipe preview */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Blend Recipe (JSON Skeleton)</h4>
        <pre className="bg-muted/30 border border-border rounded-[var(--radius-lg)] p-3 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(recipe, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function buildRecipe(suggestion: BlendSuggestion): BlendRecipe {
  return {
    id: suggestion.id,
    name: `${suggestion.sourceTable.name}_x_${suggestion.targetTable.name}`,
    source: {
      table: suggestion.sourceTable.name,
      layer: suggestion.sourceTable.layer,
      columns: [],
    },
    target: {
      table: suggestion.targetTable.name,
      layer: suggestion.targetTable.layer,
      columns: [],
    },
    joinConfig: {
      sourceKey: suggestion.joinKeys[0]?.source || '',
      targetKey: suggestion.joinKeys[0]?.target || '',
      type: suggestion.joinType,
    },
    cardinality: suggestion.cardinality,
    destinationLayer: 'silver',
    createdAt: new Date().toISOString(),
  };
}
