import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import type { LogEntry } from './types';

interface Props {
  logs: LogEntry[];
  maxLines?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-foreground/80',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

export default function LiveLogPanel({ logs, maxLines = 500 }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll when new logs arrive (only if user hasn't scrolled up)
  useEffect(() => {
    if (autoScrollRef.current && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  const visible = logs.slice(-maxLines);

  return (
    <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/30">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
          Live Output
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
          {logs.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6] scrollbar-thin scrollbar-thumb-border"
      >
        {visible.length === 0 && (
          <div className="text-muted-foreground/40 text-center py-8">
            Waiting for output...
          </div>
        )}
        {visible.map((entry, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${LEVEL_COLORS[entry.level] || LEVEL_COLORS.info}`}>
            {entry.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
