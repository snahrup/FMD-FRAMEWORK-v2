import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { useState } from 'react';
import type { PhaseState, PhaseItem } from './types';
import { PHASE_DEFS } from './types';

interface Props {
  phases: PhaseState[];
  currentPhase: number;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Circle className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />,
  running: <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--bp-copper)' }} />,
  completed: <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--bp-operational)' }} />,
  failed: <XCircle className="w-4 h-4" style={{ color: 'var(--bp-fault)' }} />,
  skipped: <SkipForward className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />,
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  created: 'var(--bp-operational)',
  exists: 'var(--bp-copper)',
  ok: 'var(--bp-operational)',
  failed: 'var(--bp-fault)',
  skipped: 'var(--bp-ink-muted)',
  warning: 'var(--bp-caution)',
  dry_run: 'var(--bp-copper)',
  manual: 'var(--bp-ink-tertiary)',
};

const ITEM_STATUS_ICON: Record<string, string> = {
  created: '+',
  exists: '=',
  ok: '\u2713',
  failed: '\u2717',
  skipped: '-',
  warning: '!',
  dry_run: '~',
  manual: '?',
};

function PhaseRow({ phase, isCurrent }: { phase: PhaseState; isCurrent: boolean }) {
  const [expanded, setExpanded] = useState(isCurrent || phase.status === 'failed');
  const hasItems = phase.items.length > 0;
  const phaseDef = PHASE_DEFS.find((p) => p.num === phase.num);

  return (
    <div className={`relative ${phase.status === 'running' ? 'animate-pulse-subtle' : ''}`}>
      {/* Phase header row */}
      <div
        className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${hasItems ? 'cursor-pointer' : ''}`}
        style={{
          background: phase.status === 'running'
            ? 'var(--bp-copper-light)'
            : phase.status === 'failed'
              ? 'var(--bp-fault-light)'
              : 'transparent',
        }}
        onClick={() => hasItems && setExpanded(!expanded)}
      >
        {/* Phase number circle */}
        <div className="flex-shrink-0">{STATUS_ICON[phase.status]}</div>

        {/* Phase info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-semibold"
              style={{
                color: phase.status === 'running'
                  ? 'var(--bp-ink-primary)'
                  : phase.status === 'completed'
                    ? 'var(--bp-ink-secondary)'
                    : phase.status === 'failed'
                      ? 'var(--bp-fault)'
                      : 'var(--bp-ink-muted)',
                fontFamily: 'var(--bp-font-body)',
              }}
            >
              [{phase.num}] {phase.name}
            </span>
            {phase.status === 'running' && (
              <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5" style={{ color: 'var(--bp-copper)', background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
                Running
              </span>
            )}
          </div>
          {phase.status === 'pending' && phaseDef && (
            <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>{phaseDef.itemHint}</span>
          )}
        </div>

        {/* Elapsed time */}
        {phase.elapsed > 0 && (
          <span className="flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
            <Clock className="w-2.5 h-2.5" />
            {phase.elapsed.toFixed(1)}s
          </span>
        )}

        {/* Items count */}
        {hasItems && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
              {phase.items.length}
            </span>
            {expanded ? (
              <ChevronDown className="w-3 h-3" style={{ color: 'var(--bp-ink-muted)' }} />
            ) : (
              <ChevronRight className="w-3 h-3" style={{ color: 'var(--bp-ink-muted)' }} />
            )}
          </div>
        )}
      </div>

      {/* Expanded items */}
      {expanded && hasItems && (
        <div className="ml-7 pl-3 space-y-0.5 pb-1" style={{ borderLeft: '1px solid var(--bp-border-subtle)' }}>
          {phase.items.map((item, i) => (
            <ItemRow key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: PhaseItem }) {
  const color = ITEM_STATUS_COLORS[item.status] || 'var(--bp-ink-muted)';
  const icon = ITEM_STATUS_ICON[item.status] || ' ';

  return (
    <div className="flex items-start gap-1.5 text-[10px]" style={{ color, fontFamily: 'var(--bp-font-mono)' }}>
      <span className="w-3 text-center flex-shrink-0">{icon}</span>
      <span className="break-all leading-relaxed">{item.message}</span>
    </div>
  );
}

export default function PhaseProgressTracker({ phases, currentPhase }: Props) {
  // Build display phases — use server phases if available, fall back to PHASE_DEFS
  const displayPhases: PhaseState[] =
    phases.length > 0
      ? phases
      : PHASE_DEFS.map((d) => ({
          num: d.num,
          name: d.name,
          status: 'pending',
          items: [],
          elapsed: 0,
        }));

  // Overall progress
  const completed = displayPhases.filter((p) => p.status === 'completed').length;
  const total = displayPhases.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bp-surface-inset)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'var(--bp-copper)' }}
          />
        </div>
        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--bp-ink-muted)', fontFamily: 'var(--bp-font-mono)', fontFeatureSettings: '"tnum"' }}>
          {completed}/{total} phases
        </span>
      </div>

      {/* Phase list */}
      <div className="space-y-0.5">
        {displayPhases.map((phase) => (
          <PhaseRow
            key={phase.num}
            phase={phase}
            isCurrent={phase.num === currentPhase}
          />
        ))}
      </div>
    </div>
  );
}
