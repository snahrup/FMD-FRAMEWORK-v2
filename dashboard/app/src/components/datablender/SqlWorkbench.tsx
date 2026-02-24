import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Play, ChevronUp, ChevronDown, Copy, CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import type { QueryResult } from '@/types/blender';

interface SqlWorkbenchProps {
  tableId: string | null;
}

export function SqlWorkbench({ tableId }: SqlWorkbenchProps) {
  const [sql, setSql] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [lakehouse, setLakehouse] = useState('');

  useEffect(() => {
    if (tableId) {
      if (tableId.startsWith('lh-')) {
        // Parse lakehouse discovery format: lh-{lakehouse}-{schema}-{table}
        const rest = tableId.replace('lh-', '');
        const lastDash = rest.lastIndexOf('-');
        const secondLastDash = rest.lastIndexOf('-', lastDash - 1);
        const tableName = rest.substring(lastDash + 1);
        const schema = rest.substring(secondLastDash + 1, lastDash);
        const lh = rest.substring(0, secondLastDash);
        setLakehouse(lh);
        setSql(`SELECT TOP 100 *\nFROM [${schema}].[${tableName}]\nORDER BY 1 DESC`);
      } else {
        // Generic fallback — user can type their own query
        setSql('SELECT TOP 100 * FROM ...');
      }
      setResult(null);
    }
  }, [tableId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRun = async () => {
    if (!lakehouse || !sql.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const resp = await fetch('/api/blender/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lakehouse, sql }),
      });
      const data: QueryResult = await resp.json();
      setResult(data);
    } catch (e) {
      setResult({ error: 'Failed to connect to API server' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="border-t border-border bg-card">
      {/* Toggle bar */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-4 py-2 hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="font-mono text-primary">SQL</span>
          <span className="text-muted-foreground">Workbench</span>
          {lakehouse && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">→ {lakehouse}</span>
          )}
        </div>
        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {/* Editor area */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted border-b border-border">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1 text-success hover:text-success"
              onClick={handleRun}
              disabled={running || !lakehouse}
              title={!lakehouse ? 'Select a table first' : 'Run query against lakehouse SQL endpoint'}
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {running ? 'Running...' : 'Run Query'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1"
              onClick={handleCopy}
            >
              {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Read-only queries (TOP 100 enforced)
            </span>
          </div>
          <textarea
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleRun();
              }
            }}
            className="w-full h-24 p-4 bg-transparent font-mono text-xs resize-none focus:outline-none"
            placeholder="SELECT TOP 100 * FROM ..."
            spellCheck={false}
          />

          {/* Query results */}
          {result && (
            <div className="border-t border-border">
              {result.error ? (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{result.error}</span>
                </div>
              ) : result.rows && result.rows.length > 0 ? (
                <div className="max-h-64 overflow-auto">
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/50 border-b border-border text-[10px] text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    <span>{result.rowCount} rows returned</span>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        {Object.keys(result.rows[0]).map(col => (
                          <th key={col} className="text-left px-3 py-1 font-mono font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-3 py-0.5 font-mono whitespace-nowrap max-w-[200px] truncate">
                              {val ?? <span className="text-muted-foreground/40 italic">NULL</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  Query returned 0 rows
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
