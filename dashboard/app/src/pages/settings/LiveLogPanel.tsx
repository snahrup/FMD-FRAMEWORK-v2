import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import type { LogEntry } from './types';

interface Props {
  logs: LogEntry[];
  maxLines?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  info: '#93c5fd',
  warning: '#fbbf24',
  error: '#f87171',
};

const MSG_COLORS: Record<string, string> = {
  info: '#e2e8f0',
  warning: '#fde68a',
  error: '#fca5a5',
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
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--bp-border)', background: '#0d1117' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
        <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--bp-ink-muted)' }} />
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-body)' }}>
          Live Output
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
          {logs.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-[400px] overflow-y-auto px-4 py-3 text-[13px] leading-[1.7] scrollbar-thin scrollbar-thumb-border"
        style={{ fontFamily: 'var(--bp-font-mono)' }}
      >
        {visible.length === 0 && (
          <div className="text-center py-8" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Waiting for output...
          </div>
        )}
        {visible.map((entry, i) => (
          <div key={i} className="whitespace-pre-wrap break-words py-[2px]" style={{ color: MSG_COLORS[entry.level] || MSG_COLORS.info }}>
            <span style={{ color: LEVEL_COLORS[entry.level] || LEVEL_COLORS.info, fontWeight: 600, fontSize: '11px', marginRight: '8px' }}>
              {entry.level.toUpperCase()}
            </span>
            {entry.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
